import type { Pt } from './layered.js'

export interface CurveOptions {
  /** Card height in layout units at scale 1. */
  cardH: number
  /** Rendered card size relative to its layout slot (1 unless the zoom clamp kicks in). */
  cardScale: number
  /** Arrowhead length; the line stops at its base so it does not poke through the head. */
  arrow: number
  /** Where the ends meet the node, left of the slot centre, at scale 1 (0 for a card). */
  dx?: number
  /** Distance from the slot centre to the end, at scale 1 (defaults to half the card height). */
  reach?: number
  /** How much larger than its slot each end's node draws (due soon or far off, see NEAR); 1 when omitted. */
  scales?: { start: number; end: number }
  /** Samples per curved segment. */
  steps?: number
}

/**
 * Turns an edge's layout waypoints (prerequisite end, virtual points, dependent end; y down) into a
 * polyline. It works in either direction: in the goal-on-top layout the edge runs upward from the
 * prerequisite's top-centre to the dependent's bottom-centre. Each virtual point becomes a straight
 * vertical run the height of a card, so a long edge stays in its lane through every row it crosses;
 * between rows each hop is a cubic Bézier with vertical tangents (control points at the middle y).
 * The ends move to where the nodes really are when they render at a different size than their slot.
 */
export function edgeCurve(points: Pt[], opts: CurveOptions): { line: Pt[]; tip: Pt } {
  const first = points[0]
  const last = points[points.length - 1]
  const dir = last.y >= first.y ? 1 : -1
  const half = (opts.cardH / 2) * opts.cardScale * dir
  // The ends sit `reach` from the slot centre (the card edge unless a dot says otherwise), `dx` to its left.
  // A scaled node keeps its dot where it is across and grows around it, so only `reach` follows its scale.
  const reach = opts.reach ?? opts.cardH / 2
  const shrink = (scale: number) => (opts.cardH / 2 - reach * opts.cardScale * scale) * dir
  const dx = (opts.dx ?? 0) * opts.cardScale
  const start = { x: first.x - dx, y: first.y - shrink(opts.scales?.start ?? 1) }
  const tip = { x: last.x - dx, y: last.y + shrink(opts.scales?.end ?? 1) }
  const anchors: Pt[] = [start]
  for (const v of points.slice(1, -1)) anchors.push({ x: v.x, y: v.y - half }, { x: v.x, y: v.y + half })
  const prev = anchors[anchors.length - 1]
  const base = tip.y - opts.arrow * dir
  anchors.push({ x: tip.x, y: (base - prev.y) * dir < 0 ? prev.y : base })

  const steps = opts.steps ?? 16
  const line: Pt[] = [anchors[0]]
  for (let i = 0; i + 1 < anchors.length; i++) {
    const a = anchors[i]
    const b = anchors[i + 1]
    if (a.x === b.x) {
      line.push(b)
      continue
    }
    const my = (a.y + b.y) / 2
    for (let k = 1; k <= steps; k++) {
      const t = k / steps
      const u = 1 - t
      const c0 = u * u * u
      const c1 = 3 * u * u * t
      const c2 = 3 * u * t * t
      const c3 = t * t * t
      line.push(k === steps ? b : { x: (c0 + c1) * a.x + (c2 + c3) * b.x, y: c0 * a.y + (c1 + c2) * my + c3 * b.y })
    }
  }
  return { line, tip }
}
