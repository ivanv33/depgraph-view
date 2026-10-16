import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { ID_RE, validatePlan, type Plan, type PlanNode } from '../engine/schema.js'
import { COMMON_KEYS, NodeFileError, nodeFromFile, parseFrontmatter, splitNodeFile } from './frontmatter.js'
import { listFiles, within } from './paths.js'
import { GraphError } from './planYaml.js'

export { GraphError } from './planYaml.js'

export interface LoadResult {
  plan: Plan
  /** Each node's folder files, relative to the folder. */
  resources: Record<string, string[]>
  /** Each node's md text below the frontmatter. */
  bodies: Record<string, string>
  /** Each node's folder as an absolute realpath; server-internal, never sent to the page. */
  folders: Record<string, string>
  /** Each node's md file as an absolute realpath; server-internal, never sent to the page. */
  mdFiles: Record<string, string>
  warnings: string[]
}

const FILE_LIMIT = 500

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string')

interface Entry { id: string; md: string; dir: string | undefined; dependsOn: string[]; common: Record<string, unknown> }

/** The JSON's entries after the file-level shape checks; throws GraphError at the first problem. */
function entriesOf(json: unknown): { name: string; entries: Entry[] } {
  if (!isRecord(json)) throw new GraphError('graph must be an object')
  if (typeof json.name !== 'string') throw new GraphError('name must be a string')
  if (!Array.isArray(json.nodes)) throw new GraphError('nodes must be an array')
  const seen = new Set<string>()
  const entries = json.nodes.map((raw, i): Entry => {
    if (!isRecord(raw)) throw new GraphError(`node ${i}: must be an object`)
    const id = raw.id
    if (typeof id !== 'string' || !ID_RE.test(id)) throw new GraphError(`node ${i}: id "${String(id)}" does not match ${ID_RE.source}`)
    if (seen.has(id)) throw new GraphError(`node ${i}: duplicate id "${id}"`)
    seen.add(id)
    if (typeof raw.md !== 'string') throw new GraphError(`node "${id}": md must be a string`)
    if (raw.dir !== undefined && typeof raw.dir !== 'string') throw new GraphError(`node "${id}": dir must be a string`)
    if (raw.depends_on !== undefined && !isStringArray(raw.depends_on))
      throw new GraphError(`node "${id}": depends_on must be an array of strings`)
    const common = Object.fromEntries(COMMON_KEYS.filter(k => Object.hasOwn(raw, k)).map(k => [k, raw[k]]))
    return { id, md: raw.md, dir: raw.dir as string | undefined, dependsOn: (raw.depends_on as string[] | undefined) ?? [], common }
  })
  return { name: json.name, entries }
}

/**
 * Where `rel` points: its realpath, or `outside` when it leaves the root lexically or its realpath
 * leaves `realRoot`, or `missing` when it does not exist (or is not of the wanted kind).
 */
function locate(root: string, realRoot: string, rel: string, kind: 'file' | 'dir'): string | 'outside' | 'missing' {
  const abs = path.resolve(root, rel)
  if (!within(root, abs)) return 'outside'
  let real: string
  try {
    real = realpathSync(abs)
  } catch {
    return 'missing'
  }
  if (!within(realRoot, real)) return 'outside'
  const stat = statSync(real)
  return (kind === 'file' ? stat.isFile() : stat.isDirectory()) ? real : 'missing'
}

/** The graph in `json`, its md files and folders read relative to `rootDir`. Throws GraphError. */
export function loadGraph(rootDir: string, json: unknown): LoadResult {
  const { name, entries } = entriesOf(json)
  const root = path.resolve(rootDir)
  let realRoot: string
  try {
    realRoot = realpathSync(root)
  } catch {
    throw new GraphError(`folder not found: ${path.basename(rootDir)}`)
  }
  const out: LoadResult = { plan: { name, nodes: [] }, resources: {}, bodies: {}, folders: {}, mdFiles: {}, warnings: [] }
  const warn = (id: string, text: string) => out.warnings.push(`node "${id}": ${text}`)
  const kept: PlanNode[] = []
  // Nodes that share a folder share its one walk.
  const listed = new Map<string, ReturnType<typeof listFiles>>()
  for (const { id, md, dir, dependsOn, common } of entries) {
    const mdPath = locate(root, realRoot, md, 'file')
    if (mdPath === 'outside') { warn(id, 'md is outside the folder'); continue }
    if (mdPath === 'missing') { warn(id, 'md not found'); continue }
    let folder: string | null = path.dirname(mdPath)
    if (dir !== undefined) {
      const dirPath = locate(root, realRoot, dir, 'dir')
      if (dirPath === 'outside') { warn(id, 'dir is outside the folder'); continue }
      folder = dirPath === 'missing' ? null : dirPath
    }
    let data: Record<string, unknown>
    let body: string
    try {
      const split = splitNodeFile(readFileSync(mdPath, 'utf8'))
      data = parseFrontmatter(split.frontmatter)
      body = split.body
    } catch (e) {
      if (e instanceof NodeFileError) throw new GraphError(`node "${id}": ${e.message}`)
      throw e
    }
    kept.push(nodeFromFile(id, { ...common, ...data }, dependsOn))
    out.bodies[id] = body
    out.mdFiles[id] = mdPath
    if (folder === null) {
      out.resources[id] = []
      warn(id, 'dir not found')
    } else {
      let walk = listed.get(folder)
      if (walk === undefined) listed.set(folder, (walk = listFiles(folder, FILE_LIMIT)))
      const { files, truncated } = walk
      out.resources[id] = files
      out.folders[id] = folder
      if (truncated) warn(id, `more than ${FILE_LIMIT} files, list cut`)
    }
  }
  const ids = new Set(kept.map(n => n.id))
  for (const node of kept) {
    for (const dep of node.depends_on) if (!ids.has(dep)) warn(node.id, `unknown dependency "${dep}" dropped`)
    node.depends_on = node.depends_on.filter(dep => ids.has(dep))
  }
  out.plan.nodes = kept
  const errors = validatePlan(out.plan)
  if (errors.length) throw new GraphError(errors.join('; '))
  return out
}

/** The absolute path of the graph JSON: `p` itself when it is a file, else the one `.json` file at the top of folder `p`. */
export function resolveGraphPath(p: string): string {
  const abs = path.resolve(p)
  let isDir: boolean
  try {
    isDir = statSync(abs).isDirectory()
  } catch {
    throw new GraphError(`not found: ${p}`)
  }
  if (!isDir) return abs
  const isFile = (name: string) => statSync(path.join(abs, name), { throwIfNoEntry: false })?.isFile() === true
  const found = readdirSync(abs).filter(name => name.endsWith('.json') && isFile(name))
  if (found.length !== 1) {
    const names = found.length ? `: ${found.sort().join(', ')}` : ''
    throw new GraphError(`${p}: expected exactly one .json file at the top of the folder, found ${found.length}${names}`)
  }
  return path.join(abs, found[0])
}

/** Reads the graph JSON at `jsonPath` and loads it relative to its folder. Throws GraphError. */
export function loadGraphFile(jsonPath: string): LoadResult {
  const base = path.basename(jsonPath)
  let json: unknown
  try {
    const text = readFileSync(jsonPath, 'utf8')
    json = JSON.parse(text.startsWith('﻿') ? text.slice(1) : text)
  } catch (e) {
    // Only a parse error's own text: I/O messages carry absolute paths, and these reach the page.
    if (e instanceof SyntaxError) throw new GraphError(`${base}: ${e.message}`)
    throw new GraphError(`${base}: cannot be read (${(e as NodeJS.ErrnoException).code ?? 'error'})`)
  }
  return loadGraph(path.dirname(jsonPath), json)
}
