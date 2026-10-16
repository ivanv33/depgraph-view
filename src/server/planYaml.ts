import { isAlias, isMap, isNode, isScalar, isSeq, parseDocument, type Document, type Node, type Scalar } from 'yaml'
import { ID_RE } from '../engine/schema.js'
import { COMMON_KEYS } from './frontmatter.js'

/**
 * A plan file that cannot be shown. `yaml` is true when the text itself is not YAML (syntax error,
 * duplicate key, alias overflow); readers prefix the file name only then.
 */
export class GraphError extends Error {
  constructor(message: string, readonly yaml = false) {
    super(message)
  }
}

export interface GraphEntry {
  id: string
  needs: string[]
  md?: string
  dir?: string
  /** Only the COMMON_KEYS present on the node, raw values. */
  common: Record<string, unknown>
}

export interface ParsedGraph { name: string; entries: GraphEntry[]; warnings: string[] }

const NODE_KEYS = new Set<string>(['needs', 'md', 'dir', ...COMMON_KEYS])
const COMMON = new Set<string>(COMMON_KEYS)

const firstLine = (e: unknown) => (e instanceof Error ? e.message : String(e)).split('\n')[0].replace(/:$/, '')

/** The node an alias points at, or the node itself. */
function resolved(doc: Document.Parsed, node: unknown): unknown {
  return isAlias(node) ? node.resolve(doc) : node
}

const sourceOf = (s: Scalar) => s.source ?? String(s.value)

/** A mapping key's string value, or null for a non-scalar key. */
function keyOf(doc: Document.Parsed, key: unknown): string | null {
  const k = resolved(doc, key)
  return isScalar(k) ? String(k.value) : null
}

const isNull = (n: unknown) => n === null || n === undefined || (isScalar(n) && n.value === null)

/** A parsed value as plain JS; the whole document's alias expansion is already capped. */
const js = (doc: Document.Parsed, n: unknown): unknown => (isNode(n) ? n.toJS(doc) : n)

/**
 * The message for a scalar or other node where a string was wanted: `what must be a string: quote it
 * as "X"` when quoting it would do (`fits` says whether the quoted text would be accepted), else `plain`.
 */
function notString(n: unknown, what: string, plain: string, fits: (src: string) => boolean): string {
  if (!isScalar(n)) return plain
  const src = sourceOf(n)
  return src !== '' && fits(src) ? `${what} ${src} is not a string: quote it as "${src}"` : plain
}

const ID_PLAIN = 'node id must be a string such as dig-beds'

/**
 * The plan file's name and nodes in file order, after every shape rule; unknown keys are
 * warnings and otherwise ignored. Pure: no fs. Throws GraphError at the first problem.
 */
export function parseGraphYaml(text: string): ParsedGraph {
  const doc = parseDocument(text, { version: '1.2', uniqueKeys: true })
  if (doc.errors.length) throw new GraphError(firstLine(doc.errors[0]), true)
  try {
    // Only the alias cap is wanted here; as Maps, collection keys raise no stringify warning.
    doc.toJS({ maxAliasCount: 100, mapAsMap: true })
  } catch (e) {
    throw new GraphError(firstLine(e), true)
  }
  const root = doc.contents
  if (!isMap(root)) throw new GraphError('graph must be a mapping')
  const top = (k: string) => resolved(doc, root.items.find(p => keyOf(doc, p.key) === k)?.value)
  const name = top('name')
  if (!isScalar(name) || typeof name.value !== 'string')
    throw new GraphError(isScalar(name) && !isNull(name) ? `name must be a string: quote it as "${sourceOf(name)}"` : 'name must be a string')
  const nodesPair = root.items.find(p => keyOf(doc, p.key) === 'nodes')
  const nodes = resolved(doc, nodesPair?.value)
  // `nodes:` with nothing after it (YAML null) is an empty plan, as `needs:` is no needs.
  const empty = nodesPair !== undefined && isNull(nodes)
  if (!empty && !isMap(nodes)) throw new GraphError('nodes must be a mapping')

  const warnings: string[] = []
  for (const p of root.items) {
    const k = keyOf(doc, p.key)
    if (k !== 'name' && k !== 'nodes') warnings.push(`unknown top-level key "${k}" ignored`)
  }
  const entries = (isMap(nodes) ? nodes.items : []).map((pair): GraphEntry => {
    const key = resolved(doc, pair.key)
    if (!isScalar(key) || typeof key.value !== 'string') throw new GraphError(notString(key, 'node id', ID_PLAIN, src => ID_RE.test(src)))
    const id = key.value
    if (!ID_RE.test(id)) throw new GraphError(`id "${id}" does not match ${ID_RE.source}`)
    const fail = (message: string): never => { throw new GraphError(`node "${id}": ${message}`) }
    const value = resolved(doc, pair.value)
    const entry: GraphEntry = { id, needs: [], common: {} }
    if (isNull(value)) return entry
    if (!isMap(value)) return fail('must be a mapping or empty')
    for (const p of value.items) {
      const k = keyOf(doc, p.key)
      if (k === 'needs') {
        const v = resolved(doc, p.value)
        // `needs:` with nothing after it (YAML null) is no needs, as an empty node is.
        entry.needs = isNull(v) ? [] : needsOf(doc, v, fail)
      } else if (k === 'md' || k === 'dir') {
        const v = js(doc, p.value)
        if (typeof v !== 'string') fail(`${k} must be a string`)
        entry[k] = v as string
      } else if (k !== null && COMMON.has(k)) entry.common[k] = js(doc, p.value)
      if (k === null || !NODE_KEYS.has(k)) warnings.push(`node "${id}": unknown key "${k}" ignored`)
    }
    return entry
  })
  return { name: name.value, entries, warnings }
}

/** A node's needs list as ids; each item is checked on its parsed scalar value. */
function needsOf(doc: Document.Parsed, seq: unknown, fail: (message: string) => never): string[] {
  if (!isSeq(seq)) return fail('needs must be a list')
  return seq.items.map(item => {
    const n = resolved(doc, item) as Node | undefined
    if (!isScalar(n)) return fail('needs must be a list of ids')
    if (typeof n.value !== 'string') return fail(notString(n, 'needs item', 'needs item must be a string such as dig-beds', src => ID_RE.test(src)))
    return n.value
  })
}
