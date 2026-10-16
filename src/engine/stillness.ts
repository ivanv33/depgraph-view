/**
 * Whether the graph has come to rest: no camera glide, no drag, no resize waiting to settle, no plan with steps whose
 * titles have yet to be drawn (`labelsPending`: the load fit has not started, so a still camera says nothing yet), and
 * the title fit has run a measuring pass on a view that held still (`still` counts the frames the view has been
 * unchanged and unflagged; the fit measures on the second). Graph.tsx writes this to `data-still` on its root for the
 * e2e specs to wait on.
 */
export function isStill({
  gliding,
  dragging,
  resizing,
  labelsPending,
  still,
}: {
  gliding: boolean
  dragging: boolean
  resizing: boolean
  labelsPending: boolean
  still: number
}): boolean {
  return !gliding && !dragging && !resizing && !labelsPending && still >= 2
}
