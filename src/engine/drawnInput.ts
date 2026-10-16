import { dueViewOf } from './due.js'
import { DECK_LIST_MAX, type DeckView } from './grouping.js'
import { LAYOUT } from './layered.js'
import { deckHeight, deckWidth, slotTail } from './nodeLabel.js'
import type { Plan, Status } from './schema.js'

/** One drawn card as the layout takes it, with the title and status the graph's cache keeps. */
export interface DrawnInput {
  id: string
  depends_on: string[]
  title: string
  status: Status
  h?: number
  w?: number
  tail?: number
}

/**
 * What the graph lays out for a deck view: every drawn card with its size. The one place this is decided, so the graph
 * and the arrow keys (walk.ts) lay out the same thing.
 */
export function layoutInput(plan: Plan, view: DeckView, today: string): DrawnInput[] {
  const byId = new Map(plan.nodes.map(n => [n.id, n]))
  return view.nodes.map(n => {
    const real = byId.get(n.id)
    const deck = view.decks.get(n.id)
    const title = real?.title ?? `${deck?.members.length} steps`
    // A deck's list (and its line of states) is taller than a card: the layout keeps the rows around it clear of it.
    const h = deck ? deckHeight(Math.min(deck.members.length, DECK_LIST_MAX), deck.members.length > DECK_LIST_MAX) : undefined
    // ...and wider: a step beside it (or the deck itself) drawn larger for its date never reaches the other's circle.
    const w = deck ? deckWidth(LAYOUT.cardW, LAYOUT.colGap) : undefined
    // A step drawn larger for a near date keeps room on its right, so its words end before the next step's circle.
    const scale = !deck && real ? (dueViewOf(plan, real, today)?.scale ?? 1) : 1
    const tail = slotTail(scale, LAYOUT.cardW, LAYOUT.colGap) || undefined
    return { id: n.id, depends_on: n.depends_on, title, status: real?.status ?? 'todo', h, w, tail }
  })
}
