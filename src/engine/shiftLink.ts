/**
 * Shift+click linking: a Shift+click on a step arms a link from it (an arrow follows the pointer while Shift is held);
 * a second Shift+click on another step makes that step depend on the first. Nothing is selected until the link lands.
 */
export interface ShiftLinkState {
  /** The step the pending link starts at (the dependency), or null when no link is pending. */
  from: string | null
}

export type ShiftLinkEvent =
  /** A Shift+click on a label: a step, or a deck (no step to link). */
  | { type: 'shiftPick'; id: string; deck?: boolean }
  /** Shift released, a move without Shift, the window losing focus, Escape, a canvas click, the source no longer drawn. */
  | { type: 'cancel' }
  /** A pick without Shift: it goes on as ever, and ends any pending link. */
  | { type: 'plainPick' }

export type ShiftLinkEffect = { type: 'none' } | { type: 'shake'; id: string } | { type: 'link'; from: string; to: string }

export const idleLink: ShiftLinkState = { from: null }

const none: ShiftLinkEffect = { type: 'none' }

export function shiftLinkStep(state: ShiftLinkState, event: ShiftLinkEvent): { state: ShiftLinkState; effect: ShiftLinkEffect } {
  switch (event.type) {
    case 'shiftPick':
      if (event.deck) return { state, effect: { type: 'shake', id: event.id } }
      if (state.from === null) return { state: { from: event.id }, effect: none }
      if (state.from === event.id) return { state: idleLink, effect: none }
      return { state: idleLink, effect: { type: 'link', from: state.from, to: event.id } }
    case 'cancel':
    case 'plainPick':
      return { state: state.from === null ? state : idleLink, effect: none }
  }
}
