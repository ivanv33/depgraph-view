/**
 * The cue at the edge of the view for marked chain steps off screen. A selection is framed with its neighbours only
 * (frame.ts), so the far ends of its chain can lie past the edges of the free area; each edge they lie past gets one
 * small cue saying how many, in the colour of the line that runs off there.
 */

/** A marked chain step's circle on screen: `up` a step the selection needs, `down` one that needs it. */
export type CuePoint = { x: number; y: number; kind: 'up' | 'down' }
export type CueSide = 'top' | 'bottom' | 'left' | 'right'
/**
 * `at` is where along its edge the cue sits: an x on the top and bottom edges, a y on the left and right ones. `inset`,
 * when set, is how far in from its edge the pill is drawn (just inside a cover lying on its place), else CUE_INSET.
 */
export type EdgeCue = { side: CueSide; count: number; kind: 'up' | 'down' | 'both'; at: number; inset?: number }
type Area = { left: number; top: number; right: number; bottom: number }
/**
 * Chrome drawn over the graph. `side`, when set, is the edge it is fixed to (the bottom card, `bottom-4`), which its
 * shape cannot tell once it is taller than the free area: clipped to it, it touches the top edge as well as the bottom.
 */
export type Cover = Area & { side?: CueSide }

/** Pixels a cue keeps from the corners of its edge. */
export const CUE_MARGIN = 48
/** Pixels between a cue and the edge of the free area it sits at. */
export const CUE_INSET = 6
/** Pixels a cue keeps clear of any card it slides past. */
export const CUE_GAP = 4

/**
 * What a cue's pill takes on screen, worked out from what it says ("↑ 14 more", 11 px mono at about 6.7 px a letter,
 * 8 px padding each side and a 1 px border), so nothing is measured on the page to place it. A little generous.
 */
export function cueSize(count: number): { w: number; h: number } {
  const letters = `↑ ${count} more`.length
  return { w: Math.ceil(letters * 6.8 + 18), h: CUE_H }
}
/** A pill's height. */
const CUE_H = 18

/** The least height the free area keeps between its top and its bottom edge: a top pill's band and a bottom one's. */
export const CUE_ROOM = 2 * (CUE_INSET + CUE_H)

/**
 * The free area's bottom edge (screen px) under the bottom card: the card's top (`cardTop`, the edge a selection's
 * frame keeps clear) while that leaves CUE_ROOM below the area's `top`; else, the card being about as tall as the window
 * or taller, the card's bottom edge (`cardBottom`), and the card is then a cover lying over the area, fixed to its
 * bottom edge, so a pill finds the room beside it.
 */
export function cueAreaBottom(top: number, cardTop: number, cardBottom: number): number {
  return cardTop - top >= CUE_ROOM ? cardTop : cardBottom
}

/** A card on screen: its slot's centre (`x`, `y`) and how many screen px a card px draws (`k`, zoom and due date). */
export type CardAt = { id: string; x: number; y: number; k: number }

/**
 * A card not yet measured, in card px from its slot's centre: the whole 170 x 44 slot and the 20 px its words may run
 * past the slot's right edge (globals.css .node-label-text). Generous: most titles end well short of it, and the
 * circle and one line of words take about half its height.
 */
export const CARD_ESTIMATE: Area = { left: -85, right: 105, top: -22, bottom: 22 }

/** Where `card` draws on screen, from its extent in card px (measured, else CARD_ESTIMATE). */
export function cardBox(card: CardAt, extent: Area = CARD_ESTIMATE): Area {
  return { left: card.x + extent.left * card.k, right: card.x + extent.right * card.k, top: card.y + extent.top * card.k, bottom: card.y + extent.bottom * card.k }
}

/**
 * What a card draws (`drawn`: its circle, its words and its marks as boxes on screen) as one extent in card px from its
 * slot's centre, so it holds wherever the view moves the card and however it scales it. Null when nothing is drawn.
 */
export function extentOf(drawn: readonly Area[], card: CardAt): Area | null {
  const seen = drawn.filter(b => b.right > b.left && b.bottom > b.top)
  if (seen.length === 0) return null
  const k = card.k
  return {
    left: (Math.min(...seen.map(b => b.left)) - card.x) / k,
    right: (Math.max(...seen.map(b => b.right)) - card.x) / k,
    top: (Math.min(...seen.map(b => b.top)) - card.y) / k,
    bottom: (Math.max(...seen.map(b => b.bottom)) - card.y) / k,
  }
}

/** Forgets the measures (`extents`, by step id) of steps not among `cards`, the ones drawn now. */
export function dropGone(extents: Map<string, Area>, cards: readonly CardAt[]): void {
  const drawn = new Set(cards.map(c => c.id))
  for (const id of extents.keys()) if (!drawn.has(id)) extents.delete(id)
}

/**
 * How far an overdue step's red ring reaches outside its circle, in the circle's CSS px (globals.css,
 * `.node-label[data-overdue='true'] .node-dot::after`, `inset: -9px`): a pseudo-element, so no box of it is measured.
 */
export const OVERDUE_RING = 9

type Size = { w: number; h: number }

/** The band across the free area a cue's pill takes, `inset` px in from its edge: [from, to] across that edge. */
function bandOf(side: CueSide, size: Size, area: Area, inset: number): [number, number] {
  return side === 'top'
    ? [area.top + inset, area.top + inset + size.h]
    : side === 'bottom'
      ? [area.bottom - inset - size.h, area.bottom - inset]
      : side === 'left'
        ? [area.left + inset, area.left + inset + size.w]
        : [area.right - inset - size.w, area.right - inset]
}

/** Where along the edge the pill's centre may not be: each of `boxes` in its band, widened by half the pill and the gap. */
function blockedIn(side: CueSide, size: Size, band: [number, number], boxes: readonly Area[]): [number, number][] {
  const across = side === 'top' || side === 'bottom'
  const half = (across ? size.w : size.h) / 2
  return boxes
    .filter(b => (across ? b.bottom > band[0] && b.top < band[1] : b.right > band[0] && b.left < band[1]))
    .map(b => (across ? [b.left - half - CUE_GAP, b.right + half + CUE_GAP] : [b.top - half - CUE_GAP, b.bottom + half + CUE_GAP]))
}

/** The nearest place to `at` along the edge, in the band `inset` in, where the pill crosses none of `boxes`; null if none. */
function slideAlong(cue: EdgeCue, size: Size, area: Area, boxes: readonly Area[], inset: number, margin: number): number | null {
  const across = cue.side === 'top' || cue.side === 'bottom'
  const half = (across ? size.w : size.h) / 2
  const lo = (across ? area.left : area.top) + Math.max(margin, half + CUE_INSET)
  const hi = (across ? area.right : area.bottom) - Math.max(margin, half + CUE_INSET)
  const blocked = blockedIn(cue.side, size, bandOf(cue.side, size, area, inset), boxes)
  const free = (at: number) => at >= lo - 1e-9 && at <= hi + 1e-9 && blocked.every(([a, b]) => at <= a || at >= b)
  if (free(cue.at)) return cue.at
  const best = blocked
    .flat()
    .filter(free)
    .sort((a, b) => Math.abs(a - cue.at) - Math.abs(b - cue.at))[0]
  return best ?? null
}

/** How far into the free area `cover` reaches from the edge `side`. */
const depthOf = (side: CueSide, cover: Area, area: Area) =>
  side === 'top' ? cover.bottom - area.top : side === 'bottom' ? area.bottom - cover.top : side === 'left' ? cover.right - area.left : area.right - cover.left

/**
 * Where the cue's pill (`size`) goes so it is seen and on or next to its line. At its line, CUE_INSET inside its edge,
 * if it crosses none of `boxes` (the cards as drawn, keeping CUE_GAP from each) and none of `covers` (chrome drawn over
 * the free area: the side panel lying over the graph, the "Ready now" chip, a wrapped toolbar). Else the nearer of two
 * moves, counted in px off that place: along the edge to the nearest clear place, or, where a cover lies on that place,
 * in from the edge to just inside that cover (CUE_INSET past its inner edge, as `inset`), or just inside each further
 * cover stacked under it on its line in turn (the "Ready now" chip under a two-row toolbar), and there along to the
 * nearest clear place, which keeps the pill on its line under a shallow cover such as the panel's folded header. Never
 * nearer the corners than CUE_MARGIN or than half its own length. Where neither move finds a clear place (the bottom
 * card, taller than the window, over its line), the nearest clear place just inside another cover in its band (the
 * "Ready now" chip beside the card). Where none is clear it stays at its line: just inside the cover if one lies there
 * (seen, though it may cross a card), else at the edge, under the cover if one is that deep: nothing in view is free,
 * and a pill drawn over the bottom card would hide what it lists (the selected step's needs, by name). `keep` are boxes
 * it never crosses, not even then (the selected step as drawn, and the pills placed before it): just inside the cover
 * on its line (or at the edge), it goes along to the nearest place clear of those and of the covers, over a card if
 * it must, and stays on its line only where none is.
 */
export function placeCue(
  cue: EdgeCue,
  size: Size,
  area: Area,
  boxes: readonly Area[],
  covers: readonly Area[] = [],
  margin = CUE_MARGIN,
  keep: readonly Area[] = [],
): EdgeCue {
  const all = [...boxes, ...keep, ...covers]
  const along = slideAlong(cue, size, area, all, CUE_INSET, margin)
  if (along === cue.at) return cue
  const across = cue.side === 'top' || cue.side === 'bottom'
  // the covers over the pill's place at its line
  const onLine = covers.filter(c => blockedIn(cue.side, size, bandOf(cue.side, size, area, CUE_INSET), [c]).some(([a, b]) => cue.at > a && cue.at < b))
  let inward: { inset: number; at: number | null } | null = null
  // every depth the pill was tried at just inside a cover on its line
  const depths: number[] = []
  if (onLine.length > 0) {
    // Just inside the cover on its line, or, where another cover lies on its line there, just inside that one in turn
    // (at 390 px the "Ready now" chip lies right under the two-row toolbar, and the folded panel header under the
    // chip): the nearest clear place at any of those depths. Where none is clear, the deepest, where it is seen.
    const room = across ? area.bottom - area.top : area.right - area.left
    const fits = (inset: number) => inset + (across ? size.h : size.w) + CUE_INSET <= room
    const cost = (inset: number, at: number | null) => (at === null ? Infinity : inset - CUE_INSET + Math.abs(at - cue.at))
    for (let inset = Math.max(...onLine.map(c => depthOf(cue.side, c, area))) + CUE_INSET; fits(inset); ) {
      depths.push(inset)
      const at = slideAlong(cue, size, area, all, inset, margin)
      if (inward === null || inward.at === null || cost(inset, at) < cost(inward.inset, inward.at)) inward = { inset, at }
      const deeper = covers.filter(c => depthOf(cue.side, c, area) + CUE_INSET > inset && blockedIn(cue.side, size, bandOf(cue.side, size, area, inset), [c]).some(([a, b]) => cue.at > a && cue.at < b))
      if (deeper.length === 0) break
      inset = Math.max(...deeper.map(c => depthOf(cue.side, c, area))) + CUE_INSET
    }
  }
  const alongCost = along === null ? Infinity : Math.abs(along - cue.at)
  const inwardCost = inward?.at == null ? Infinity : inward.inset - CUE_INSET + Math.abs(inward.at - cue.at)
  if (inward && inward.at !== null && inwardCost < alongCost) return { ...cue, at: inward.at, inset: inward.inset }
  if (along !== null) return { ...cue, at: along }
  // Nothing clear at the edge or just inside the cover on its line (the bottom card over the whole band, too deep to get
  // inside): just inside a shallower cover elsewhere along the band (the "Ready now" chip beside the card), the nearest.
  const band = bandOf(cue.side, size, area, CUE_INSET)
  let beside: { inset: number; at: number; cost: number } | null = null
  for (const c of covers) {
    if (onLine.includes(c) || blockedIn(cue.side, size, band, [c]).length === 0) continue
    const inset = depthOf(cue.side, c, area) + CUE_INSET
    if (inset + (across ? size.h : size.w) + CUE_INSET > (across ? area.bottom - area.top : area.right - area.left)) continue
    const at = slideAlong(cue, size, area, all, inset, margin)
    const cost = at === null ? Infinity : inset - CUE_INSET + Math.abs(at - cue.at)
    if (at !== null && (beside === null || cost < beside.cost)) beside = { inset, at, cost }
  }
  if (beside) return { ...cue, at: beside.at, inset: beside.inset }
  // Nothing clear of every card: the nearest place clear of `keep` and the covers, at the edge or at any depth tried.
  let over: { inset: number; at: number; cost: number } | null = null
  for (const inset of keep.length > 0 ? (depths.length > 0 ? depths : [CUE_INSET]) : []) {
    const at = slideAlong(cue, size, area, [...keep, ...covers], inset, margin)
    const cost = at === null ? Infinity : inset - CUE_INSET + Math.abs(at - cue.at)
    if (at !== null && (over === null || cost < over.cost)) over = { inset, at, cost }
  }
  if (over) return depths.length > 0 ? { ...cue, at: over.at, inset: over.inset } : { ...cue, at: over.at }
  return inward ? { ...cue, inset: inward.inset } : cue
}

/** The box a placed cue's pill takes on screen (as ChainEdgeCue draws it). */
export function cueBox(cue: EdgeCue, area: Area): Area {
  const { w, h } = cueSize(cue.count)
  const inset = cue.inset ?? CUE_INSET
  const left = cue.side === 'left' ? area.left + inset : cue.side === 'right' ? area.right - inset - w : cue.at - w / 2
  const top = cue.side === 'top' ? area.top + inset : cue.side === 'bottom' ? area.bottom - inset - h : cue.at - h / 2
  return { left, top, right: left + w, bottom: top + h }
}

/**
 * Every cue placed in turn (placeCue), each keeping clear of `keep` (the selected step as drawn) and of the pills
 * placed before it, CUE_GAP apart: two pills that meet in one strip (a phone with a tall bottom card, where the top and
 * bottom pills both move in under the toolbar) sit side by side, never on each other. A pill with no place off those
 * (placeCue fell back to its line: a strip too short for it, filled by the chip and the selected step) is left out, and
 * so is one that fell back under a cover (just inside the "Ready now" chip but under the two-row toolbar, or at its edge
 * under the toolbar and a bottom card taller than the window), where it cannot be seen.
 */
export function placeCues(cues: readonly EdgeCue[], area: Area, boxes: readonly Area[], covers: readonly Area[] = [], keep: readonly Area[] = [], margin = CUE_MARGIN): EdgeCue[] {
  const placed: EdgeCue[] = []
  for (const c of cues) {
    const kept = [...keep, ...placed.map(p => cueBox(p, area))]
    const cue = placeCue(c, cueSize(c.count), area, boxes, covers, margin, kept)
    const box = cueBox(cue, area)
    if ([...kept, ...covers].every(k => box.right <= k.left || box.left >= k.right || box.bottom <= k.top || box.top >= k.bottom)) placed.push(cue)
  }
  return placed
}

const SIDES: CueSide[] = ['top', 'bottom', 'left', 'right']

/**
 * The edge of `area` a cover (something drawn over the graph, such as the side panel lying over it on a narrow window)
 * runs along, from the part of it inside the area: the top or bottom edge when it spans more of the area's width than
 * of its height, else the left or right one, whichever of the pair it is nearer. Null unless it reaches at least 1 px into the area both ways.
 */
export function coverSide(cover: Area, area: Area): CueSide | null {
  const left = Math.max(cover.left, area.left), right = Math.min(cover.right, area.right)
  const top = Math.max(cover.top, area.top), bottom = Math.min(cover.bottom, area.bottom)
  // at least 1 px each way: a panel that only meets the area's edge (a sub-pixel sliver at a fractional zoom) is not over it
  if (!(right - left >= 1 && bottom - top >= 1)) return null
  const across = (right - left) / (area.right - area.left) >= (bottom - top) / (area.bottom - area.top)
  return across ? (top - area.top <= area.bottom - bottom ? 'top' : 'bottom') : left - area.left < area.right - right ? 'left' : 'right'
}

/**
 * One cue per edge of `area` (screen pixels) that marked steps lie past, in the order top, bottom, left, right. A step
 * past a corner counts on the side it is farther past. A step inside the area but under one of `covers` (the toolbar,
 * the side panel, the "Ready now" chip or the bottom card where they lie over the free area) is hidden, so it counts
 * too, on the edge that cover runs along (coverSide, or the edge it is fixed to, its `side`). The cue sits at the mean of where its steps are along the edge (on a column: where
 * the line runs off), kept CUE_MARGIN from the corners.
 */
export function edgeCues(points: readonly CuePoint[], area: Area, covers: readonly Cover[] = [], margin = CUE_MARGIN): EdgeCue[] {
  const sided = covers.flatMap(c => {
    const side = coverSide(c, area)
    // a cover fixed to an edge (the bottom card) runs along it, once it lies over the area at all
    return side === null ? [] : [{ ...c, side: c.side ?? side }]
  })
  const groups = new Map<CueSide, CuePoint[]>()
  for (const p of points) {
    const dy = Math.max(area.top - p.y, p.y - area.bottom)
    const dx = Math.max(area.left - p.x, p.x - area.right)
    const side: CueSide | undefined =
      dx <= 0 && dy <= 0
        ? sided.find(c => p.x > c.left && p.x < c.right && p.y > c.top && p.y < c.bottom)?.side
        : dy >= dx
          ? p.y < area.top
            ? 'top'
            : 'bottom'
          : p.x < area.left
            ? 'left'
            : 'right'
    if (side === undefined) continue
    groups.set(side, [...(groups.get(side) ?? []), p])
  }
  const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)))
  return SIDES.filter(s => groups.has(s)).map(side => {
    const ps = groups.get(side)!
    const across = side === 'top' || side === 'bottom'
    const mean = ps.reduce((sum, p) => sum + (across ? p.x : p.y), 0) / ps.length
    const at = across ? clamp(mean, area.left + margin, area.right - margin) : clamp(mean, area.top + margin, area.bottom - margin)
    const kinds = new Set(ps.map(p => p.kind))
    return { side, count: ps.length, kind: kinds.size > 1 ? 'both' : ps[0].kind, at }
  })
}
