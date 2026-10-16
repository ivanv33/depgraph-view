import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { validatePlan, type Plan, type PlanNode } from '../engine/schema.js'
import { NodeFileError, nodeFromFile, parseFrontmatter, splitNodeFile } from './frontmatter.js'
import { listFiles, within } from './paths.js'
import { GraphError, parseGraphYaml } from './planYaml.js'

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

/**
 * The plan in `yaml`, its md files and folders read relative to `rootDir`; nodes sorted by id. A node
 * without `md` reads `nodes/<id>.context/<id>.md` and lists `nodes/<id>.context` unless it names `dir`;
 * with `md` and no `dir`, its folder is the md file's. Throws GraphError.
 */
export function loadGraph(rootDir: string, yaml: string): LoadResult {
  const parsed = parseGraphYaml(yaml)
  const entries = [...parsed.entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const root = path.resolve(rootDir)
  let realRoot: string
  try {
    realRoot = realpathSync(root)
  } catch {
    throw new GraphError(`folder not found: ${path.basename(rootDir)}`)
  }
  const out: LoadResult = { plan: { name: parsed.name, nodes: [] }, resources: {}, bodies: {}, folders: {}, mdFiles: {}, warnings: [...parsed.warnings] }
  const warn = (id: string, text: string) => out.warnings.push(`node "${id}": ${text}`)
  const kept: PlanNode[] = []
  // Nodes that share a folder share its one walk.
  const listed = new Map<string, ReturnType<typeof listFiles>>()
  for (const { id, needs, md: givenMd, dir: givenDir, common } of entries) {
    const md = givenMd ?? `nodes/${id}.context/${id}.md`
    const dir = givenDir ?? (givenMd === undefined ? `nodes/${id}.context` : undefined)
    const mdPath = locate(root, realRoot, md, 'file')
    if (mdPath === 'outside') { warn(id, 'md is outside the folder'); continue }
    if (mdPath === 'missing' && givenMd !== undefined) { warn(id, 'md not found'); continue }
    let folder: string | null = mdPath === 'missing' ? null : path.dirname(mdPath)
    if (dir !== undefined) {
      const dirPath = locate(root, realRoot, dir, 'dir')
      if (dirPath === 'outside') { warn(id, 'dir is outside the folder'); continue }
      folder = dirPath === 'missing' ? null : dirPath
    }
    let data: Record<string, unknown> = {}
    let body = ''
    if (mdPath === 'missing') warn(id, 'no md file')
    else {
      try {
        const split = splitNodeFile(readFileSync(mdPath, 'utf8'))
        data = parseFrontmatter(split.frontmatter)
        body = split.body
      } catch (e) {
        if (e instanceof NodeFileError) throw new GraphError(`node "${id}": ${e.message}`)
        throw e
      }
      out.mdFiles[id] = mdPath
    }
    kept.push(nodeFromFile(id, { ...common, ...data }, [...new Set(needs)].sort()))
    out.bodies[id] = body
    if (folder === null) {
      out.resources[id] = []
      // A missing default md already said so; its missing default folder needs no second line.
      if (givenDir !== undefined || givenMd !== undefined) warn(id, 'dir not found')
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

/** The refusal for an old JSON graph file named `name`. */
function jsonRefusal(name: string): GraphError {
  const stem = name.slice(0, -'.json'.length)
  return new GraphError(`${stem}.json: JSON graph files are no longer read; rewrite it as ${stem}.yaml (see README "From graph.json")`)
}

/**
 * The absolute path of the plan YAML: `p` itself when it is a `.yaml`/`.yml` file; for a folder,
 * `<folder>/<basename>.yaml` when present, else its one top-level `.yaml` file. A `.json` file, or a
 * folder with JSON but no YAML, is refused with a pointer to the README. Throws GraphError.
 */
export function resolveGraphPath(p: string): string {
  const abs = path.resolve(p)
  let isDir: boolean
  try {
    isDir = statSync(abs).isDirectory()
  } catch {
    throw new GraphError(`not found: ${p}`)
  }
  if (!isDir) {
    const base = path.basename(abs)
    if (base.endsWith('.yaml') || base.endsWith('.yml')) return abs
    if (base.endsWith('.json')) throw jsonRefusal(base)
    throw new GraphError(`${base}: not a plan file (expected .yaml or .yml)`)
  }
  const isFile = (name: string) => statSync(path.join(abs, name), { throwIfNoEntry: false })?.isFile() === true
  // Dot-files (`.pre-commit-config.yaml`, ...) are never the plan.
  const names = readdirSync(abs).filter(name => !name.startsWith('.') && isFile(name)).sort()
  const own = `${path.basename(abs)}.yaml`
  if (names.includes(own)) return path.join(abs, own)
  const found = names.filter(name => name.endsWith('.yaml'))
  if (found.length === 1) return path.join(abs, found[0])
  if (found.length > 1) throw new GraphError(`${p}: expected exactly one .yaml file at the top of the folder, found ${found.length}: ${found.join(', ')}`)
  const json = names.find(name => name === `${path.basename(abs)}.json`) ?? names.find(name => name.endsWith('.json') && isJsonGraph(path.join(abs, name)))
  if (json !== undefined) throw jsonRefusal(json)
  const none = `${p}: expected a .yaml plan file at the top of the folder, found none`
  const yml = names.filter(name => name.endsWith('.yml'))
  if (yml.length) throw new GraphError(`${none}; ${yml.join(', ')} found: name the file explicitly or rename it to .yaml`)
  throw new GraphError(none)
}

/** Whether the file at `file` holds an old JSON graph: an object with a `nodes` array. */
function isJsonGraph(file: string): boolean {
  try {
    const data: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return typeof data === 'object' && data !== null && Array.isArray((data as { nodes?: unknown }).nodes)
  } catch {
    return false
  }
}

/** Reads the plan YAML at `planPath` and loads it relative to its folder. Throws GraphError. */
export function loadGraphFile(planPath: string): LoadResult {
  const base = path.basename(planPath)
  let text: string
  try {
    text = readFileSync(planPath, 'utf8')
  } catch (e) {
    // Only the error code: I/O messages carry absolute paths, and these reach the page.
    throw new GraphError(`${base}: cannot be read (${(e as NodeJS.ErrnoException).code ?? 'error'})`)
  }
  try {
    return loadGraph(path.dirname(planPath), text.startsWith('﻿') ? text.slice(1) : text)
  } catch (e) {
    // Only an error in the YAML text itself names the file; shape and node errors carry their own context.
    if (e instanceof GraphError && e.yaml) throw new GraphError(`${base}: ${e.message}`, true)
    throw e
  }
}
