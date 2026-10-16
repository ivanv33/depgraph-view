/**
 * Which step titles to draw, so no two are drawn on top of each other. Pure: it takes each drawn label's boxes on
 * screen (its circle, its title as drawn in full, its due line) and a rank, and decides per label whether its words
 * show in full, cut short (one or two lines with an ellipsis, as wide as the room before the next thing drawn; the due
 * line is left to the tooltip), or not at all (the circle alone; hover, focus or a zoom shows them). The graph measures
 * the labels and applies the result; this file is the whole rule, so changing it is changing this file.
 */

/** How a label's words are drawn. */
export type Fit = 'full' | 'short' | 'dot'

/** A box on screen, in px. */
export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/** Lower draws first; on a tie the plan order, then the id. */
export interface Rank {
  /**
   * Below 0: drawn as it stands, placed first (the graph has not measured it). 0 selected (or its deck's list open),
   * 1 its chain, 2 focused, 3 the goal, 4 a near or late date, 5 high priority,
   * 6 one of the goal's own needs, 7 ready or being done, 8 the rest.
   */
  tier: number
  order: number
  /**
   * In the plan's top rows (a goal, or one of a goal's own needs): its words keep clear of the goal's arrows to its
   * needs (`overhead`), and cut short may also draw just clear of them, or a whole line higher than beside its circle,
   * over its circle (for a need right under its goal, the space between the two rows), when no try beside its circle
   * clears.
   */
  top?: boolean
}

export interface FitInput {
  id: string
  rank: Rank
  /**
   * The circle (a deck: its whole fan; a held step: with its tag; the selected step: with its brackets): always drawn,
   * so every other label's words keep clear of it.
   */
  dot: Box
  /** How far (px) what is drawn around the circle reaches past it (the overdue ring, the chain outline): kept clear too. */
  ring?: number
  /** The title as drawn in full, every line of it (a deck: its title and list; the selected step: its whole plate). */
  title: Box
  /** The due line under it, if the step has a date. */
  due?: Box
  /** One title line's height, px. */
  line: number
  /**
   * How wide the priority mark and its gap before the words are, px (0 or left out for none): part of the title box,
   * kept when the title is cut, so a cut line must hold `minChars` letters besides it.
   */
  mark?: number
  /** How wide the words may draw, px: a title cut short is never wider. */
  maxWidth: number
  /** The title's font size as drawn, px. */
  font: number
  /**
   * Where (screen x, px) a line runs up past this label's row to the right of its circle (a block's lane): its words
   * end before it, as before a circle; so do the words of any other label in that row.
   */
  wall?: number
  /**
   * How far up and down (screen y, px) the line at `wall` is drawn, when the graph knows: its words, and every other
   * label's, keep clear of it there only. Left out, it is taken as drawn over the label's row and a line past either side.
   */
  wallSpan?: { top: number; bottom: number }
  /**
   * The arrows drawn from the plan's goals' own needs up into the goals (screen px, a box per stretch of line, as wide as
   * the line), which at a whole-plan zoom run flat across between the two rows. A step in the plan's top rows (rank.top)
   * keeps its words clear of them by the gap in every try, as it does a lane: they are cut before one rising past their
   * end and never drawn with one running through them. Any other step's words do not mind them.
   */
  overhead?: readonly Box[]
  /** What the last run decided for this label, for hysteresis. */
  prev?: Fit
  /**
   * When it was cut short last run: on how many lines, how far moved (the leniency holds for that cut only) and how wide
   * (px; the leniency keeps that width, it never widens the cut).
   */
  prevCut?: { lines: number; dy: number; width?: number }
}

export interface FitOut {
  fit: Fit
  /** For 'short': how wide the words may draw, px. */
  width?: number
  /** For 'short': on how many lines (1 or 2). */
  lines?: number
  /** For 'short': how far (px) the words draw below (above, when negative) the middle of where they draw in full. */
  dy?: number
}

/**
 * The numbers of the rule. `floor`: a title drawn smaller than this (px) is hidden rather than drawn unreadable, except
 * for the selected step, its chain and the focused step (tiers below `firstTiers`). `slack`: a title already shown
 * stays shown while it overlaps by this much or less (px). `gap`: a hidden or shortened title shows (more) only once it
 * clears everything by this much. `floorSlack`: the same for the floor, in px of font size. `minChars`: a title is cut
 * short only if a line holds about this many letters (an average letter taken as `charEm` of the font size). `lane`: how
 * far (px) either side of a label's wall the line drawn there is taken to reach.
 */
export const FIT = { floor: 9, slack: 2, gap: 2, floorSlack: 0.25, minChars: 5, charEm: 0.55, firstTiers: 3, lane: 2 } as const

export interface RankReasons {
  order: number
  selected: boolean
  chain: boolean
  focused: boolean
  /** A step nothing else needs: what the plan is for. */
  goal: boolean
  /** Due within a week, or overdue. */
  dueNear: boolean
  high: boolean
  /** Needed directly by the goal. */
  need: boolean
  /** Ready to start, or being done. */
  ready: boolean
}

/** A label's rank from why it matters: the highest reason counts; the plan order breaks ties. */
export function rankOf(r: RankReasons): Rank {
  const tier = r.selected ? 0 : r.chain ? 1 : r.focused ? 2 : r.goal ? 3 : r.dueNear ? 4 : r.high ? 5 : r.need ? 6 : r.ready ? 7 : 8
  return r.goal || r.need ? { tier, order: r.order, top: true } : { tier, order: r.order }
}

/** Uniform grid of placed boxes, so a query looks only at nearby boxes, not at every label. */
const CELL = 64

interface Placed extends Box {
  owner: string
}

class Grid {
  private cells = new Map<number, Placed[]>()
  private key(cx: number, cy: number) {
    return (cx + 32768) * 65536 + (cy + 32768)
  }
  private span(b: Box) {
    return [Math.floor(b.left / CELL), Math.floor(b.top / CELL), Math.floor(b.right / CELL), Math.floor(b.bottom / CELL)]
  }
  add(b: Placed) {
    const [x0, y0, x1, y1] = this.span(b)
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const k = this.key(x, y)
        const list = this.cells.get(k)
        if (list) list.push(b)
        else this.cells.set(k, [b])
      }
  }
  /** Every placed box (not `owner`'s) whose cell meets `b`, each once. */
  near(b: Box, owner: string): Placed[] {
    const [x0, y0, x1, y1] = this.span(b)
    const out: Placed[] = []
    const seen = new Set<Placed>()
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const list = this.cells.get(this.key(x, y))
        if (list)
          for (const p of list)
            if (p.owner !== owner && !seen.has(p)) {
              seen.add(p)
              out.push(p)
            }
      }
    return out
  }
}

const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
/** `b` grown by `d` px on every side (shrunk when `d` is negative). */
const grow = (b: Box, d: number): Box => ({ left: b.left - d, top: b.top - d, right: b.right + d, bottom: b.bottom + d })

type Clear = (boxes: Box[], owner: string, d: number) => boolean

/** The overhead arrows a top row's words keep clear of (none for any other step's). */
const arrowsOf = (l: FitInput): readonly Box[] => (l.rank.top ? (l.overhead ?? []) : [])
/** Whether any of `boxes` comes within the gap of an overhead arrow `l` keeps clear of. */
const struck = (l: FitInput, boxes: Box[], opts: typeof FIT) => arrowsOf(l).some(o => boxes.some(b => overlaps(grow(b, Math.max(0, opts.gap)), o)))

/**
 * Decides every label's fit, greedily by rank: the selected step, its chain, the focused step, the goal, steps due soon
 * or late, high priority, the goal's own needs, ready or doing, then the rest in plan order. Each takes the most it can
 * (full; else cut short: two lines, then one, beside its circle, centred or moved up or down by up to the circle's half
 * height when the row above or below is close, a goal or a goal's own need also just clear of the goal's arrows to
 * its needs or a line up; else the circle alone) without crossing anything already placed or any other step's circle
 * and what is drawn around it (nor, for a goal or a goal's own need, the goal's arrows to its needs); so a label never loses its words to make room for a lower-ranked
 * one. The selected step's title always shows in full, placed first. Deterministic for the same input, and settled: it
 * decides again from its own answer until that answer gives itself back (at most SETTLE_RUNS times), so its answer fed
 * back as `prev` on the next run gives the same answer.
 */
export function fitTitles(labels: readonly FitInput[], opts: typeof FIT = FIT): Map<string, FitOut> {
  let cur = labels
  let out = fitOnce(cur, opts)
  for (let i = 1; i < SETTLE_RUNS && !settled(cur, out); i++) {
    cur = labels.map(l => {
      const f = out.get(l.id)!
      return { ...l, prev: f.fit, prevCut: f.fit === 'short' ? { lines: f.lines!, dy: f.dy!, width: f.width } : undefined }
    })
    out = fitOnce(cur, opts)
  }
  return out
}

/** How many times fitTitles decides at most: a chain of labels each giving the next room settles one per run. */
const SETTLE_RUNS = 8

/** Whether `out` is what `labels` say was drawn last run: deciding again from it gives it back. */
const settled = (labels: readonly FitInput[], out: Map<string, FitOut>) =>
  labels.every(l => {
    const f = out.get(l.id)!
    return f.fit === l.prev && (f.fit !== 'short' || (l.prevCut?.lines === f.lines && l.prevCut?.dy === f.dy))
  })

function fitOnce(labels: readonly FitInput[], opts: typeof FIT): Map<string, FitOut> {
  const order = [...labels].sort((a, b) => a.rank.tier - b.rank.tier || a.rank.order - b.rank.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const grid = new Grid()
  // every circle again on its own, for words moved off their row (see shortFit)
  const circles = new Grid()
  for (const l of labels) {
    grid.add({ ...grow(l.dot, l.ring ?? 0), owner: l.id })
    circles.add({ ...grow(l.dot, l.ring ?? 0), owner: l.id })
  }
  // a lane beside a label: a thin upright box as tall as it is drawn (else as its row, a line past either side), owned
  // by no label (kept even where it runs close past the circle: the words start just past a large one)
  for (const l of labels)
    if (l.wall !== undefined) {
      const top = l.wallSpan?.top ?? Math.min(l.dot.top, l.title.top) - l.line
      const bottom = l.wallSpan?.bottom ?? Math.max(l.dot.bottom, l.title.bottom, l.due?.bottom ?? -Infinity) + l.line
      grid.add({ left: l.wall - opts.lane, top, right: l.wall + opts.lane, bottom, owner: '' })
    }
  const out = new Map<string, FitOut>()
  // A lane is cleared by the gap, shown before or not: the slack is for titles and circles, which a hair's overlap
  // leaves legible; a line through the words' first or last letter does not (and a lane does not move as words do).
  const lane = Math.max(0, opts.gap)
  const clear: Clear = (boxes, owner, d) =>
    boxes.every(b => grid.near(grow(b, Math.max(d, lane)), owner).every(p => !overlaps(grow(b, p.owner === '' ? Math.max(d, lane) : d), p)))
  const place = (boxes: Box[], owner: string) => boxes.forEach(b => grid.add({ ...b, owner }))

  for (const l of order) {
    const first = l.rank.tier < opts.firstTiers
    const shown = l.prev === 'full' || l.prev === 'short'
    // Below the floor (by a hair more when it was hidden), the words are not drawn, except for the first tiers.
    const floor = shown ? opts.floor - opts.floorSlack : opts.floor
    if (!first && l.font < floor) {
      out.set(l.id, { fit: 'dot' })
      continue
    }
    const full = l.due ? [l.title, l.due] : [l.title]
    // The selected step is always whole (placed first, so the rest keep clear of it). Shown stays shown while it
    // overlaps by `slack` at most; anything else must clear by `gap`.
    const d = l.prev === 'full' ? -opts.slack : opts.gap
    if (l.rank.tier <= 0 || (clear(full, l.id, d) && !struck(l, full, opts))) {
      place(full, l.id)
      out.set(l.id, { fit: 'full' })
      continue
    }
    const short = shortFit(l, grid, circles, opts, clear)
    if (short) {
      place([short.box], l.id)
      out.set(l.id, { fit: 'short', width: short.width, lines: short.lines, dy: short.dy })
      continue
    }
    out.set(l.id, { fit: 'dot' })
  }
  return out
}

/**
 * How wide words starting at `left` may draw in `band` (`natural` at most) before what is placed there (a lane: in
 * `lanes`); null when something is placed where they start.
 */
function roomIn(band: Box, left: number, natural: number, grid: Grid, owner: string, gap: number, lanes: Box = band): number | null {
  let room = natural
  for (const p of grid.near(lanes, owner)) {
    if (!overlaps(p.owner === '' ? lanes : band, p)) continue
    // Something already there where the words start: no room at all.
    if (p.left <= left + gap) return null
    room = Math.min(room, p.left - gap - left)
  }
  return room
}

/**
 * The title cut short: one box from the words' left edge, as wide as the room before the first thing placed to its
 * right in its band, `lines` lines tall, centred where the full words are, or moved up or down by up to the circle's
 * half height (so it still draws beside it), or, for a step in the plan's top rows (rank.top), just clear of the
 * goal's arrows to its needs on its circle's side, a whole line up, into the row above, or just clear of those arrows on
 * the other side, in that order, never more than two lines from where the words draw in full; moved off its row so,
 * the words still end before the next circle in it. Two lines (when the title needs more than one) before one, centred before moved; then, only if none of those fits, the same tries cut before what comes within the gap over or under
 * the words as well; null when no try both clears what is placed and holds `minChars` letters a line.
 */
function shortFit(l: FitInput, grid: Grid, circles: Grid, opts: typeof FIT, clear: Clear): { box: Box; width: number; lines: number; dy: number } | null {
  const blockBottom = l.due ? Math.max(l.title.bottom, l.due.bottom) : l.title.bottom
  const cy = (l.title.top + blockBottom) / 2
  const left = l.title.left
  const oneLine = l.title.bottom - l.title.top <= l.line * 1.5
  const natural = Math.min(l.maxWidth, oneLine ? l.title.right - l.title.left : l.maxWidth)
  const half = (l.dot.bottom - l.dot.top) / 2
  const tries = oneLine ? [1] : [2, 1]
  const gap = Math.max(0, opts.gap)
  const arrows = arrowsOf(l)
  // Beside the circle: centred, moved up, moved down; for a step in the top rows, then, where the goal's arrows to its
  // needs cross its words' columns within two lines (`h` tall), just clear of them on its circle's side; a whole line
  // up; and just clear of them on the other side. Never more than two lines from where the words draw in full.
  const shiftsFor = (h: number): number[] => {
    if (!l.rank.top) return [0, -half, half]
    const reach = h / 2 + 2 * l.line
    const near = arrows.filter(o => o.right > left - gap && o.left < left + natural + gap && o.bottom > cy - reach && o.top < cy + reach)
    if (!near.length) return [0, -half, half, -l.line]
    const top = Math.min(...near.map(o => o.top))
    const bottom = Math.max(...near.map(o => o.bottom))
    // (a hair past the gap, so the words' box grown by the gap does not meet the arrows' by rounding)
    const under = bottom + gap - (cy - h / 2) + 1e-6
    const over = top - gap - (cy + h / 2) - 1e-6
    const [own, other] = (l.dot.top + l.dot.bottom) / 2 > (top + bottom) / 2 ? [under, over] : [over, under]
    const within = (dy: number) => (Math.abs(dy) <= 2 * l.line ? [dy] : [])
    return [...new Set([0, -half, half, ...within(own), -l.line, ...within(other)])]
  }
  // Words moved off their row (past the circle's half height) still end before the next circle in it, the gap short:
  // that circle's words keep room to move off the row beside it too.
  const inRow = roomIn({ left, top: l.dot.top, right: left + natural + gap, bottom: l.dot.bottom }, left, natural, circles, l.id, gap) ?? natural
  // Every try once as it stands; then, only if none fits, once more cutting the words before what comes within the gap
  // above or below them too (which they must clear as well, so as it stands such a try fails whatever its width): a
  // title is hidden only when no cut clears, never for a circle or line a px over or under its words.
  for (const near of [false, true])
    for (const lines of tries) {
      const shifts = shiftsFor(lines * l.line)
      // which of them a cut drawn `dy` from the middle last run was: the nearest (the circle's size changes with the zoom)
      const shiftOf = (dy: number) => shifts.reduce((a, b) => (Math.abs(b - dy) < Math.abs(a - dy) ? b : a))
      for (const dy of shifts) {
        // The cut drawn last run (or, after the full words, the first one tried) stays while it overlaps by `slack` at
        // most, its band a little shorter (so a hair's overlap above or below does not hide it); any other must clear.
        const shown =
          l.prev === 'short' ? !!l.prevCut && l.prevCut.lines === lines && shiftOf(l.prevCut.dy) === dy : l.prev === 'full' && lines === tries[0] && dy === 0
        const d = shown ? -opts.slack : opts.gap
        const h = lines * l.line
        const top = cy - h / 2 + dy
        // The band reaches as far past the words' natural end as they must clear (the gap; a cut shown before, none):
        // something within it (a circle just past where the words end) cuts them that far before it, as it does when they
        // would run over it, rather than leave them uncut and failing to clear it (hidden, where an identical label a px
        // farther from its neighbour shows); a cut shown before keeps its slack. Above and below, the band is the words'
        // lines (a shown cut's a little shorter), or on the second pass as far past them as they must clear. A lane is
        // cleared by the gap above and below, shown before or not (see `clear`): for a shown cut and on the second pass
        // its band reaches that far.
        const above = near ? Math.max(0, d) : Math.min(0, d)
        const band: Box = { left, top: top - above, right: left + natural + Math.max(0, d), bottom: top + h + above }
        const lanes: Box = near || shown ? { ...band, top: top - Math.max(0, opts.gap), bottom: top + h + Math.max(0, opts.gap) } : band
        // The goal's arrows to its needs, for a top row, as a lane: cleared by the gap above and below, shown or not.
        const inBand = roomBefore(arrows, { ...band, top: top - gap, bottom: top + h + gap }, left, roomIn(band, left, natural, grid, l.id, opts.gap, lanes), gap)
        if (inBand === null) continue
        const roomed = Math.abs(dy) > half + 1e-9 ? Math.min(inBand, inRow) : inBand
        // The slack keeps a cut shown at the width it was drawn, never wider across its lines: it grows only into room
        // that clears its lines by the gap above and below (a circle or title reaching them by a hair, or coming within
        // the gap over or under them, still cuts it there; one within the gap past the words' end does not), so a cut
        // decided without the slack (a fresh run) is given back as it is.
        const was = shown ? l.prevCut?.width : undefined
        const clearing: Box = { ...band, top: top - Math.max(0, opts.gap), bottom: top + h + Math.max(0, opts.gap) }
        const room = was === undefined ? roomed : Math.min(roomed, Math.max(was, roomIn(clearing, left, natural, grid, l.id, opts.gap, clearing) ?? 0))
        // The priority mark before the words keeps its width: the letters get the rest.
        if (room - (l.mark ?? 0) < opts.minChars * opts.charEm * l.font) continue
        const box = { left, top, right: left + room, bottom: top + h }
        if (clear([box], l.id, d) && !struck(l, [box], opts)) return { box, width: room, lines, dy }
      }
    }
  return null
}

/** `room` cut before the first of `arrows` in `band` right of `left` (the gap before it); null when one meets it where the words start. */
function roomBefore(arrows: readonly Box[], band: Box, left: number, room: number | null, gap: number): number | null {
  if (room === null) return null
  for (const o of arrows) {
    if (!overlaps(band, o)) continue
    if (o.left <= left + gap) return null
    room = Math.min(room, o.left - gap - left)
  }
  return room
}
