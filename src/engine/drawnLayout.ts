/**
 * The graph as drawn for a selection: the same deck view and layout input the graph computes, so tests and callers
 * read positions exactly as the eye sees them. Nothing here changes the plan.
 */
import { layoutInput } from './drawnInput.js'
import { deckView, type DeckView } from './grouping.js'
import { layoutPlan, type Layout } from './layered.js'
import type { Plan } from './schema.js'

export interface Drawn {
  view: DeckView
  layout: Layout
}

/**
 * The graph as drawn for this selection: the same deck view and the same layout input (layoutInput) Graph.tsx lays
 * out. `opened` is the done decks the graph has opened by a click under this selection (their steps are drawn).
 */
export function drawnLayout(plan: Plan, selectedId: string | null, grouping: boolean, today: string, opened: ReadonlySet<string> = new Set()): Drawn {
  const view = deckView(plan, selectedId, grouping, opened)
  return { view, layout: layoutPlan(layoutInput(plan, view, today)) }
}
