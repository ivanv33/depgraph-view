import { deckParent } from './grouping.js'
import type { Pt } from './layered.js'

/** How long a re-layout takes to glide from the old slots to the new ones. */
export const TWEEN_MS = 300

export const easeOut = (t: number): number => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3

const lerp = (a: Pt, b: Pt, k: number): Pt => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k })

/** Where a node is `t` (0..1, linear in time) of the way from `from` to `to`, eased out. */
export const tween = (from: Pt, to: Pt, t: number): Pt => (t >= 1 ? { ...to } : lerp(from, to, easeOut(t)))

export interface EdgeEnds {
  sourceFrom: Pt
  sourceTo: Pt
  targetFrom: Pt
  targetTo: Pt
}

/**
 * An edge's waypoints at time `t`. With the same number of waypoints as before they move one by one;
 * otherwise the edge starts as its new shape slid so that its ends sit where its nodes were
 * (the slide fades along the edge from the source end to the target end).
 */
export function tweenEdge(to: Pt[], from: Pt[] | undefined, ends: EdgeEnds, t: number): Pt[] {
  const start =
    from && from.length === to.length
      ? from
      : to.map((p, i) => {
          const k = to.length > 1 ? i / (to.length - 1) : 0
          const s = lerp({ x: ends.sourceTo.x - ends.sourceFrom.x, y: ends.sourceTo.y - ends.sourceFrom.y }, { x: ends.targetTo.x - ends.targetFrom.x, y: ends.targetTo.y - ends.targetFrom.y }, k)
          return { x: p.x - s.x, y: p.y - s.y }
        })
  return to.map((p, i) => tween(start[i], p, t))
}

/**
 * Where a node that was not drawn before starts: a deck at its parent's old place, a member that just
 * opened at the deck it was in (or else at a node that needs it). null when nothing helps.
 */
export function originOf(id: string, shown: Map<string, Pt>, hidden: Map<string, string[]>, dependentsOf: (id: string) => string[]): Pt | null {
  const here = shown.get(id)
  if (here) return here
  const parent = deckParent(id)
  if (parent) return shown.get(parent) ?? null
  for (const deck of hidden.get(id) ?? []) {
    const at = shown.get(deck)
    if (at) return at
  }
  for (const d of dependentsOf(id)) {
    const at = shown.get(d)
    if (at) return at
  }
  return null
}
