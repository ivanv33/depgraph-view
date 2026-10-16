import type { Box } from './titleFit.js'
import { DOT } from './nodeLabel.js'

/**
 * Where the selected step's plate (its title, priority mark and id line on their dark backing) is drawn, so it hides no
 * other step's circle. Pure: the graph measures the plate at a few widths and applies the answer (titleFitDom.ts).
 *
 * The plate always shows its title whole, at its own size: it is never cut. It starts right of the brackets, as wide as
 * its words up to the usual width, centred on its circle. Where that crosses another circle (with its ring, a deck's
 * fan, a "+N" or "held" tag), it is narrowed so it ends before that circle (its words wrap onto more lines), down to
 * PLATE.minChars letters a line, or moved up or down so it clears a circle in the row above or below, while its circle
 * stays beside its words; failing those, it is moved up or down to a corner of the brackets (no further than its bottom
 * level with their top, or its top with their bottom) where it is clear. Of those, the first that crosses no circle is
 * drawn: the usual one before a moved one, a wider one before a narrower one, beside before a corner. A circle the
 * plate still crosses (a crowd seen whole may leave no clear place) shows through a hole cut in the plate's backing
 * (plateHoles), under its words, so it is never hidden either, and the title still reads whole.
 */

/**
 * `gap`: how far (px) the plate stays off a circle it clears. `minChars`: the fewest letters a narrowed line holds.
 * `maxTries`: how many widths are tried at most, the full one among them (each is measured on the page). `step`: the
 * plate px a narrower width is rounded down to a whole number of (titleFitDom.ts).
 */
export const PLATE = { gap: 3, minChars: 7, charEm: 0.55, maxTries: 4, step: 4 } as const

/** Another step's circle and what is drawn round it, on screen. */
export interface Other {
  id: string
  box: Box
  /** A "held" tag: the plate keeps clear of it, the brackets do not (they hold the circles alone). */
  held?: boolean
}

const crosses = (a: Box, b: Box) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1

/** The ids of the circles `plate` crosses, in the order given. */
export function crossed(plate: Box, others: readonly Other[]): string[] {
  return others.filter(o => crosses(plate, o.box)).map(o => o.id)
}

/**
 * The widths (px on screen) to try the plate at, widest first: as drawn in full (`plate`), then each width that ends it
 * `gap` before a circle it crosses there, if that is at least `least` px (minChars letters and the plate's padding).
 */
export function plateWidths(plate: Box, others: readonly Other[], least: number, opts: typeof PLATE = PLATE): number[] {
  const full = plate.right - plate.left
  const out = [full]
  const ends = others
    .filter(o => crosses(plate, o.box))
    .map(o => o.box.left - opts.gap - plate.left)
    .filter(w => w >= least && w < full - 1)
    .sort((a, b) => b - a)
  for (const w of ends) if (out.length < opts.maxTries && out[out.length - 1] - w > 1) out.push(w)
  return out
}

export interface PlateTry {
  /** The width it was drawn at (px on screen). */
  width: number
  /** The plate as drawn at that width, centred on its circle. */
  box: Box
}

export interface PlatePlace {
  width: number
  /** How far (px on screen) the plate is moved down (up when negative) from centred on its circle. */
  dy: number
  /** The circles it still crosses: shown through holes in its backing (plateHoles). */
  covered: string[]
}

/** The selected circle: its centre's height on screen, and how far above and below it the brackets reach (px). */
export interface PlateAnchor {
  cy: number
  reach: number
}

/**
 * Whether the plate where it is drawn now (`box`) can stay there: it crosses no circle, and it is the usual place
 * (`usual`: full width, not moved) or inside `within`.
 */
export function keeps(box: Box, usual: boolean, others: readonly Other[], within?: Box): boolean {
  return crossed(box, others).length === 0 && (usual || !within || (box.top >= within.top && box.bottom <= within.bottom))
}

/**
 * Picks where the plate is drawn from the widths tried (widest first, `tries[0]` its full width). First beside its
 * circle: for each width, centred, then moved just clear of each circle it crosses above or below (nearest move first),
 * keeping the circle's centre at least half a `line` inside the plate's top and bottom. Where none of those is clear,
 * then at a corner of the brackets: moved further up or down, just clear of a circle, as far as the plate's bottom level
 * with the brackets' top (or its top with their bottom). Every place but the usual one stays inside `within` (the free
 * graph area). The first that crosses no circle wins; with none clear, the first that crosses the fewest.
 *
 * Where it was drawn last (`prev`: its width, its move and its box as drawn now) is kept while that still crosses no
 * circle and is the usual place or inside `within`, so a view moving a little does not flip it between places.
 */
export function placePlate(
  tries: readonly PlateTry[],
  at: PlateAnchor,
  line: number,
  others: readonly Other[],
  within?: Box,
  prev?: PlateTry & { dy: number },
  opts: typeof PLATE = PLATE,
): PlatePlace {
  if (prev && keeps(prev.box, prev.dy === 0 && Math.abs(prev.width - tries[0].width) <= 1, others, within)) return { width: prev.width, dy: prev.dy, covered: [] }
  let best: PlatePlace = { width: tries[0].width, dy: 0, covered: crossed(tries[0].box, others) }
  if (best.covered.length === 0) return best
  const consider = (t: PlateTry, dy: number): boolean => {
    const covered = crossed({ ...t.box, top: t.box.top + dy, bottom: t.box.bottom + dy }, others)
    if (covered.length < best.covered.length) best = { width: t.width, dy, covered }
    return covered.length === 0
  }
  const inside = (t: PlateTry, dy: number) => !within || (t.box.top + dy >= within.top && t.box.bottom + dy <= within.bottom)
  /** Moves of `t` that end it `gap` off one of `edges` (a circle's box), nearest first, kept to [lo, hi]. */
  const movesOff = (t: PlateTry, edges: readonly Other[], lo: number, hi: number) =>
    edges
      .flatMap(o => [o.box.top - opts.gap - t.box.bottom, o.box.bottom + opts.gap - t.box.top])
      .filter(dy => dy >= lo && dy <= hi && dy !== 0 && inside(t, dy))
      .sort((a, b) => Math.abs(a) - Math.abs(b))
  // beside its circle
  for (const [i, t] of tries.entries()) {
    if (i > 0 && inside(t, 0) && consider(t, 0)) return best
    const near = others.filter(o => crosses(t.box, o.box))
    for (const dy of movesOff(t, near, at.cy + line / 2 - t.box.bottom, at.cy - line / 2 - t.box.top)) if (consider(t, dy)) return best
  }
  // at a corner of the brackets
  for (const t of tries) {
    const lo = at.cy - at.reach - t.box.bottom
    const hi = at.cy + at.reach - t.box.top
    const column = others.filter(o => o.box.left < t.box.right && o.box.right > t.box.left)
    const ends = [lo, hi].filter(dy => inside(t, dy))
    for (const dy of [...movesOff(t, column, lo, hi), ...ends]) if (consider(t, dy)) return best
  }
  return best
}

/**
 * Where the plate's backing is cut away so each circle it still crosses (`covered`: ids of `others`) shows through it,
 * with the plate's words drawn over it: a hole round each of those boxes that crosses the plate (its circle, a tag), an
 * ellipse `gap` px clear of the box, placed in the plate's own px from its top left (`plate` on screen, at `s` screen px a
 * plate px). As a CSS mask-image whose layers are intersected (viewer.css); '' where there is none.
 */
export function plateHoles(plate: Box, s: number, others: readonly Other[], covered: readonly string[], opts: typeof PLATE = PLATE): string {
  const n = (v: number) => Number(v.toFixed(2))
  return others
    .filter(o => covered.includes(o.id) && crosses(plate, o.box))
    .map(({ box: b }) => {
      const rx = n(((b.right - b.left) / 2 + opts.gap) / s)
      const ry = n(((b.bottom - b.top) / 2 + opts.gap) / s)
      const x = n(((b.left + b.right) / 2 - plate.left) / s)
      const y = n(((b.top + b.bottom) / 2 - plate.top) / s)
      return `radial-gradient(${rx}px ${ry}px at ${x}px ${y}px, #0000 98%, #000 100%)`
    })
    .join(', ')
}

/**
 * The holes in the selected plate as the zoom draws them, worked out when they are cut (titleFitDom.ts) so they can be
 * aimed again on any frame without reading the page (aimHoles). Each step's label is put by the renderer at its anchor,
 * and all it draws (its circle, its tags, the plate) is at its card zoom from there, so each is kept in card px from its
 * own anchor: the selected circle's centre (`dot`); the plate's top from that centre and its size, in the plate's own
 * px (`top`, `w`, `h`); and each covered step's box (its circle with its ring, a deck's fan, a tag): its centre and
 * half size (`parts`).
 */
export interface HoleAim {
  dot: { x: number; y: number }
  top: number
  w: number
  h: number
  parts: { id: string; x: number; y: number; hw: number; hh: number }[]
}

/** A step's label as the renderer draws it on a frame: its anchor on screen (px) and its card zoom. */
export interface Drawn {
  x: number
  y: number
  z: number
}

/**
 * The holes (plateHoles) in the selected plate as drawn on this frame, from where they were cut (`aim`): the selected
 * label at `sel` (with its brackets' room and its style, as written), every covered step at its own place in `at`
 * (one not drawn has none). The plate starts where the stylesheet draws it (plateLeft) and is as large as its own px
 * at this zoom, so a zoom that moves a covered circle against the plate between two title fits moves its hole with it.
 */
export function aimHoles(aim: HoleAim, sel: Drawn & { room: number; style: MarkStyle }, at: ReadonlyMap<string, Drawn>, c: typeof MARK_CSS = MARK_CSS): string {
  const z = sel.style.z
  const boost = Math.max(1, c.minTitle / (c.title * z))
  const s = z * boost
  const cx = sel.x + z * aim.dot.x
  const left = cx + z * (plateLeft(sel.room, sel.style, c) - c.padding * boost - c.centre)
  const top = sel.y + z * aim.dot.y + s * aim.top
  const others: Other[] = []
  for (const p of aim.parts) {
    const d = at.get(p.id)
    if (!d) continue
    const x = d.x + d.z * p.x
    const y = d.y + d.z * p.y
    others.push({ id: p.id, box: { left: x - d.z * p.hw, top: y - d.z * p.hh, right: x + d.z * p.hw, bottom: y + d.z * p.hh } })
  }
  return plateHoles({ left, top, right: left + s * aim.w, bottom: top + s * aim.h }, s, others, [...new Set(aim.parts.map(p => p.id))])
}

/**
 * The plate drawn at a narrower width, as measured once (all in the plate's own px): `at` the width written
 * (--plate-w), its box's `left` and `top` (from where it is drawn in full), width `w` and height `h`; where known, the
 * narrowest width its lines all still fit at (`from`) and the widest no line takes the next one's first word at (`to`),
 * so it wraps just so between them.
 */
export interface Wrapped {
  at: number
  from?: number
  to?: number
  left: number
  top: number
  w: number
  h: number
}

/**
 * The plate at width `at`, from the widths measured before, without measuring it: words wrap onto no fewer lines at a
 * narrower width, so between two widths drawn just as tall it is that tall too, its box as much narrower as the width
 * written (where both say so); and so it is at any width between a measured one's `from` and `to`. Null where no
 * measured width tells it so (or one was measured at it).
 */
export function wrappedAt(seen: readonly Wrapped[], at: number): Wrapped | null {
  const same = seen.find(x => Math.abs(x.at - at) < 0.01)
  if (same) return same
  const near = seen.find(x => (x.from ?? x.at) <= at && at <= (x.to ?? x.at))
  if (near) return { at, left: near.left, top: near.top, w: at + near.w - near.at, h: near.h }
  let lo: Wrapped | undefined
  let hi: Wrapped | undefined
  for (const x of seen) {
    if (x.at < at && (!lo || x.at > lo.at)) lo = x
    if (x.at > at && (!hi || x.at < hi.at)) hi = x
  }
  if (!lo || !hi || Math.abs(lo.h - hi.h) > 0.5 || Math.abs(lo.top - hi.top) > 0.5 || Math.abs(lo.left - hi.left) > 0.5) return null
  const pad = lo.w - lo.at
  if (Math.abs(hi.w - hi.at - pad) > 0.5) return null
  return { at, left: lo.left, top: lo.top, w: at + pad, h: lo.h }
}

/**
 * The stylesheet's numbers for the selected step's brackets and plate (viewer.css, `.node-label[data-selected]`), in
 * card px around a circle centred `centre` px into its card: the brackets `usual` px across on screen (else the circle
 * and `pad` each side), never closer in than the circle's own ring (`ring`, or `overdueRing`) and `least` px on screen
 * each side; the plate starts `gap` px on screen right of them plus its padding (drawn at the words' boost, which keeps
 * the `title` px words at `minTitle` px on screen), and never before `start`. Checked against the stylesheet
 * (titleFitDom.test.ts).
 */
export const MARK_CSS = { usual: 44, pad: 10, ring: 2, overdueRing: 9, least: 4, gap: 3, padding: 6, start: 40, centre: DOT.cx, title: 13, minTitle: 12 } as const

/** The selected circle as the stylesheet sizes its brackets: its radius (card px), its card zoom (--z), its ring. */
export interface MarkStyle {
  dotR: number
  z: number
  overdue: boolean
}

/** How wide (card px) the stylesheet draws the brackets given `room` (--mark-room in card px; Infinity: none). */
export function markSide(room: number, s: MarkStyle, c: typeof MARK_CSS = MARK_CSS): number {
  const usual = Math.max(c.usual / s.z, s.dotR * 2 + 2 * c.pad)
  const ring = s.overdue ? c.overdueRing : c.ring
  return Math.max(Math.min(usual, room), (s.dotR + ring) * 2 + (2 * c.least) / s.z)
}

/** Where (card px from the card's left edge) the stylesheet starts the plate's words, given the brackets' `room`. */
export function plateLeft(room: number, s: MarkStyle, c: typeof MARK_CSS = MARK_CSS): number {
  const boost = Math.max(1, c.minTitle / (c.title * s.z))
  return Math.max(c.start, c.centre + markSide(room, s, c) / 2 + c.gap / s.z + c.padding * boost)
}

/**
 * How far (screen px, at `k` screen px per card px) the plate moves across when the brackets' room goes from `from` to
 * `to`: nothing else about where it is drawn depends on the room. The brackets' pass shifts the plate it read by this,
 * rather than measure it again after writing the room, which would lay the page out on every frame of a glide.
 */
export function plateShift(from: number, to: number, s: MarkStyle, k: number, c: typeof MARK_CSS = MARK_CSS): number {
  return from === to ? 0 : (plateLeft(to, s, c) - plateLeft(from, s, c)) * k
}
