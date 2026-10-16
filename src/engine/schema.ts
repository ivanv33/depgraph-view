export const STATUSES = ['todo', 'doing', 'done', 'blocked'] as const
export type Status = (typeof STATUSES)[number]

export const PRIORITIES = ['low', 'normal', 'high'] as const
export type Priority = (typeof PRIORITIES)[number]

/** YYYY-MM-DD and a real calendar date (no 2026-02-30). */
export const isDate = (s: unknown): s is string => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

export interface PlanNode {
  id: string
  title: string
  description: string
  status: Status
  tags: string[]
  depends_on: string[]
  /** Why this stage is not broken into steps yet: what must be known first. Absent means not held. */
  hold?: string
  /** Due date, YYYY-MM-DD; set only by the user. Absent means no due date. */
  due?: string
  /** Absent means normal. */
  priority?: 'low' | 'high'
}

export interface Plan {
  name: string
  nodes: PlanNode[]
}

export const MAX_HOLD = 200
const inRange = (s: string) => s.length > 0 && Array.from(s).length <= MAX_HOLD
/** Collapses every run of whitespace (newlines included) to one space and trims. */
export const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

export const ID_RE = /^[a-z0-9][a-z0-9-]*$/

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every(x => typeof x === 'string')

export function findCycle(nodes: Pick<PlanNode, 'id' | 'depends_on'>[]): string[] | null {
  const deps = new Map(nodes.map(n => [n.id, n.depends_on]))
  const state = new Map<string, 'visiting' | 'done'>()
  const stack: string[] = []
  const visit = (id: string): string[] | null => {
    const s = state.get(id)
    if (s === 'done') return null
    if (s === 'visiting') return [...stack.slice(stack.indexOf(id)), id]
    state.set(id, 'visiting')
    stack.push(id)
    for (const d of deps.get(id) ?? []) {
      if (!deps.has(d)) continue
      const found = visit(d)
      if (found) return found
    }
    stack.pop()
    state.set(id, 'done')
    return null
  }
  for (const n of nodes) {
    const found = visit(n.id)
    if (found) return found
  }
  return null
}

export function validatePlan(input: unknown): string[] {
  if (!isRecord(input)) return ['plan must be an object']
  const errors: string[] = []
  if (typeof input.name !== 'string') errors.push('name must be a string')
  if (!Array.isArray(input.nodes)) {
    errors.push('nodes must be an array')
    return errors
  }
  const seen = new Set<string>()
  const wellFormed: Pick<PlanNode, 'id' | 'depends_on'>[] = []
  input.nodes.forEach((raw, i) => {
    if (!isRecord(raw)) {
      errors.push(`node ${i}: must be an object`)
      return
    }
    const id = raw.id
    if (typeof id !== 'string' || !ID_RE.test(id)) {
      errors.push(`node ${i}: id "${String(id)}" does not match ^[a-z0-9][a-z0-9-]*$`)
      return
    }
    if (seen.has(id)) {
      errors.push(`node ${i}: duplicate id "${id}"`)
      return
    }
    seen.add(id)
    if (typeof raw.title !== 'string') errors.push(`node "${id}": title must be a string`)
    if (raw.description !== undefined && typeof raw.description !== 'string')
      errors.push(`node "${id}": description must be a string`)
    if (raw.status !== undefined && !STATUSES.includes(raw.status as Status))
      errors.push(`node "${id}": invalid status "${String(raw.status)}"`)
    if (raw.tags !== undefined && !isStringArray(raw.tags))
      errors.push(`node "${id}": tags must be an array of strings`)
    if (raw.hold !== undefined && !(typeof raw.hold === 'string' && inRange(oneLine(raw.hold))))
      errors.push(`node "${id}": hold must be 1-200 characters`)
    if (raw.due !== undefined && !isDate(raw.due))
      errors.push(`node "${id}": due must be a date YYYY-MM-DD`)
    if (raw.priority !== undefined && !PRIORITIES.includes(raw.priority as Priority))
      errors.push(`node "${id}": invalid priority "${String(raw.priority)}"`)
    if (raw.depends_on !== undefined && !isStringArray(raw.depends_on)) {
      errors.push(`node "${id}": depends_on must be an array of strings`)
      return
    }
    wellFormed.push({ id, depends_on: raw.depends_on ?? [] })
  })
  for (const n of wellFormed) {
    for (const d of n.depends_on) {
      if (d === n.id) errors.push(`node "${n.id}": depends on itself`)
      else if (!seen.has(d)) errors.push(`node "${n.id}": unknown dependency "${d}"`)
    }
  }
  if (errors.length === 0) {
    const cycle = findCycle(wellFormed)
    if (cycle) errors.push(`cycle: ${cycle.join(' -> ')}`)
  }
  return errors
}

export function normalizePlan(plan: Plan): Plan {
  const nodes = plan.nodes
    .map((n): PlanNode => {
      const out: PlanNode = {
        id: n.id,
        title: n.title ?? '',
        description: n.description ?? '',
        status: n.status ?? 'todo',
        tags: [...(n.tags ?? [])],
        depends_on: [...(n.depends_on ?? [])].sort(),
      }
      const hold = typeof n.hold === 'string' ? oneLine(n.hold) : ''
      if (hold) out.hold = hold
      if (isDate(n.due)) out.due = n.due
      if (n.priority === 'low' || n.priority === 'high') out.priority = n.priority
      return out
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { name: plan.name, nodes }
}

export function serializePlan(plan: Plan): string {
  return JSON.stringify(normalizePlan(plan), null, 2) + '\n'
}

export function slugify(text: string): string {
  const s = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return s || 'untitled'
}

export function uniqueId(base: string, existing: Iterable<string>): string {
  const taken = new Set(existing)
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`
    if (!taken.has(candidate)) return candidate
  }
}

/** The plan JSON: connections only. Node data lives in the node files. */
export interface PlanIndex { name: string; nodes: { id: string; depends_on: string[] }[] }

/** An entry of the plan JSON that carries anything besides id and depends_on (title, status, ...). */
export const isInlineEntry = (n: unknown): n is Record<string, unknown> =>
  isRecord(n) && Object.keys(n).some(k => k !== 'id' && k !== 'depends_on')

/**
 * True when any entry is inline. A plan JSON may mix bare and inline entries (the chat or a hand
 * edit adding a step with its title in the JSON); only one where every entry is inline and no
 * step folder exists is the format before node files (see migratePlan).
 */
export function isOldIndex(input: unknown): boolean {
  return isRecord(input) && Array.isArray(input.nodes) && input.nodes.some(isInlineEntry)
}

const INLINE_KEYS = ['title', 'description', 'status', 'tags', 'hold', 'due', 'priority'] as const

/**
 * The keys of an inline entry whose value validatePlan would refuse (a status "in progress", a due
 * that is not a date, ...), each checked on its own. Migration leaves these out of the step file;
 * a missing key takes its usual default, nothing else is filled in.
 */
export function invalidInlineKeys(n: Record<string, unknown>): string[] {
  return INLINE_KEYS.filter(k => n[k] !== undefined &&
    validatePlan({ name: '', nodes: [{ id: n.id, title: k === 'title' ? n.title : 'x', [k]: n[k] }] }).length > 0)
}

/** Shape errors of a plan JSON, with validatePlan's messages; dependencies are checked on the assembled plan. */
export function validateIndex(input: unknown): string[] {
  if (!isRecord(input)) return ['plan must be an object']
  const errors: string[] = []
  if (typeof input.name !== 'string') errors.push('name must be a string')
  if (!Array.isArray(input.nodes)) return [...errors, 'nodes must be an array']
  const seen = new Set<string>()
  input.nodes.forEach((raw, i) => {
    if (!isRecord(raw)) return void errors.push(`node ${i}: must be an object`)
    const id = raw.id
    if (typeof id !== 'string' || !ID_RE.test(id)) return void errors.push(`node ${i}: id "${String(id)}" does not match ^[a-z0-9][a-z0-9-]*$`)
    if (seen.has(id)) return void errors.push(`node ${i}: duplicate id "${id}"`)
    seen.add(id)
    if (raw.depends_on !== undefined && !isStringArray(raw.depends_on))
      errors.push(`node "${id}": depends_on must be an array of strings`)
  })
  return errors
}

/**
 * Why the text of a plan file cannot be used, in plain words for the chat (no paths); null when it
 * can. `stepIds` are the step files in `nodes/`, which the plan lists even without an entry, so a
 * link to one is fine. Checks the JSON, its shape (mixed entries allowed), links and loops.
 */
export function planFileProblem(text: string, stepIds: Iterable<string>): string | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return 'it was no longer valid JSON'
  }
  const errors = validateIndex(raw) // inline values that cannot be used are left out when the entry moves
  // Names in the file are untrusted: cut short, so a note never carries a long string from it.
  const cut = (t: string, n: number) => (Array.from(t).length > n ? `${Array.from(t).slice(0, n - 1).join('')}…` : t)
  if (errors.length) return `some of it could not be read (${cut(errors[0], 120)})`
  const nodes = (raw as PlanIndex).nodes.map(n => ({ id: n.id, depends_on: n.depends_on ?? [] }))
  const known = new Set([...nodes.map(n => n.id), ...stepIds])
  for (const n of nodes) {
    for (const d of n.depends_on) {
      if (d === n.id) return `step "${cut(n.id, 40)}" was linked to itself`
      if (!known.has(d)) return `step "${cut(n.id, 40)}" was linked to a step that does not exist ("${cut(d, 40)}")`
    }
  }
  const cycle = findCycle(nodes)
  if (!cycle) return null
  const shown = cycle.length > 8 ? [...cycle.slice(0, 7), '…', cycle[cycle.length - 1]] : cycle
  return `its links made a loop (${shown.map(id => cut(id, 40)).join(' → ')})`
}

/** The plan JSON text: every node's id and sorted depends_on, sorted by id, 2-space indent. */
export function serializeIndex(plan: Plan): string {
  const nodes = normalizePlan(plan).nodes.map(n => ({ id: n.id, depends_on: n.depends_on }))
  return JSON.stringify({ name: plan.name, nodes }, null, 2) + '\n'
}

/** A plan whose JSON shape or node files cannot be used; `errors` go to the browser as a 422. */
export class PlanFileError extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join('; '))
  }
}
