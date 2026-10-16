// Pure: the selected step in the page's query (`?plan=<slug>&step=<id>`), so a reload (or a link) opens the same step.
import { ID_RE } from './schema.js'

const STEP = 'step'

/** The step the query names, or null when it names none (or not a well-formed id). */
export function stepFromSearch(search: URLSearchParams | string): string | null {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search
  const id = params.get(STEP)
  return id && ID_RE.test(id) ? id : null
}

/**
 * The query with `step` set to the selected step, or without it when nothing is selected. Other params keep their
 * place; a new `step` goes last. Returns '' when nothing is left, else the query with its '?'.
 */
export function searchWithStep(search: string, id: string | null): string {
  const params = new URLSearchParams(search)
  if (id) params.set(STEP, id)
  else params.delete(STEP)
  const s = params.toString()
  return s ? `?${s}` : ''
}
