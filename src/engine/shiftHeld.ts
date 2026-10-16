/** Whether Shift is held, from window key and blur events. Shift released while the window was unfocused shows as a key event with `shiftKey` false. */
export interface ShiftHeldEvent {
  type: 'keydown' | 'keyup' | 'blur'
  key?: string
  shiftKey?: boolean
}

export function shiftHeld(prev: boolean, ev: ShiftHeldEvent): boolean {
  if (ev.type === 'blur') return false
  if (ev.key === 'Shift') return ev.type === 'keydown'
  if (ev.shiftKey === false) return false
  return prev
}
