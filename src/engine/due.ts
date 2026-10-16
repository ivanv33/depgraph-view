import type { Plan, PlanNode, Status } from './schema.js'

/** Distance as haze: full strength within `nearDays`, `floor` from `farDays` out, linear between. */
export const HAZE = { nearDays: 7, farDays: 180, floor: 0.4 }

const pad = (n: number) => String(n).padStart(2, '0')

/** The local calendar date, YYYY-MM-DD. */
export function localDate(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

const utcDay = (date: string) => {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 86_400_000
}

/** Whole days from `today` to `due`, negative when past. UTC arithmetic on dates, so DST cannot skew it. */
export function daysUntil(due: string, today: string): number {
  return utcDay(due) - utcDay(today)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A date as a reader says it: "Nov 1", with the year when it is not `today`'s ("Jan 15, 2027"). */
export function shortDate(date: string, today: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const md = `${MONTHS[m - 1]} ${d}`
  return y === Number(today.slice(0, 4)) ? md : `${md}, ${y}`
}

/** A date is said with how near it is (see dueLabel) when it is this many days off or fewer, or past. */
export const NEAR_TEXT_DAYS = 14

/**
 * How a due date reads wherever the app shows one (the graph, a deck, the Due chip, a tooltip): the short calendar date,
 * "by <date>" when `inherited`, and with `nearness` how near it is after it ("Nov 14 · in 3 days") when it is within
 * NEAR_TEXT_DAYS or past. The one place the format is decided; only text for the chat agent keeps ISO dates.
 */
export function dueLabel(date: string, today: string, { inherited = false, nearness = false }: { inherited?: boolean; nearness?: boolean } = {}): string {
  const said = `${inherited ? 'by ' : ''}${shortDate(date, today)}`
  const days = daysUntil(date, today)
  return nearness && days <= NEAR_TEXT_DAYS ? `${said} · ${dueText(days)}` : said
}

/** How near a date `days` away is, in words ("in 3 days", "today", "2 weeks late"); dueLabel adds it after the date. */
export function dueText(days: number): string {
  const late = days < 0
  const n = Math.abs(days)
  const unit = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`
  if (n === 0) return 'today'
  if (n === 1) return late ? '1 day late' : 'tomorrow'
  let span: string
  if (n < 14) span = `${n} days`
  else if (n < 56) span = `${Math.floor(n / 7)} weeks`
  else if (n < 365) span = unit(Math.floor(n / 30), 'month', 'months')
  else span = unit(Math.floor(n / 365), 'year', 'years')
  return late ? `${span} late` : `in ${span}`
}

/** 1 when near or overdue, `HAZE.floor` when far, linear between. */
export function strength(days: number): number {
  const { nearDays, farDays, floor } = HAZE
  if (days <= nearDays) return 1
  if (days >= farDays) return floor
  return 1 - ((1 - floor) * (days - nearDays)) / (farDays - nearDays)
}

/** Dot radius in px by distance: `near` within `HAZE.nearDays` or overdue, `far` from `HAZE.farDays`, `normal` for no date. */
export const SIZE = { near: 16, normal: 11, far: 7 }

/** Radius for a node `days` from its due date: near (overdue or <= HAZE.nearDays) is largest, >= HAZE.farDays smallest, linear between. */
export function radius(days: number): number {
  const { nearDays, farDays } = HAZE
  if (days <= nearDays) return SIZE.near
  if (days >= farDays) return SIZE.far
  return SIZE.near - ((SIZE.near - SIZE.far) * (days - nearDays)) / (farDays - nearDays)
}

/** How much larger (near) or smaller (far) than an undated node a dated one draws, the same at every zoom. */
export const NEAR = { near: 1.3, far: 0.85 }

/** The size ratio for a node `days` from its due date: `NEAR.near` when overdue or within HAZE.nearDays,
 *  `NEAR.far` at HAZE.farDays and beyond, linear between. */
export function nearScale(days: number): number {
  const { nearDays, farDays } = HAZE
  if (days <= nearDays) return NEAR.near
  if (days >= farDays) return NEAR.far
  return NEAR.near - ((NEAR.near - NEAR.far) * (days - nearDays)) / (farDays - nearDays)
}

export interface DueView {
  date: string
  /** The date as the graph says it, with how near when close (see dueLabel). */
  text: string
  strength: number
  overdue: boolean
  /** Dot radius in px: bigger the sooner it is due. */
  radius: number
  /** Size ratio of the whole label (see NEAR): larger the sooner it is due, smaller the farther off. */
  scale: number
  /** Set when the step has no date of its own and shows the one of a step that needs it. */
  inherited?: true
  /** With `inherited`: the title of the step whose date it is. */
  from?: string
}

/** What a label shows for a node's due date; null when it has none or is done. */
export function dueView(node: { due?: string; status: Status }, today: string): DueView | null {
  if (!node.due || node.status === 'done') return null
  const days = daysUntil(node.due, today)
  return { date: node.due, text: dueLabel(node.due, today, { nearness: true }), strength: strength(days), overdue: days < 0, radius: radius(days), scale: nearScale(days) }
}

/** The largest size ratio any node draws at: due soon (NEAR.near) plus the most a prerequisite adds (see inheritedScale). */
export const NEAR_MAX = NEAR.near + 0.1
/** How much larger per level an inherited date draws than the step it comes from, and over how many levels at most. */
const INHERIT_STEP = 0.025
const INHERIT_LEVELS = 4

/**
 * The size ratio for a step that inherits a date `days` away from `depth` levels up: as nearScale, plus a little per
 * level so a prerequisite reads as sooner than what needs it; at most NEAR_MAX.
 */
export function inheritedScale(days: number, depth: number): number {
  return Math.min(NEAR_MAX, nearScale(days) + Math.min(depth, INHERIT_LEVELS) * INHERIT_STEP)
}

/**
 * How many steps may share one inherited date and still all draw its full size (`few`), and from how many on it adds
 * no size at all (`crowd`); between the two the boost fades along an S-curve. A date many steps inherit says little by size
 * (they would all draw alike) and would crowd the plan: that many steps drawn larger run into one another.
 */
export const INHERIT_DAMP = { few: 4, crowd: 12 }

/**
 * The part of an inherited date's size boost a step draws, given how many steps (`share`) inherit that same date
 * from the same step: 1 for a handful, fading smoothly to 0 at INHERIT_DAMP.crowd (half at eight). The one place the rule is decided:
 * 0 everywhere would leave inherited dates out of size, 1 everywhere would keep them as large as their own date.
 */
export function inheritDamping(share: number): number {
  const { few, crowd } = INHERIT_DAMP
  if (share <= few) return 1
  if (share >= crowd) return 0
  // an S-curve, so the first steps past `few` (and the last before `crowd`) lose little: no jump at either end
  const t = (share - few) / (crowd - few)
  return 1 - t * t * (3 - 2 * t)
}

/**
 * The size of a step that inherits a date `days` away from `depth` levels up, shared by `share` steps: inheritedScale
 * and the date's radius, each moved back towards an undated step's by inheritDamping. The same damping at every depth,
 * so a prerequisite never draws smaller than a step above it that inherits the same date.
 */
export function inheritedSize(days: number, depth: number, share: number): { scale: number; radius: number } {
  const f = inheritDamping(share)
  if (f === 1) return { scale: inheritedScale(days, depth), radius: radius(days) }
  return { scale: 1 + (inheritedScale(days, depth) - 1) * f, radius: SIZE.normal + (radius(days) - SIZE.normal) * f }
}

const shareCache = new WeakMap<Plan, Map<string, number>>()

/**
 * How many steps are drawn with the date they inherit from each dated step of `plan` (see effectiveDue), by its id:
 * done steps draw no date and do not count; held steps draw it and do. Memoised per plan.
 */
function inheritShares(plan: Plan): Map<string, number> {
  const cached = shareCache.get(plan)
  if (cached) return cached
  const out = new Map<string, number>()
  const effective = effectiveDue(plan)
  for (const n of plan.nodes) {
    const e = effective.get(n.id)
    if (n.status !== 'done' && e?.inherited && e.from) out.set(e.from, (out.get(e.from) ?? 0) + 1)
  }
  shareCache.set(plan, out)
  return out
}

/** A step's due date as the plan implies it: its own, or the one it inherits from a step that needs it. */
export interface EffectiveDue {
  date: string
  /** True when the step has no date of its own and takes this one from a step that needs it. */
  inherited: boolean
  /** The id of the step whose own date this is; null for the step's own date. */
  from: string | null
  /** Edges up to that step (0 for an own date). */
  depth: number
}

const effectiveCache = new WeakMap<Plan, Map<string, EffectiveDue>>()

/**
 * Each step's effective due date: its own when set (an own date always wins), otherwise the earliest among the steps
 * that depend on it, passed down through undated steps (the shortest path when several give that date). Steps with
 * nothing dated above them are absent. Display only: nothing here is ever written to the plan. Memoised per plan.
 */
export function effectiveDue(plan: Plan): Map<string, EffectiveDue> {
  const cached = effectiveCache.get(plan)
  if (cached) return cached
  const byId = new Map(plan.nodes.map(n => [n.id, n]))
  const out = new Map<string, EffectiveDue>()
  // Earliest date first, then fewest edges: the first time a step is reached is its answer (cycles end there too).
  const queue: { id: string; e: EffectiveDue }[] = plan.nodes
    .filter(n => n.due)
    .map(n => ({ id: n.id, e: { date: n.due!, inherited: false, from: null, depth: 0 } }))
  const before = (a: EffectiveDue, b: EffectiveDue) => (a.date !== b.date ? a.date < b.date : a.depth < b.depth)
  while (queue.length) {
    let best = 0
    for (let i = 1; i < queue.length; i++) if (before(queue[i].e, queue[best].e)) best = i
    const [{ id, e }] = queue.splice(best, 1)
    if (out.has(id)) continue
    out.set(id, e)
    for (const dep of byId.get(id)?.depends_on ?? []) {
      const child = byId.get(dep)
      if (!child || child.due || out.has(dep)) continue
      queue.push({ id: dep, e: { date: e.date, inherited: true, from: e.from ?? id, depth: e.depth + 1 } })
    }
  }
  effectiveCache.set(plan, out)
  return out
}

/**
 * What a label shows for a step's due date in `plan`: its own date as dueView, or the one it inherits, read
 * "by <date>" (see dueLabel) and drawn a little larger per level (see inheritedScale), less so the more steps share
 * that date (see inheritedSize). Null when it has neither or is done.
 */
export function dueViewOf(plan: Plan, node: PlanNode, today: string): DueView | null {
  if (node.due || node.status === 'done') return dueView(node, today)
  const e = effectiveDue(plan).get(node.id)
  if (!e) return null
  const days = daysUntil(e.date, today)
  const from = plan.nodes.find(n => n.id === e.from)
  const size = inheritedSize(days, e.depth, inheritShares(plan).get(e.from ?? '') ?? 1)
  return {
    date: e.date,
    text: dueLabel(e.date, today, { inherited: true, nearness: true }),
    strength: strength(days),
    overdue: days < 0,
    radius: size.radius,
    scale: size.scale,
    inherited: true,
    from: from?.title || e.from || '',
  }
}

/** For the panel's Due control: the date a step without its own would inherit, and from which step; else null. */
export function inheritHint(plan: Plan, id: string): { date: string; fromId: string; fromTitle: string } | null {
  const e = effectiveDue(plan).get(id)
  if (!e || !e.inherited || !e.from) return null
  const from = plan.nodes.find(n => n.id === e.from)
  return { date: e.date, fromId: e.from, fromTitle: from?.title || e.from }
}

/** The line a prompt states about a step's date: its own, or the one of the step that needs it; [] for neither. */
export function duePromptLines(plan: Plan, node: PlanNode): string[] {
  if (node.due) return [`This step is due on ${node.due}.`]
  const hint = inheritHint(plan, node.id)
  return hint ? [`The step that needs this is due on ${hint.date}.`] : []
}

/** The haze a node is drawn at: its strength, or 1 when undated or focused (selected, or on the chain). */
export function hazeOf(due: DueView | null, focused: boolean): number {
  return due && !focused ? due.strength : 1
}
