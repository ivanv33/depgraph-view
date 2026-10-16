import { dueLabel, dueViewOf, type DueView } from './due.js'
import { STATE_ORDER } from './grouping.js'
import type { NodeState } from './readiness.js'
import type { Plan, PlanNode, Priority } from './schema.js'

/** A box on screen, in px. */
export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/** Space kept between the list and an edge or what it must not cover. */
export const LIST_MARGIN = 8
/** The list's widest and tallest, in px: past that its rows scroll. Wide enough for most titles on one line (a longer
 *  one takes two); never wider than the free area (placeDeckList). */
export const LIST_SIZE = { w: 360, h: 440 } as const
/** A side panel shorter than this is collapsed to a bar at the top right: it takes a top strip, not the right side. */
const BAR_MAX = 120

/**
 * Where a deck's list may go: the window less a margin, below the toolbar, left of the open side panel (a collapsed
 * one, a short bar at the top right, is only kept clear above) and above the bottom card.
 */
export function freeArea(view: { w: number; h: number }, around: { toolbar?: Box; panel?: Box; hud?: Box }): Box {
  const m = LIST_MARGIN
  let top = m
  let right = view.w - m
  let bottom = view.h - m
  if (around.toolbar) top = Math.max(top, around.toolbar.bottom + m)
  if (around.panel) {
    if (around.panel.bottom - around.panel.top < BAR_MAX) top = Math.max(top, around.panel.bottom + m)
    else right = Math.min(right, around.panel.left - m)
  }
  if (around.hud) bottom = Math.min(bottom, around.hud.top - m)
  return { left: m, top, right, bottom }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi))

/**
 * Where a deck's list sits, given the deck's circle and text block (`anchor`) and the list's own size (`want`): right of
 * the deck, its header level with the circle; left of it when the right has no room; else moved inside the free area.
 * It ends above any box in `below` (the legend in the bottom-left corner) that it would otherwise reach across. It is
 * never wider or taller than the room it has (its rows scroll), so nothing cuts it off or covers it.
 */
export function placeDeckList(
  anchor: { dot: Box; text: Box },
  want: { w: number; h: number },
  free: Box,
  below: Box[] = [],
): { left: number; top: number; width: number; maxHeight: number } {
  const m = LIST_MARGIN
  const width = Math.min(want.w, free.right - free.left)
  const right = anchor.text.right + m
  const left = anchor.dot.left - m - width
  const x = right + width <= free.right ? right : left >= free.left ? left : clamp(right, free.left, free.right - width)
  let bottom = free.bottom
  for (const b of below) if (b.left < x + width && x < b.right && b.top - m > free.top + 120) bottom = Math.min(bottom, b.top - m)
  const maxHeight = Math.min(LIST_SIZE.h, bottom - free.top)
  const h = Math.min(want.h, maxHeight)
  const y = clamp(anchor.dot.top - 12, free.top, bottom - h)
  return { left: x, top: y, width, maxHeight }
}

export interface DeckRow {
  id: string
  title: string
  state: NodeState
  due: DueView | null
  /** The date as the row shows it (dueLabel without how near: a row has no room), or null with none. */
  dateText: string | null
  /** The step's stored priority (normal where it has none): its row shows the priority mark. */
  priority: Priority
}

/** A deck's steps as the list shows them: every one, with its state and date (said as dueLabel says it), by state (STATE_ORDER), then plan order. */
export function rowsOf(members: PlanNode[], states: Map<string, NodeState>, plan: Plan, today: string): DeckRow[] {
  const rows = members.map((m): DeckRow => {
    const due = dueViewOf(plan, m, today)
    const dateText = due ? dueLabel(due.date, today, { inherited: !!due.inherited }) : null
    return { id: m.id, title: m.title, state: states.get(m.id) ?? 'waiting', due, dateText, priority: m.priority ?? 'normal' }
  })
  return rows.map((r, i) => ({ r, i })).sort((a, b) => STATE_ORDER.indexOf(a.r.state) - STATE_ORDER.indexOf(b.r.state) || a.i - b.i).map(x => x.r)
}
