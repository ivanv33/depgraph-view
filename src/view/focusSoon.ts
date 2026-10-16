/**
 * Move the focus to an element that is drawn a frame or two from now (a newly selected step's label), so the focus
 * never falls to the page. Each frame it looks for `find()`; it gives up, without touching the focus, as soon as the
 * focus is anywhere other than the page or where it was when this was called (the user chose a place meanwhile). When
 * the tries run out with the focus still on the page, `fallback()` (the Group button) takes it. Returns a cancel.
 * `onDone` is called once, however it ends: focused, given up, fallen back, or cancelled.
 */
export function focusSoon(
  find: () => HTMLElement | null | undefined,
  fallback: () => HTMLElement | null | undefined,
  tries = 30,
  onDone?: () => void,
): () => void {
  const start = document.activeElement
  let frame = 0
  let left = tries
  let done = false
  const finish = () => {
    if (done) return
    done = true
    onDone?.()
  }
  const free = () => {
    const now = document.activeElement
    return !now || now === document.body || now === start
  }
  const go = () => {
    if (done) return
    if (!free()) return finish()
    const el = find()
    if (el?.isConnected) {
      el.focus({ preventScroll: true })
      return finish()
    }
    if (--left > 0) {
      frame = requestAnimationFrame(go)
      return
    }
    if (document.activeElement === document.body || !document.activeElement) fallback()?.focus({ preventScroll: true })
    finish()
  }
  frame = requestAnimationFrame(go)
  return () => {
    cancelAnimationFrame(frame)
    finish()
  }
}
