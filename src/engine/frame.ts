import { distanceFor, LABEL_SCALE, labelScale, pxPerUnit } from './camera.js'
import { DECK_PREFIX } from './grouping.js'
import { LAYOUT, type Layout } from './layered.js'
import { DOT, LABEL_TEXT } from './nodeLabel.js'
import { MARK_CSS, markSide, plateLeft } from './plateFit.js'
import { titleBoost } from './titleFitDom.js'

/** Framing of the laid-out plan: on load and when the drawn structure changes; between those the camera belongs to the user. */
export const FRAME = {
  fitMs: 600,
  /** Fraction of the view kept clear on each side when framing. */
  fitPad: 0.06,
  /**
   * The readability cap: past this many pixels per layout unit cards stop shrinking. Frames go farther only when
   * that is what it takes to show everything they frame.
   */
  minPxPerUnit: 0.45,
  /** Pixels at the top of the view kept clear for the toolbar. */
  topInset: 72,
  /**
   * Pixels at the bottom kept clear for the node HUD (the bottom card), so the bottom row (where work starts) stays
   * clickable. The least: a selection keeps the card's real height clear when it is taller (bottomInsetFor).
   */
  bottomInset: 170,
  /** The bottom card's distance from the bottom of the view (`bottom-4`), and the gap kept above its top edge. */
  hudBottom: 16,
  hudGap: 12,
  /** Pixels at the left kept clear for the legend while it is shown, on views at least `legendMinW` wide. */
  leftInset: 240,
  legendMinW: 900,
  /**
   * Narrower than `legendMinW` (and at least `legendShowW`, below which the legend is hidden), the legend's corner is
   * kept clear from below instead: the bottom strip reaches the legend's top edge (`bottom-16` plus its height) and a
   * gap, as long as that leaves at least `legendTopMinH` of the view's height; on a view too short for that the left
   * strip is kept clear as on a wide one.
   */
  legendShowW: 640,
  legendTop: 304,
  legendTopMinH: 0.4,
  /** Pixels at the right kept clear for the side panel while it is open (`right-4 w-[400px]`). */
  panelInset: 416,
  /**
   * The least px the whole plan's frame keeps between a card or title drawn past its slot at the plan's edge and the
   * window (or a strip): such a card may reach into the pad (`fitPad`) up to this far from its edge (planFrame).
   */
  edgeMargin: 16,
}

type Pt = { x?: number; y?: number }
/**
 * A point the whole plan's frame takes: a corner of the slot box, the centre of a step drawn `scale` (above 1) times
 * its slot for a soon due date, so the frame counts it at the size it is drawn, or (`bend`) a corner of the box the
 * arrows' lanes and bends span, which may reach past the slot box (planFrame).
 */
export type PlanPt = Pt & { scale?: number; bend?: boolean } & Partial<TitleMeasure> & { title?: boolean }

/**
 * What the whole plan's frame knows of a step's words as drawn, from the title fit (titleFitDom's titleLine): `line`,
 * how far its longest drawn line (the title's or its due line's) ends from where its text block starts, in card px at
 * no boost, once measured; `deck` for a deck, whose words keep their card's size (no --title-boost).
 */
export type TitleMeasure = { line?: number; deck?: boolean }

/**
 * The points the whole plan is framed with (planFrame), from its layout (y down; the points are in the plane's, y up):
 * the slot box's corners, the centre of each step drawn larger than its slot for a soon due date (`scaleOf`, its
 * due-date scale, 1 when undated) with that scale, and two corners (`bend`) of the box every arrow's waypoints between
 * its ends span: the lanes a long arrow runs down and where it turns. Between them an arrow is drawn as straight runs
 * and curves with upright tangents (edgeCurve), which stay inside that box; its ends are at its steps' circles. Given
 * `titleOf` (what the title fit measured of each step's words, TitleMeasure), every step's centre is added with it and
 * its scale, marked `title`.
 */
export function planPoints(
  layout: Pick<Layout, 'nodes' | 'edges' | 'width' | 'height'>,
  scaleOf: (id: string) => number,
  titleOf?: (id: string) => TitleMeasure | undefined,
): PlanPt[] {
  if (layout.nodes.size === 0) return []
  // Given `titleOf`, every step's centre (`title`), so the frame counts each title as drawn rather than an edge card's
  // full text box; without it, only the steps drawn larger.
  const larger = [...layout.nodes.values()].flatMap(n => {
    const scale = scaleOf(n.id)
    if (titleOf) return [{ x: n.x, y: -n.y, scale, ...titleOf(n.id), title: true }]
    return scale > 1 ? [{ x: n.x, y: -n.y, scale }] : []
  })
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity
  for (const e of layout.edges)
    for (let i = 1; i < e.points.length - 1; i++) {
      const q = e.points[i]
      left = Math.min(left, q.x)
      right = Math.max(right, q.x)
      top = Math.min(top, q.y)
      bottom = Math.max(bottom, q.y)
    }
  const bends = left <= right ? [{ x: left, y: -top, bend: true }, { x: right, y: -bottom, bend: true }] : []
  return [{ x: -layout.width / 2, y: LAYOUT.cardH / 2 }, { x: layout.width / 2, y: -(layout.height - LAYOUT.cardH / 2) }, ...larger, ...bends]
}
type Vec3 = { x: number; y: number; z: number }
export type Frame = { position: Vec3; lookAt: Vec3 }
type View = { w: number; h: number }
/**
 * `pad` is the fraction of the view kept clear inside the strips on each side; `padX` and `padY`, when given, replace it
 * across and up and down (each still a fraction of the view's width or height).
 */
type FrameOpts = { pad: number; padX?: number; padY?: number; maxZ: number; minZ?: number; top?: number; bottom?: number; left?: number; right?: number }
const padX = (opts: { pad: number; padX?: number }) => opts.padX ?? opts.pad
const padY = (opts: { pad: number; padY?: number }) => opts.padY ?? opts.pad

/** Never frame into less than this fraction of the view's width or height, however much the strips cover. */
const MIN_USABLE = 0.05

/** Fractions of the view's width and height left between the pads and the strips (at least MIN_USABLE). */
function usable(view: View, opts: Omit<FrameOpts, 'maxZ'>): { usableW: number; usableH: number } {
  return {
    usableW: Math.max(MIN_USABLE, 1 - 2 * padX(opts) - ((opts.left ?? 0) + (opts.right ?? 0)) / view.w),
    usableH: Math.max(MIN_USABLE, 1 - 2 * padY(opts) - ((opts.top ?? 0) + (opts.bottom ?? 0)) / view.h),
  }
}

/**
 * Camera frame that shows every node straight on (camera on the +z normal). z backs off until the
 * bounding box fits the view outside a `top` strip (toolbar), a `bottom` strip (node HUD), a `left`
 * strip (legend) and a `right` strip (side panel), but not nearer than minZ nor past maxZ; when clamped, the top row (the goal) is kept at the top so a tall
 * plan is read from its goal down.
 */
export function frameFor(nodes: Pt[], view: { w: number; h: number }, fovDeg: number, opts: FrameOpts): Frame {
  const xs = nodes.map(n => n.x ?? 0)
  const ys = nodes.map(n => n.y ?? 0)
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  const tan = Math.tan((fovDeg * Math.PI) / 360)
  const top = opts.top ?? 0
  const left = opts.left ?? 0
  const right = opts.right ?? 0
  const bottom = opts.bottom ?? 0
  const { usableW, usableH } = usable(view, opts)
  const aspect = view.w / view.h
  const halfW = (maxX - minX) / 2, halfH = (maxY - minY) / 2
  const zForH = halfH / (tan * usableH)
  const zForW = halfW / (tan * aspect * usableW)
  const z = Math.min(Math.max(zForH, zForW, opts.minZ ?? 1), opts.maxZ)
  const halfVisible = z * tan
  const unitsPerPx = (2 * halfVisible) / view.h
  // Centred, unless that puts the box's left (right) edge inside the left (right) strip: then shift just enough.
  // Too wide for the space between the strips (clamped): centred on that space.
  const clearLeftPx = view.w / 2 - halfW / unitsPerPx - (padX(opts) * view.w + left)
  const clearRightPx = view.w / 2 - halfW / unitsPerPx - (padX(opts) * view.w + right)
  const shiftPx = clearLeftPx < 0 && clearRightPx < 0 ? (right - left) / 2 : Math.max(0, -clearRightPx) - Math.max(0, -clearLeftPx)
  const cx = (minX + maxX) / 2 + shiftPx * unitsPerPx
  // Fits: centre it between the top and bottom strips. Clamped: put the top of the box at the top of that area.
  const fits = z < opts.maxZ || halfH <= halfVisible * usableH
  const cy = fits ? (minY + maxY) / 2 + ((top - bottom) / 2) * unitsPerPx : maxY + (padY(opts) * view.h + top) * unitsPerPx - halfVisible
  const lookAt = { x: cx, y: cy, z: 0 }
  return { position: { x: cx, y: cy, z }, lookAt }
}

/** The most of the view's width the left and right strips together may keep clear: the right strip shrinks to fit (the host's left is never capped). */
const MAX_SIDE_STRIPS = 0.6

/** The strips (CSS px) the host keeps clear at each edge of the view: its toolbar, panels and anything else drawn over the graph. */
export type Insets = { top: number; right: number; bottom: number; left: number }

/**
 * The strips every frame keeps clear: the host's (`host`, each side optional) and the legend's strip only while
 * `legend` is on screen. The top is never less than FRAME.topInset and the bottom defaults to FRAME.bottomInset. On a
 * wide view the legend's strip is at the left (at least FRAME.leftInset, or the host's left when wider); narrower than
 * FRAME.legendMinW the legend's corner is kept clear from below (FRAME.legendTop), or at the left on a view too short
 * for that. The right strip shrinks so at least 40% of the width stays free (a panel then covers part of the frame).
 */
export const frameInsets = (view: View, host: Partial<Insets> = {}, legend = true): Insets => {
  const wide = view.w >= FRAME.legendMinW
  const corner = legend && !wide && view.w >= FRAME.legendShowW
  const below = corner && view.h - FRAME.topInset - FRAME.legendTop >= FRAME.legendTopMinH * view.h
  const left = Math.max(host.left ?? 0, (legend && wide) || (corner && !below) ? FRAME.leftInset : 0)
  const bottom = host.bottom ?? FRAME.bottomInset
  return {
    top: Math.max(FRAME.topInset, host.top ?? 0),
    bottom: below ? Math.max(bottom, FRAME.legendTop) : bottom,
    left,
    right: Math.max(0, Math.min(host.right ?? 0, view.w * MAX_SIDE_STRIPS - left)),
  }
}

/**
 * The strips a camera move the graph starts frames into: the host's insets plus its passive strips (`passive`, the
 * `passiveInsets` prop), field by field. The passive ones are for what covers the graph without being kept clear of
 * by the cues, such as a sheet that rests beside the panel.
 */
export const framingInsets = (insets: Insets, passive?: Partial<Insets>): Insets => ({
  top: insets.top + (passive?.top ?? 0),
  right: insets.right + (passive?.right ?? 0),
  bottom: insets.bottom + (passive?.bottom ?? 0),
  left: insets.left + (passive?.left ?? 0),
})

/**
 * The bottom strip a selection keeps clear: the bottom card's real height (`hudHeight`, null when there is none) with
 * its distance from the bottom and a gap above it, never less than the default strip. A `folded` card (one line, see
 * cardFold.ts) is the thin strip it is, without that floor, so a frame gives the graph the room back.
 */
export const bottomInsetFor = (hudHeight: number | null, folded = false): number =>
  hudHeight === null ? FRAME.bottomInset : Math.max(folded ? 0 : FRAME.bottomInset, Math.ceil(hudHeight) + FRAME.hudBottom + FRAME.hudGap)

/**
 * What a selection's frame depends on: the selected id, the side panel's strip (`right`), the bottom card's or sheet's
 * strip (`bottom`), the other strips (`top`, `left`) and whether the legend's strip is kept (`legend`), the steps it is framed with (`chain`, a key of its neighbours' ids), where the selected step is laid out (`at`) and the
 * view's settled size (`view`, a key of its width and height).
 */
export type SelectionFrameKey = { id: string | null; right: number; left?: number; bottom?: number; top?: number; legend?: boolean; chain?: string; at?: string; view?: string; folded?: boolean }

/**
 * The camera as it is: whether the user has zoomed or panned since the last automatic frame (`userMoved`), and
 * whether the chain is now covered by a strip or out of view (`covered`, measured with the new strips). For a new view
 * size, `hid`: whether the resize hid a step that was in view just before it began (hidStep).
 */
export type SelectionCamera = { userMoved: boolean; covered: boolean; hid?: boolean }

/** How long the view's size must hold before a resize counts (dragging a window edge is one resize, framed once). */
export const RESIZE_SETTLE_MS = 200

/**
 * Whether a resize hid a step: one in view (in the free area) just before the resize began (`before`, the ids then in
 * view, null when nothing was measured for what is framed now) is covered by a strip or off the window after it
 * (`after`, the ids in view now). Steps already out of view before do not count, nor do steps coming into view.
 */
export function hidStep(before: ReadonlySet<string> | null, after: ReadonlySet<string>): boolean {
  if (before === null) return false
  for (const id of before) if (!after.has(id)) return true
  return false
}

/**
 * Whether a settled new view size re-frames what is framed (the selection's chain, or the whole plan), never while
 * the user drags: always while the camera is where the last frame put it; once the user has zoomed or panned, only when
 * the resize hid a step that was in view before it (`hid`, see hidStep).
 */
export function shouldFrameResize(cam: { userMoved: boolean; hid: boolean }, dragging: boolean): boolean {
  if (dragging) return false
  return !cam.userMoved || cam.hid
}

/**
 * What to do with a fly to a step (a chip, Shift+F; `fly` with its `seq`, `flown` the last seq acted on): 'fly' now,
 * 'none' when there is none or it was acted on, or 'wait' while a resize is under way, so it is aimed at the final size
 * and owns the settle (flyTakesFrame stays true until it flies, so no chain frame starts on top of it). It also waits
 * while the view has no size (`viewEmpty`), as the chain frame does, and is tried again once it has one. 'drop' (mark
 * it acted on, move nothing) when its step is no longer the selected one: Escape or another step picked while it
 * waited, whose own frame or fit then owns the camera.
 */
export function flyStep(
  fly: { id: string; seq: number } | null,
  flown: number | null,
  at: { selectedId: string | null; resizing: boolean; viewEmpty: boolean },
): 'fly' | 'wait' | 'drop' | 'none' {
  if (fly === null || fly.seq === flown) return 'none'
  if (fly.id !== at.selectedId) return 'drop'
  return at.resizing || at.viewEmpty ? 'wait' : 'fly'
}

/**
 * Whether a selection needs framing, never while the user drags: a new one, the same one when the panel opens or
 * closes under it or the user folds or unfolds the bottom card (`folded`), or it gains or loses a neighbour (a need added, a link made). A new view size follows
 * shouldFrameResize. Any other strip changing (a bottom sheet or card measured, growing or shrinking; the top, the left,
 * the legend's strip) re-frames it so the chain fills the free area that is left, unless the user has moved the camera
 * themselves. A new layout under it (a step moved by an edit elsewhere) re-frames only when it leaves the chain covered
 * or out of view, and not once the user has moved the camera.
 */
export function shouldFrameSelection(
  last: SelectionFrameKey,
  now: SelectionFrameKey,
  dragging: boolean,
  cam: SelectionCamera = { userMoved: false, covered: true },
): boolean {
  if (now.id === null || dragging) return false
  if (now.id !== last.id || now.right !== last.right || now.chain !== last.chain || !!now.folded !== !!last.folded) return true
  // A new view size decides alone, whatever else changed with it (the bottom card re-wrapping at a new width).
  if (now.view !== last.view) return shouldFrameResize({ userMoved: cam.userMoved, hid: cam.hid ?? false }, false)
  const strips = now.bottom !== last.bottom || (now.left ?? 0) !== (last.left ?? 0) || (now.top ?? 0) !== (last.top ?? 0) || (now.legend ?? true) !== (last.legend ?? true)
  if (strips) return !cam.userMoved
  return now.at !== last.at && cam.covered && !cam.userMoved
}

/**
 * What to do with the selection now: 'frame' it; mark it 'seen' without moving (nothing selected, already framed, a
 * change that needs no move, or made while the user drags, so no later engine stop or panel change jumps to it); or
 * 'wait' for the graph to be `ready` (a selection there before the engine first stopped is framed then).
 */
export function selectionFrameStep(
  last: SelectionFrameKey,
  now: SelectionFrameKey,
  ready: boolean,
  dragging: boolean,
  cam?: SelectionCamera,
): 'frame' | 'seen' | 'wait' {
  if (now.id !== null && !ready) return 'wait'
  return shouldFrameSelection(last, now, dragging, cam) ? 'frame' : 'seen'
}

/** Whether every screen point (px) lies in the view less its strips (`top`, `bottom`, `left`, `right` in px). */
export function insideArea(pts: { x: number; y: number }[], view: View, strips: { top: number; bottom: number; left: number; right: number }): boolean {
  return pts.every(p => p.x >= strips.left && p.x <= view.w - strips.right && p.y >= strips.top && p.y <= view.h - strips.bottom)
}

/** The nearest a selection is framed: where cards reach their largest scale, so nearer would only spread them apart. */
const nearestChainZ = (view: View, fovDeg: number): number => distanceFor(LABEL_SCALE.max, fovDeg, view.h)

/**
 * Framing the selection's chain: the first fit's padding, never nearer than where cards stop growing (a lone step
 * keeps its neighbours in view). It backs off past the readability cap when the chain needs it, but never farther
 * than the whole plan's fit (`plan` is its bounding box) into the same free area (the same strips, the bottom card's
 * real height included), unless that is nearer than `minZ`.
 */
/**
 * How much farther a selection's frame may back off to also show its done decks (chainFrame's spare points): a little,
 * so the folded finished work is in view with the work still to do, never so much that the open steps shrink away.
 */
export const SPARE_BACKOFF = 1.5

/** The points of a plan's frame that are its cards' (the slot box and the steps drawn larger), not its arrows' bends. */
const cardsOf = (plan: PlanPt[]): PlanPt[] => plan.filter(p => !p.bend)

type Strips = Omit<FrameOpts, 'maxZ' | 'minZ'>
/** Along each axis of the view: the free area's length (less the strips), the cards' margin (the pad) and the coordinate. */
const axesOf = (view: View, opts: Strips) => [
  { free: view.w - (opts.left ?? 0) - (opts.right ?? 0), pad: padX(opts) * view.w, of: (p: Pt) => p.x ?? 0 },
  { free: view.h - (opts.top ?? 0) - (opts.bottom ?? 0), pad: padY(opts) * view.h, of: (p: Pt) => p.y ?? 0 },
]
const span = (ps: Pt[], of: (p: Pt) => number) => ({ lo: Math.min(...ps.map(of)), hi: Math.max(...ps.map(of)) })

/**
 * How far back the camera must be for the arrows' `bends` to lie FRAME.edgeMargin inside the free area while the
 * `cards` keep the pad, as planFrame keeps a plan's (0 without bends): along each axis, the farthest-apart pair of
 * extremes times the zoom is at most the free length less both their margins.
 */
function laneZ(cards: Pt[], bends: Pt[], view: View, fovDeg: number, opts: Strips): number {
  if (bends.length === 0) return 0
  let ppu = Infinity
  for (const a of axesOf(view, opts)) {
    const c = span(cards, a.of), b = span(bends, a.of), m = FRAME.edgeMargin
    for (const [d, room] of [[b.hi - b.lo, a.free - 2 * m], [c.hi - b.lo, a.free - a.pad - m], [b.hi - c.lo, a.free - a.pad - m]])
      if (d > 0 && room > 0) ppu = Math.min(ppu, room / d)
  }
  return ppu === Infinity ? 0 : distanceFor(ppu, fovDeg, view.h)
}

export const CHAIN_FRAME = {
  pad: FRAME.fitPad,
  minZ: nearestChainZ,
  /**
   * The farthest a selection is framed: the whole plan's fit, its cards with the pad and its arrows' lanes the margin
   * inside the free area (laneZ), so a chain whose own long arrow is the plan's outermost lane is still shown whole.
   * Never past planFrame, which also counts the titles drawn past the cards.
   */
  maxZ: (plan: PlanPt[], view: View, fovDeg: number, host: Partial<Insets> = {}, legend = true): number => {
    const opts = { pad: FRAME.fitPad, ...planStrips(plan, view, fovDeg, host, legend) }
    const cards = cardsOf(plan)
    return Math.max(nearestChainZ(view, fovDeg), frameFor(cards, view, fovDeg, { ...opts, maxZ: Infinity }).position.z, laneZ(cards, plan.filter(p => p.bend), view, fovDeg, opts))
  },
}

/**
 * Whether a drawn chain node is finished and so left out of the selection's frame (it is still drawn, and may
 * fall outside the view). The selected node always counts; a deck (given its `members`) counts unless all of
 * them are done.
 */
export function doneForFrame(id: string, selectedId: string, status: (id: string) => string | undefined, members?: readonly { status: string }[]): boolean {
  if (id === selectedId) return false
  if (members) return members.length > 0 && members.every(m => m.status === 'done')
  return status(id) === 'done'
}

/**
 * A point of a selection's frame: a card corner, with how chainFrame treats it, or (`bend`) a corner of the box its own
 * long arrows' lanes and bends span.
 */
export type FramePt = { x: number; y: number; done?: boolean; spare?: boolean; own?: boolean; bend?: boolean }

/**
 * The points a selection is framed with (chainFrame's `chain`): the card corners of the selected step, the steps it
 * needs and the steps that need it (`near`, one hop each way, see neighboursOf), not its whole path to the goal. A
 * step folded into a deck stands at its deck (`drawnId`), each drawn card counted once; a step not drawn is skipped.
 * Finished ones are marked `done` (doneForFrame). A done deck is `spare` (shown when that backs the camera off only a
 * little); the selection's own done deck (its finished needs, folded under it) is always tried, marked `own`, even
 * when no neighbour stands at it. `at` gives layout positions (y down); the points are in the plane's (y up). Given the
 * `layout`, the two corners (`bend`) of the box the lanes and bends of the selection's own arrows span are added too
 * (planPoints over its arrows to and from the neighbours framed, not the finished ones): a long arrow of the chain may
 * run past every card it joins.
 */
export function selectionPoints(
  selectedId: string,
  near: { upstream: Iterable<string>; downstream: Iterable<string> },
  drawn: {
    at(drawnId: string): { x: number; y: number } | undefined
    drawnId(id: string): string
    deck(drawnId: string): { parentId: string; members: readonly { status: string }[]; done?: boolean } | undefined
    status(id: string): string | undefined
  },
  card: { w: number; h: number },
  layout?: Pick<Layout, 'nodes' | 'edges' | 'width' | 'height'>,
): FramePt[] {
  const ownDeck = DECK_PREFIX + selectedId
  const seen = new Set<string>()
  const pts: FramePt[] = []
  // The drawn cards of the neighbours framed (not finished, not a done deck): the selection's own arrows run to them.
  const framed = new Set<string>()
  for (const id of [selectedId, ...near.upstream, ...near.downstream, ownDeck]) {
    const drawnId = id === ownDeck ? id : drawn.drawnId(id)
    const p = drawn.at(drawnId)
    const deck = drawn.deck(drawnId)
    if (seen.has(drawnId) || !p || (id === ownDeck && !deck?.done)) continue
    seen.add(drawnId)
    const mark = deck?.done ? { spare: true, own: deck.parentId === selectedId } : { done: doneForFrame(id, selectedId, drawn.status, deck?.members) }
    pts.push({ x: p.x - card.w / 2, y: -p.y - card.h / 2, ...mark }, { x: p.x + card.w / 2, y: -p.y + card.h / 2, ...mark })
    if (!deck?.done && !mark.done) framed.add(drawnId)
  }
  if (!layout) return pts
  const me = drawn.drawnId(selectedId)
  const edges = layout.edges.filter(e => e.source !== e.target && ((e.source === me && framed.has(e.target)) || (e.target === me && framed.has(e.source))))
  const bends = planPoints({ ...layout, edges }, () => 1).filter(p => p.bend)
  return [...pts, ...bends.map(b => ({ x: b.x ?? 0, y: b.y ?? 0, bend: true }))]
}

/** The selected step's circle as drawn: its radius (card px, the label's --dot-r) and whether it is overdue. */
export type SelectedDot = { r: number; overdue: boolean }

/** How far (screen px) a step is drawn past its slot's centre on each side. */
export type Reach = { left: number; right: number; top: number; bottom: number }

/**
 * How far the selected step is drawn past its slot's centre at `ppu`, `scale` times its size for a soon due date
 * (viewer.css, .node-label[data-selected]; MARK_CSS): its brackets, the usual square at most, about its circle (`dot`:
 * its radius, --dot-r, and whether it is overdue, as its DueView gives them; an undated step's is DOT.r), and right of
 * them its plate as wide as its words may run (LABEL_TEXT.width at their boost). Up and down only the brackets count:
 * the plate's words are centred on the circle.
 */
export function selectedReach(ppu: number, scale = 1, dot: SelectedDot = { r: DOT.r, overdue: false }): Reach {
  const k = labelScale(ppu)
  const z = k * scale
  const toDot = (LAYOUT.cardW / 2 - DOT.cx) * k
  const style = { dotR: dot.r, z, overdue: dot.overdue }
  const mark = (markSide(Infinity, style) / 2) * z
  const boost = Math.max(1, MARK_CSS.minTitle / (MARK_CSS.title * z))
  const right = (plateLeft(Infinity, style) - DOT.cx + (LABEL_TEXT.width + MARK_CSS.padding) * boost) * z - toDot
  return { left: toDot + mark, right, top: mark, bottom: mark }
}

/**
 * A frame that shows `focus` with every point in `chain` not marked `done`: their bounding box is fitted into
 * the free area (the view less the pads and the strips) and centred in it, at a distance clamped to [minZ, maxZ].
 * When the box is too big even at maxZ, the view keeps as much of it as it can without losing the focus. Points marked
 * `spare` (a done deck: the finished part of the chain, folded) join the box when it then still fits whole, backing
 * off at most SPARE_BACKOFF times as far as without them; otherwise they are left out like done ones. Spare points
 * marked `own` too (the selected step's own done deck) are tried first, on their own: another done deck farther away
 * never pushes them out of the view. Points marked `bend` (where the chain's own long arrows run, selectionPoints) are
 * kept FRAME.edgeMargin inside the free area rather than the pad, like planFrame keeps a plan's: a lane that pokes past
 * the cards by less than the pad less that margin leaves the frame as the cards alone make it, one farther out backs
 * the camera off (never past maxZ) and moves the centre just as far as it takes. Given `reach` (the focus as drawn past
 * its slot's centre at a zoom, selectedReach), that drawing is kept FRAME.edgeMargin inside the free area as well,
 * backing off when that takes it and when some zoom allows it; where it cannot be had with the rest, the focus wins.
 */
export function chainFrame(
  focus: Pt,
  chain: (Pt & { done?: boolean; spare?: boolean; own?: boolean; bend?: boolean })[],
  view: View,
  fovDeg: number,
  opts: Omit<FrameOpts, 'maxZ'> & { maxZ: number; minZ: number; reach?: (ppu: number) => Reach },
): Frame {
  const bends = chain.filter(p => p.bend && !p.done)
  const axes = axesOf(view, opts)
  const fit = (ps: Pt[]) => Math.max(frameFor(ps, view, fovDeg, { ...opts, maxZ: Infinity }).position.z, laneZ(ps, bends, view, fovDeg, opts), opts.minZ)
  const must = [focus, ...chain.filter(p => !p.done && !p.spare && !p.bend)]
  const own = chain.filter(p => !p.done && p.spare && p.own)
  const spare = chain.filter(p => !p.done && p.spare && !p.own)
  const z0 = Math.min(fit(must), opts.maxZ)
  // With spare points the whole box must fit (so nothing that needs work leaves the view), at most SPARE_BACKOFF
  // times as far as without them: the own ones first, then the rest with them.
  const take = (base: { pts: Pt[]; z: number }, more: Pt[]) => {
    const zMore = more.length > 0 ? fit([...base.pts, ...more]) : Infinity
    return zMore <= opts.maxZ && zMore <= z0 * SPARE_BACKOFF ? { pts: [...base.pts, ...more], z: zMore } : base
  }
  const taken = take(take({ pts: must, z: z0 }, own), spare)
  const { pts } = taken
  const fx = focus.x ?? 0, fy = focus.y ?? 0
  const m = FRAME.edgeMargin
  // Given `reach` (the selected step as drawn past its slot's centre, px at a zoom), the camera backs off (never past
  // maxZ) until that is m inside the free area while the cards keep the pad, when some zoom allows it: along each axis
  // the drawn step fits, and so do the spans from the far side of the cards to the near side of its drawing.
  const sides = (r: Reach, i: number) => (i === 0 ? [r.left, r.right] : [r.bottom, r.top])
  const drawnFits = (ppu: number) =>
    axes.every((a, i) => {
      const [lo, hi] = sides(opts.reach!(ppu), i)
      const c = span(pts, a.of), f = a.of(focus)
      return lo + hi <= a.free - 2 * m && (f - c.lo) * ppu + hi <= a.free - a.pad - m && (c.hi - f) * ppu + lo <= a.free - a.pad - m
    })
  let z = taken.z
  const ppu0 = pxPerUnit(z, fovDeg, view.h)
  if (opts.reach && !drawnFits(ppu0) && drawnFits(ppu0 * 1e-6)) {
    let lo = ppu0 * 1e-6, hi = ppu0
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2
      if (drawnFits(mid)) lo = mid
      else hi = mid
    }
    z = Math.min(opts.maxZ, distanceFor(lo, fovDeg, view.h))
  }
  const xs = pts.map(p => p.x ?? 0), ys = pts.map(p => p.y ?? 0)
  const unitsPerPx = (2 * z * Math.tan((fovDeg * Math.PI) / 360)) / view.h
  const { usableW, usableH } = usable(view, opts)
  // Half the free area in plane units, and how far its centre sits from the view's centre in pixels.
  const reachW = (usableW * view.w * unitsPerPx) / 2, reachH = (usableH * view.h * unitsPerPx) / 2
  const offX = ((opts.left ?? 0) - (opts.right ?? 0)) / 2, offY = ((opts.top ?? 0) - (opts.bottom ?? 0)) / 2
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)
  // The point to put at the free area's centre: the box's centre, but never so far that the focus leaves the area.
  // With bends, the box's centre moves (as little as it takes) to where they too are inside: where every card is the
  // pad and every bend the margin inside the free area, when there is such a place at this distance.
  const toLanes = (centre: number, a: (typeof axes)[number]) => {
    if (bends.length === 0) return centre
    const c = span(pts, a.of), b = span(bends, a.of)
    const half = (margin: number) => (a.free / 2 - margin) * unitsPerPx
    const lo = Math.max(c.hi - half(a.pad), b.hi - half(FRAME.edgeMargin)), hi = Math.min(c.lo + half(a.pad), b.lo + half(FRAME.edgeMargin))
    // At the zoom laneZ chose the place is a single point: lo and hi meet, up to rounding.
    if (lo > hi) return lo - hi <= 1e-9 * (Math.abs(lo) + Math.abs(hi) + 1) ? (lo + hi) / 2 : centre
    return clamp(centre, lo, hi)
  }
  // Last, the selected step as drawn (`reach`) wins: the centre moves as little as it takes to put it m inside the free
  // area, or centres it there when it is wider than that.
  const drawn = (centre: number, i: number) => {
    if (!opts.reach) return centre
    const [lo, hi] = sides(opts.reach(1 / unitsPerPx), i)
    const f = i === 0 ? fx : fy, half = axes[i].free / 2 - m
    const from = f - (half - hi) * unitsPerPx, to = f + (half - lo) * unitsPerPx
    return from <= to ? clamp(centre, from, to) : f + ((hi - lo) / 2) * unitsPerPx
  }
  const cx = drawn(clamp(toLanes((Math.min(...xs) + Math.max(...xs)) / 2, axes[0]), fx - reachW, fx + reachW), 0)
  const cy = drawn(clamp(toLanes((Math.min(...ys) + Math.max(...ys)) / 2, axes[1]), fy - reachH, fy + reachH), 1)
  const lookAt = { x: cx - offX * unitsPerPx + 0, y: cy + offY * unitsPerPx + 0, z: 0 }
  return { position: { x: lookAt.x, y: lookAt.y, z }, lookAt }
}

export type FrameHost = {
  nodes(): PlanPt[]
  fov(): number
  view(): View
  /** Moves the camera over `ms`; `land`, when given, is called once it arrives there (never for a move cut short). */
  move(position: Vec3, lookAt: Vec3, ms: number, land?: () => void): unknown
  /**
   * Told when the camera has landed where a whole-plan frame put it (the app's own frame: the load's, F, a resize,
   * closing the selection): the titles are fitted afresh there, as on a load, keeping nothing from the zoom before.
   */
  landed?(): void
}

/**
 * The frame that shows the whole plan (its bounding box `nodes`) inside the free area, keeping the host's strips
 * (`host`) and the legend's room while `legend` shows clear (planStrips). It backs off as far as that takes: seeing all of the plan wins over the readability cap
 * (`FRAME.minPxPerUnit`).
 */
export function planFrame(plan: PlanPt[], view: View, fovDeg: number, host: Partial<Insets> = {}, legend = true): Frame {
  return planFrameIn(plan, view, fovDeg, planStrips(plan, view, fovDeg, host, legend))
}

/**
 * The strips the whole plan's frame keeps clear (planFrame): the host's (frameInsets) and, while `legend` shows, the
 * legend's room in the bottom-left corner. The legend covers only that corner, so the plan is first framed with no
 * strip for it; when that frame keeps every card, title and lane clear of the corner (FRAME.leftInset wide,
 * FRAME.legendTop tall) it is the frame. Otherwise the corner is kept clear by frameInsets' strip (on a view at least
 * FRAME.legendMinW wide the left strip), a left strip FRAME.leftInset wide or a bottom strip up to the legend's top
 * edge (on a view tall enough for it), whichever shows the plan larger; a tie keeps frameInsets' choice. A host left strip at least as wide as the legend's already
 * holds it: then the strips are frameInsets'.
 */
export function planStrips(plan: PlanPt[], view: View, fovDeg: number, host: Partial<Insets> = {}, legend = true): Insets {
  const usual = frameInsets(view, host, legend)
  if (!legend || view.w < FRAME.legendShowW || (host.left ?? 0) >= FRAME.leftInset || cardsOf(plan).length === 0) return usual
  const none = frameInsets(view, host, false)
  if (!reachesCorner(plan, planFrameIn(plan, view, fovDeg, none), view, fovDeg)) return none
  const left = { ...none, left: Math.max(none.left, FRAME.leftInset), right: frameInsets(view, { ...host, left: Math.max(host.left ?? 0, FRAME.leftInset) }, false).right }
  const below = { ...none, bottom: Math.max(none.bottom, FRAME.legendTop) }
  const tall = view.h - FRAME.topInset - FRAME.legendTop >= FRAME.legendTopMinH * view.h
  const options = [usual, left, ...(tall ? [below] : [])]
  let best = usual
  let bestZ = planFrameIn(plan, view, fovDeg, usual).position.z
  for (const o of options) {
    const z = planFrameIn(plan, view, fovDeg, o).position.z
    if (z < bestZ - 1e-9) {
      best = o
      bestZ = z
    }
  }
  return best
}

/**
 * Whether the plan framed by `f` draws into the legend's corner (the view's bottom-left, FRAME.leftInset wide and
 * FRAME.legendTop tall): the slot box's bottom-left corner grown by what an undated card draws past its slot at that
 * zoom (pastSlots), a step drawn larger for a soon due date as drawn, or the bottom-left of the box the arrows' lanes
 * and bends span. The same points whether or not the titles were measured (the words run right, away from the corner).
 * The boxes, not each step: an arrow into a bottom step can curve through the corner from a lane far left of it.
 */
function reachesCorner(plan: PlanPt[], f: Frame, view: View, fovDeg: number): boolean {
  const ppu = pxPerUnit(f.position.z, fovDeg, view.h)
  const sx = (x: number) => view.w / 2 + (x - f.lookAt.x) * ppu
  const sy = (y: number) => view.h / 2 - (y - f.lookAt.y) * ppu
  const inCorner = (left: number, bottom: number) => left < FRAME.leftInset && bottom > view.h - FRAME.legendTop
  const { cardW, cardH } = LAYOUT
  const cards = cardsOf(plan)
  const past = pastSlots(ppu)
  if (inCorner(sx(Math.min(...cards.map(p => p.x ?? 0))) - past.left, sy(Math.min(...cards.map(p => p.y ?? 0))) + past.bottom)) return true
  // The lanes' box (planPoints gives its top-left and bottom-right as two bend points): its bottom-left.
  const bends = plan.filter(p => p.bend)
  if (bends.length > 0 && inCorner(sx(Math.min(...bends.map(p => p.x ?? 0))), sy(Math.min(...bends.map(p => p.y ?? 0))))) return true
  for (const p of plan) {
    const x = p.x ?? 0, y = p.y ?? 0
    if (!p.bend && (p.scale ?? 1) > 1) {
      const grown = pastSlots(ppu, p.scale)
      if (inCorner(sx(x - cardW / 2) - grown.left, sy(y - cardH / 2) + grown.bottom)) return true
    }
  }
  return false
}

/** planFrame with its strips resolved (`insets`, every side given). */
function planFrameIn(plan: PlanPt[], view: View, fovDeg: number, insets: Insets): Frame {
  const nodes = cardsOf(plan)
  const bends = plan.filter(p => p.bend)
  const xs = nodes.map(n => n.x ?? 0), ys = nodes.map(n => n.y ?? 0)
  const box = { left: Math.min(...xs), right: Math.max(...xs), bottom: Math.min(...ys), top: Math.max(...ys) }
  const larger = nodes.filter(n => (n.scale ?? 1) > 1)
  // Every step with what its words measure, when handed over: then the right side counts each title as drawn.
  const titled = nodes.filter(n => n.title)
  const { cardW, cardH } = LAYOUT
  // What the plan draws past the slot box at `ppu`: an undated card at its edge, or a step drawn larger for its due
  // date, less how far its slot sits in from that edge; and an arrow's lane or bend past the box, as far as it is past.
  // With the steps' titles measured (`titled`), the right is each step's own title as drawn (pastSlots with its line
  // and whether it is a deck) less how far its card sits in from the box's right, an inner column's too: past the card
  // floor the cards keep their size on screen while the slots shrink, so an inner title may reach past the edge one.
  const past = (ppu: number) => {
    const o = pastSlots(ppu)
    if (titled.length > 0) o.right = Math.max(...titled.map(n => pastSlots(ppu, n.scale, n).right - (box.right - (n.x ?? 0) - cardW / 2) * ppu))
    for (const n of larger) {
      const p = pastSlots(ppu, n.scale, n), x = n.x ?? 0, y = n.y ?? 0
      o.right = Math.max(o.right, p.right - (box.right - x - cardW / 2) * ppu)
      o.left = Math.max(o.left, p.left - (x - cardW / 2 - box.left) * ppu)
      o.top = Math.max(o.top, p.top - (box.top - y - cardH / 2) * ppu)
      o.bottom = Math.max(o.bottom, p.bottom - (y - cardH / 2 - box.bottom) * ppu)
    }
    for (const b of bends) {
      const x = b.x ?? 0, y = b.y ?? 0
      o.right = Math.max(o.right, (x - box.right) * ppu)
      o.left = Math.max(o.left, (box.left - x) * ppu)
      o.top = Math.max(o.top, (y - box.top) * ppu)
      o.bottom = Math.max(o.bottom, (box.bottom - y) * ppu)
    }
    return o
  }
  // The slot box with each strip grown by what the plan draws past its slots at `ppu`, less what the pad holds
  // of that while keeping FRAME.edgeMargin clear of the window's (or strip's) edge.
  const at = (ppu: number) => {
    const o = past(ppu)
    const w = FRAME.fitPad * view.w - FRAME.edgeMargin, h = FRAME.fitPad * view.h - FRAME.edgeMargin
    const more = (over: number, held: number) => Math.max(0, over - held)
    const strips = { top: insets.top + more(o.top, h), bottom: insets.bottom + more(o.bottom, h), left: insets.left + more(o.left, w), right: insets.right + more(o.right, w) }
    return frameFor(nodes, view, fovDeg, { pad: FRAME.fitPad, maxZ: Infinity, ...strips })
  }
  const ppuOf = (f: Frame) => pxPerUnit(f.position.z, fovDeg, view.h)
  // Fits at `ppu` when the frame made for what the cards draw there is at least that near. On windows 600 px or wider
  // what is left past the pad only shrinks as the zoom grows (past the floor the cards and titles keep their size on
  // screen while the slots grow, and the 20-unit tail a title has at its own size, 20 x ppu px, fits in the pad less
  // edgeMargin up to the largest card scale), so the frame then fits at its own zoom too. Narrower (a phone: at 375 px
  // the pad less the margin is 6.5 px), that tail grows with the zoom past the title boost, so a small plan's edge title
  // can land a few px short of edgeMargin from the edge, still inside the window. A step drawn larger for a soon due date
  // has a longer tail at its own size, which can outgrow the pad above the floor, and an arrow's lane past the slot box
  // reaches farther on screen the nearer the frame; the search below still ends on a zoom whose frame is made for what
  // the plan draws at that zoom.
  const fits = (ppu: number) => ppuOf(at(ppu)) >= ppu
  const slots = frameFor(nodes, view, fovDeg, { pad: FRAME.fitPad, maxZ: Infinity, ...insets })
  let hi = ppuOf(slots)
  // The zoom fits: the frame made for what the plan draws there, at that zoom, placed with the lanes counted.
  if (fits(hi)) return at(hi)
  let lo = 0
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (fits(mid)) lo = mid
    else hi = mid
  }
  return at(lo)
}

/**
 * How many px a card at the plan's edge draws past its slot, on each side, when the plane shows `ppu` px per unit and
 * the card is drawn `scale` times its size for its due date (1 undated; see the step's DueView). Its title runs past the
 * slot's right edge even at its own size (to 190 of the card's 170 px, LABEL_TEXT). Past the card floor
 * (LABEL_SCALE.min) a card stays that size on screen however small its slot gets, and below the size its title reads at
 * the title is boosted (titleBoost), so the words run farther still. A card drawn larger keeps its circle where an
 * undated one's is (viewer.css, .node-card's `left`) and grows around it: up and down, a little to the left, and its
 * words farther to the right. Given what the title fit measured of its words (`title`), the words end at its longest
 * drawn line rather than its text block's end, and a deck's words are counted at its card's size.
 */
export function pastSlots(ppu: number, scale = 1, title: TitleMeasure = {}): { top: number; bottom: number; left: number; right: number } {
  const k = labelScale(ppu)
  const z = k * scale
  const { cardW, cardH } = LAYOUT
  // px from the slot's centre to the circle's centre, the same at every due-date scale
  const dot = (cardW / 2 - DOT.cx) * k
  const card = (side: number) => Math.max(0, side * z - side * ppu)
  const left = Math.max(0, dot + DOT.cx * z - (cardW / 2) * ppu)
  // The words end where the longest drawn line does, never past the text block; a deck's are not boosted (its text
  // block ends where a step's would at its card's size, viewer.css).
  const text = Math.min(LABEL_TEXT.width, title.line ?? LABEL_TEXT.width) * (title.deck ? 1 : titleBoost(k))
  const words = Math.max(0, (LABEL_TEXT.left - DOT.cx + text) * z - dot - (cardW / 2) * ppu)
  return { top: card(cardH / 2), bottom: card(cardH / 2), left, right: words }
}

/**
 * Moves the camera to the frame `frameOf` makes in the host's view (null: nothing to frame): over `ms`, telling `land`
 * once it arrives, or with `ms` 0 and no `land` a jump that is no frame of its own (a preview). False when there is
 * nothing to frame, or no view to frame it in yet (a width or height of 0 would give no position at all).
 */
function moveTo(host: FrameHost, frameOf: (view: View, fovDeg: number) => Frame | null, ms: number, land?: () => void): boolean {
  const view = host.view()
  if (!(view.w > 0 && view.h > 0)) return false
  const f = frameOf(view, host.fov())
  if (f === null) return false
  host.move(f.position, f.lookAt, ms, land)
  return true
}

/** The whole plan's frame (planFrame) from what the host knows of it; null with nothing to frame. */
const wholePlan =
  (host: FrameHost, insets: Partial<Insets>, legend: boolean) =>
  (view: View, fovDeg: number): Frame | null => {
    const nodes = host.nodes()
    return nodes.length === 0 ? null : planFrame(nodes, view, fovDeg, insets, legend)
  }

/**
 * Frames the whole plan now, keeping the host's strips (`insets`) and the legend's strip while `legend` shows clear
 * (frameInsets); false when there is nothing to frame, or no view to frame it in yet
 * (a width or height of 0 would give no position at all).
 */
export function fitPlan(host: FrameHost, insets: Partial<Insets> = {}, legend = true): boolean {
  return moveTo(host, wholePlan(host, insets, legend), FRAME.fitMs, () => host.landed?.())
}

/**
 * Puts the camera at once (no glide) where fitPlan would frame the whole plan now, from what the host knows of it (on
 * load, before the titles' first measure: the slots, each title counted as its full text block). It is a stand-in so
 * the plan is never drawn at the graph library's default camera, not a frame of its own: the host is not told it
 * landed (`landed`), and the measured frame that follows glides from here. False when there is nothing to frame, or
 * no view to frame it in yet.
 */
export function previewPlan(host: FrameHost, insets: Partial<Insets> = {}, legend = true): boolean {
  return moveTo(host, wholePlan(host, insets, legend), 0)
}

/**
 * A selection as its frame takes it: the selected step's centre (`focus`, in the plane's coordinates, y up), its
 * chain's points (selectionPoints) and the strips kept clear, as the whole plan's frame takes them (frameInsets);
 * `dot`, the selected step's circle as drawn (selectedReach; DOT.r and not overdue when left out); `top`, how far down
 * the view host chrome reaches when it reaches lower than `insets.top`. Where that is lower than the frames' top strip the selected step as drawn keeps clear of it too (its reach up grows
 * by the difference), so a step framed where its neighbours do not fit is never put under that chrome; the rest of the
 * chain keeps to the frames' strips as before.
 */
export type SelectionTarget = { focus: Pt; chain: FramePt[]; insets?: Partial<Insets>; legend?: boolean; dot?: SelectedDot; top?: number }

/**
 * The chain frame's pad as fractions of the view (chainFrame's `padX` and `padY`): CHAIN_FRAME.pad of the free area
 * across and up and down, so a short free area (above a bottom sheet) or a narrow one (beside a side sheet) loses only
 * its own share to the margin, not the whole view's.
 */
export const chainPads = (view: View, insets: Insets): { padX: number; padY: number } => ({
  padX: (CHAIN_FRAME.pad * Math.max(0, view.w - insets.left - insets.right)) / view.w,
  padY: (CHAIN_FRAME.pad * Math.max(0, view.h - insets.top - insets.bottom)) / view.h,
})

const selectionOf =
  (host: FrameHost, sel: SelectionTarget) =>
  (view: View, fovDeg: number): Frame => {
    const { insets: given = {}, legend = true } = sel
    const nodes = host.nodes()
    // The selected step drawn at its due-date scale, as the whole plan's points give it.
    const scale = nodes.find(p => !p.bend && p.x === sel.focus.x && p.y === sel.focus.y && p.scale !== undefined)?.scale ?? 1
    const insets = frameInsets(view, given, legend)
    const chrome = Math.max(0, (sel.top ?? 0) - insets.top)
    return chainFrame(sel.focus, sel.chain, view, fovDeg, {
      ...chainPads(view, insets),
      reach: ppu => {
        const r = selectedReach(ppu, scale, sel.dot)
        return { ...r, top: r.top + chrome }
      },
      pad: CHAIN_FRAME.pad,
      minZ: CHAIN_FRAME.minZ(view, fovDeg),
      // Past the readability cap if the chain needs it, never past the whole plan's own fit.
      maxZ: CHAIN_FRAME.maxZ(nodes, view, fovDeg, given, legend),
      ...insets,
    })
  }

/**
 * The selection's frame (chainFrame) in the host's view: its chain in the free area, never nearer than where cards
 * stop growing nor farther than the whole plan's fit (CHAIN_FRAME). Null with no view to frame it in yet.
 */
export function selectionFrame(host: FrameHost, sel: SelectionTarget): Frame | null {
  const view = host.view()
  return view.w > 0 && view.h > 0 ? selectionOf(host, sel)(view, host.fov()) : null
}

/**
 * Puts the camera at once (no glide) where the selection's frame would put it now, as previewPlan does for the whole
 * plan: on load with a step selected, so the plan is never drawn at the graph library's default camera before that
 * frame. Not a frame of its own: the host is not told it landed, and the selection's frame that follows glides from
 * here. False with no view to frame it in yet.
 */
export function previewSelection(host: FrameHost, sel: SelectionTarget): boolean {
  return moveTo(host, selectionOf(host, sel), 0)
}

/**
 * Whether to frame the whole plan again, given what was selected and drawn (`drawn` is a key of the drawn node ids,
 * null before the first layout) and the strips kept clear (`strips`, a key of them) before and now: whenever the
 * selection closes (with decks off the same nodes stay drawn, so this is the only cue), whenever the drawn nodes change
 * with nothing selected, and with nothing selected whenever the strips change (a host panel, the toolbar, the legend),
 * unless the user has moved the camera since the last frame (`userMoved`). Never while the user drags.
 */
export function planFitStep(before: FitState, now: FitState, dragging: boolean, userMoved = false): boolean {
  if (now.selectedId !== null || dragging || before.drawn === null) return false
  if (before.selectedId !== null || before.drawn !== now.drawn) return true
  return (before.strips ?? '') !== (now.strips ?? '') && !userMoved
}

type FitState = { selectedId: string | null; drawn: string | null; strips?: string }

/**
 * `planFitStep` over time. `see` takes each new state; while the user drags nothing is recorded as handled, so a
 * selection closed (or a drawn-set or strips change) mid-drag is fitted by `dragEnd` when the drag finishes. A strips
 * change seen while the camera is the user's (`userMoved`) is recorded as handled: no later drag end fits for it.
 */
export function planFitTracker(initial: FitState): { see: (now: FitState, dragging: boolean, userMoved?: boolean) => boolean; dragEnd: (userMoved?: boolean) => boolean } {
  let before = initial
  let latest = initial
  const see = (now: FitState, dragging: boolean, userMoved = false) => {
    latest = now
    if (dragging) return false
    const fit = planFitStep(before, now, false, userMoved)
    before = now
    return fit
  }
  return { see, dragEnd: (userMoved = false) => see(latest, false, userMoved) }
}

/**
 * Returns a handler that frames the whole plan the first time it runs with something to frame (no panel open yet),
 * then does nothing. While `selected()` is true it waits: the selection's own frame owns the camera. Given `strips`,
 * it frames with the host's strips and legend as they are when it runs (fitPlan's `insets` and `legend`), so the load's
 * frame is the one every later whole-plan fit makes. It returns whether this call framed the plan.
 */
export function fitOnce(host: FrameHost, selected: () => boolean = () => false, strips?: () => { insets: Partial<Insets>; legend: boolean }): () => boolean {
  let done = false
  return () => {
    if (done || selected()) return false
    const s = strips?.()
    done = fitPlan(host, s?.insets, s?.legend)
    return done
  }
}

/**
 * Whether a fly to a step (a chip; `fly` with its `seq`, `flown` the last seq acted on) owns the camera for the new
 * selection, so its chain frame is skipped: only a fly not yet acted on, to the selected step, and one that will happen
 * (`canFly`: the step is drawn to fly to). Otherwise the chain frame runs, or the camera would not move at all.
 */
export function flyTakesFrame(fly: { id: string; seq: number } | null, flown: number | null, selectedId: string | null, canFly: boolean): boolean {
  return fly !== null && fly.seq !== flown && fly.id === selectedId && canFly
}

/** Pixels per layout unit a fly to a step goes to (a host's fly request, such as a pick from a list). */
export const FLY_PX_PER_UNIT = 1.2

/**
 * Where (screen x, px) a fly puts the step's slot centre in a view `viewW` wide whose left `strip` px are kept clear
 * (the host left strip): the middle of the room beside the strip, moved as little as it takes to keep the
 * step as drawn (`reach`, selectedReach) FRAME.edgeMargin inside that room. Null when the room is too narrow for it.
 */
export function flyX(viewW: number, strip: number, reach: Reach): number | null {
  const lo = strip + FRAME.edgeMargin + reach.left, hi = viewW - FRAME.edgeMargin - reach.right
  if (lo > hi) return null
  return Math.min(hi, Math.max(lo, strip + (viewW - strip) / 2))
}

/**
 * Where (screen y, px) a fly puts the step's slot centre in a view `viewH` tall whose `top` px are kept clear for the
 * toolbar and whose `bottom` px for the bottom card (bottomInsetFor: the new step's own card, with its gap): the middle
 * of the room between them, moved as little as it takes to keep the step as drawn (`reach`, selectedReach)
 * FRAME.edgeMargin inside that room. When the room cannot hold it, as high as it can go: just under the toolbar's strip.
 */
export function flyY(viewH: number, top: number, bottom: number, reach: Reach): number {
  const lo = top + FRAME.edgeMargin + reach.top, hi = viewH - bottom - FRAME.edgeMargin - reach.bottom
  return Math.max(lo, Math.min(hi, top + (viewH - top - bottom) / 2))
}

/**
 * Where (screen px) a fly puts the step's slot centre: across, beside the host left strip (`strips.left`) where flyX
 * has it, the middle of the room beside the strip when the step cannot fit there, the middle of the view with no
 * strip; down, above the new step's bottom card (flyY).
 */
export function flyAt(view: View, strips: { left: number; top: number; bottom: number }, reach: Reach): { x: number; y: number } {
  const { left } = strips
  const x = left > 0 ? (flyX(view.w, left, reach) ?? left + (view.w - left) / 2) : view.w / 2
  return { x, y: flyY(view.h, strips.top, strips.bottom, reach) }
}

/** How far (px) the pointer must travel from where it was pressed before the press counts as a drag. */
const DRAG_PX = 3

/**
 * Whether the user has moved the camera themselves since the last `clear` (an automatic frame, F, Shift+F): the camera
 * changed while they held the pointer down on the canvas (`start` to `end`) and had dragged it (`down` where it was
 * pressed, `move` as it goes, more than a few pixels), or they turned the wheel. A press that moves nothing (a click,
 * a right-click on an edge) is no move, and neither is the camera changing on its own (a frame gliding), even under a
 * press.
 */
export function userMoveTracker(): {
  down(x: number, y: number): void
  move(x: number, y: number): void
  start(): void
  end(): void
  change(): void
  wheel(): void
  moved(): boolean
  clear(): void
} {
  let pressed = false
  let at: { x: number; y: number } | null = null
  let dragged = false
  let moved = false
  return {
    down: (x, y) => {
      at = { x, y }
      dragged = false
    },
    move: (x, y) => {
      if (at && Math.hypot(x - at.x, y - at.y) > DRAG_PX) dragged = true
    },
    start: () => {
      pressed = true
    },
    end: () => {
      pressed = false
      at = null
      dragged = false
    },
    change: () => {
      if (pressed && dragged) moved = true
    },
    wheel: () => {
      moved = true
    },
    moved: () => moved,
    clear: () => {
      moved = false
    },
  }
}

type Size = { w: number; h: number }

/**
 * Turns a stream of view sizes (`see`, from `initial`) into settled resizes: the first new size of a burst calls `start`
 * (before anything uses it, so what the old view showed can still be measured), and RESIZE_SETTLE_MS after the last
 * change `settle` gets the size the burst ended at (even when that is where it began). `pending` is true in between.
 */
export function sizeSettler(initial: Size, on: { start: () => void; settle: (size: Size) => void }, delayMs = RESIZE_SETTLE_MS) {
  let last = initial
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending = false
  return {
    see: (size: Size) => {
      if (size.w === last.w && size.h === last.h) return
      last = size
      if (!pending) {
        pending = true
        on.start()
      }
      clearTimeout(timer)
      timer = setTimeout(() => {
        pending = false
        on.settle(last)
      }, delayMs)
    },
    pending: () => pending,
    cancel: () => {
      clearTimeout(timer)
      pending = false
    },
  }
}
