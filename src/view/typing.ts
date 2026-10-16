/** Whether a key press lands where the user is typing (a text field, a select, an editable element). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true
  // jsdom lacks isContentEditable, so check the attribute on the element or an ancestor.
  return target.closest('[contenteditable]:not([contenteditable="false"])') !== null
}
