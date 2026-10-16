/** What a click on the graph's empty canvas does (after a press that only closed a deck's list is set aside). */
export type BackgroundAction = 'selected' | 'add' | 'deselect' | 'cancelLink' | 'ignore'

/**
 * `selected`: the click landed on the selected step's own text, so it is a click on that step. `cancelLink`: a
 * Shift+click link is pending (shiftLink.ts): the click only ends it, adding no step and keeping the selection. `add`:
 * Shift+click on empty canvas asks for a new step's name, as N does (not while L is armed). `deselect`: anything else,
 * as before. `ignore`: the second or later press of a multi-click (`MouseEvent.detail` above 1, a double-click or two quick
 * clicks): the first press may have moved the step's title away (the selection glide), so this one changes nothing.
 */
export function backgroundAction({ shift, arming, linking, onText, detail = 1 }: { shift: boolean; arming: boolean; linking: boolean; onText: boolean; detail?: number }): BackgroundAction {
  if (detail > 1) return 'ignore'
  if (onText) return 'selected'
  if (linking) return 'cancelLink'
  if (shift && !arming) return 'add'
  return 'deselect'
}

/** What the host's props leave of an action: `add` needs `onAddAt`, and without it the click only deselects. */
export function backgroundEffect(action: BackgroundAction, has: { addAt: boolean }): BackgroundAction {
  return action === 'add' && !has.addAt ? 'deselect' : action
}
