export interface SelectionState {
  selectedId: string | null
  arming: boolean
}

export type SelectionEvent =
  | { type: 'selectNode'; id: string }
  | { type: 'focusNode'; id: string }
  | { type: 'background' }
  | { type: 'armLink' }
  | { type: 'disarm' }
  | { type: 'escape' }
  | { type: 'clear' }

export type SelectionEffect =
  | { type: 'none' }
  | { type: 'toast'; message: string }
  | { type: 'link'; dependencyId: string; dependentId: string }

export const initialSelection: SelectionState = { selectedId: null, arming: false }

const none: SelectionEffect = { type: 'none' }

export function selectionStep(state: SelectionState, event: SelectionEvent): { state: SelectionState; effect: SelectionEffect } {
  switch (event.type) {
    case 'selectNode':
      // A link to the selection itself is asked for too: the page's one link path refuses it with its toast.
      if (state.arming && state.selectedId) {
        return { state, effect: { type: 'link', dependencyId: event.id, dependentId: state.selectedId } }
      }
      return { state: { selectedId: event.id, arming: false }, effect: none }
    case 'focusNode':
      return { state: { selectedId: event.id, arming: false }, effect: none }
    case 'background':
    case 'escape':
      if (state.arming) return { state: { ...state, arming: false }, effect: none }
      return { state: initialSelection, effect: none }
    case 'armLink':
      if (!state.selectedId) return { state, effect: { type: 'toast', message: 'select a node first' } }
      return { state: { ...state, arming: true }, effect: none }
    case 'disarm':
      return { state: { ...state, arming: false }, effect: none }
    case 'clear':
      return { state: initialSelection, effect: none }
  }
}

export interface NodeSignal {
  id: string
  seq: number
}

export function nextSignal(prev: NodeSignal | null, id: string): NodeSignal {
  return { id, seq: (prev?.seq ?? 0) + 1 }
}

/** How long a step marked from outside stays marked, ms. */
export const MARK_MS = 2400
/** How often, at most, the marks are put back while any is due, ms. */
export const MARK_CHECK_MS = 100

/** The marks due at `now`: the ids still marked, and the ids whose time is up (dropped from `until`). */
export function marksDue(until: Map<string, number>, now: number): { shown: string[]; ended: string[] } {
  const shown: string[] = []
  const ended: string[] = []
  for (const [id, t] of until) {
    if (t > now) shown.push(id)
    else {
      ended.push(id)
      until.delete(id)
    }
  }
  return { shown, ended }
}
