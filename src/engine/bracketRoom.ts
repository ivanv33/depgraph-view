import type { Box } from './titleFit.js'

/** How far (screen px) the selected step's brackets stay off any other circle, its ring included. */
export const BRACKET_CLEAR = 2

/**
 * How wide (screen px) the selected step's brackets may be drawn, as a square centred on its circle at (cx, cy), so that
 * no other circle (each given as its box on screen, with whatever ring is drawn around it) lies inside them or under
 * them: twice the distance to the nearest one, less BRACKET_CLEAR. A square misses a box when it stops short of it
 * across or up and down, so each box counts by the larger of those two gaps. Infinity when nothing is on screen; 0 when a
 * circle comes closer than any square could clear (the layout drew them that close, or on each other): then the
 * brackets are drawn as tight as they go, so they hold as little else as they can. The stylesheet takes the smaller of
 * this and the usual size, but never draws the brackets inside the circle's own ring.
 */
export function bracketRoom(cx: number, cy: number, others: readonly Box[]): number {
  let reach = Infinity
  for (const b of others) {
    const gap = Math.max(b.left - cx, cx - b.right, b.top - cy, cy - b.bottom)
    reach = Math.min(reach, gap - BRACKET_CLEAR)
  }
  return reach === Infinity ? Infinity : Math.max(0, 2 * reach)
}
