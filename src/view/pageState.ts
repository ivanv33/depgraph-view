import { stepFromSearch } from '../engine/pageUrl.js'
import type { Plan } from '../engine/schema.js'

/** The step the page opens on: the query's `?step=` when the plan has that step, else none. */
export function initialStep(search: string, plan: Plan): string | null {
  const id = stepFromSearch(search)
  return id !== null && plan.nodes.some(n => n.id === id) ? id : null
}
