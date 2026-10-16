import { bracketRoom } from './bracketRoom.js'
import { labelScale, pxPerUnit } from './camera.js'
import { edgeCurve } from './edgePath.js'
import { LAYOUT, type Pt } from './layered.js'
import { SIZE } from './due.js'
import { DOT, markRoom, type LabelNode } from './nodeLabel.js'
import type { Priority } from './schema.js'
import { aimHoles, crossed, keeps, MARK_CSS, markSide, placePlate, PLATE, plateHoles, plateShift, plateWidths, wrappedAt, type Drawn, type HoleAim, type MarkStyle, type Other, type Wrapped } from './plateFit.js'
import { FIT, fitTitles, rankOf, type Box, type Fit, type FitInput, type Rank } from './titleFit.js'

/**
 * The graph's side of the title rule (titleFit.ts): measure each drawn label on screen, decide, and mark each label
 * with data-title-fit ("full", "short" with --fit-w, or "dot"), which viewer.css draws.
 */

/**
 * What viewer.css draws, in card px, that the rule needs to know (titleFitDom.test.ts reads the stylesheet to keep
 * them the same): the title's font size and its line (1.2 of it), how wide the text block is, and how far past the
 * circle the overdue ring (inset -9px) and the chain, selected or open-deck ring (2px out, 2px wide) reach.
 */
export const TITLE_CSS = { px: 13, line: 1.2, width: 150, overdueRing: 9, ring: 4 } as const
const TITLE_PX = TITLE_CSS.px
const LINE = TITLE_CSS.line

/**
 * How much larger than its card the words draw when zoomed out (--title-boost): enough that an undated title is drawn
 * at BOOST_PX (half a px over the legibility floor, FIT.floor, so measuring never puts it under) however small the cards
 * get; 1 once the cards draw it that large on their own. Every title is boosted by the same ratio, so a step due soon
 * still reads larger than one far off (and one far enough off falls under the floor and is left out).
 */
export const BOOST_PX = FIT.floor + 0.5

export function titleBoost(labelScale: number, px: number = BOOST_PX): number {
  return Math.max(1, px / (TITLE_PX * labelScale))
}

/**
 * How many times its size in the layout a deck's words draw at `ppu` (screen px per layout unit): its card's size over
 * its slot (above 1 past the card floor) times the boost every title takes. Its text block keeps its card's width, but
 * its lines are that much taller, so it lists as many names as fit its row's room at this scale (deckListed).
 */
export function deckScale(ppu: number): number {
  const k = labelScale(ppu)
  return (k / ppu) * titleBoost(k)
}

/** The plan's goals (steps nothing else needs) and what they need directly. */
export interface Top {
  goals: ReadonlySet<string>
  needs: ReadonlySet<string>
}

export function topOf(nodes: readonly { id: string; depends_on: readonly string[] }[]): Top {
  const needed = new Set(nodes.flatMap(n => n.depends_on))
  const goals = nodes.filter(n => !needed.has(n.id))
  return { goals: new Set(goals.map(n => n.id)), needs: new Set(goals.flatMap(n => n.depends_on)) }
}

const NO_TOP: Top = { goals: new Set(), needs: new Set() }

/**
 * An arrow drawn into a goal from one of its own needs, as the graph draws it: the need (`from`), the layout's
 * waypoints, its head's length (layout units at the card's size, as linkStyle gives it), its line's width (px) and how
 * much larger than its slot each end draws (its due date).
 */
export interface GoalArrow {
  from: string
  points: readonly Pt[]
  arrow: number
  width: number
  scales: { start: number; end: number }
}

/**
 * Where each of `arrows` is drawn on screen, at the zoom `ppu` (screen px per layout unit), placed by its need's
 * circle as drawn (`dots`): the line as edgePath draws it, at the card's drawn scale, out of the top of the need's
 * circle (`DOT.reach` card px over its centre) up to its head's tip; a box per stretch of it, as wide as the line. Past
 * the card floor, at a whole-plan zoom, the rows are closer than the line's ends: it then runs flat across just over
 * the need's circle, between the two rows. Nothing for a need not drawn.
 */
export function goalArrowBoxes(arrows: readonly GoalArrow[], dots: ReadonlyMap<string, Box | null>, ppu: number): Box[] {
  const cardScale = Math.round((labelScale(ppu) / ppu) * 50) / 50
  const boxes: Box[] = []
  for (const a of arrows) {
    const dot = dots.get(a.from)
    if (!dot || a.points.length < 2) continue
    const { line, tip } = edgeCurve([...a.points], { cardH: LAYOUT.cardH, cardScale, arrow: a.arrow * cardScale, dx: LAYOUT.cardW / 2 - DOT.cx, reach: DOT.reach, scales: a.scales })
    const start = line[0]
    // the line starts over the circle's centre across, `reach` card px (at the need's date size) over it
    const x0 = (dot.left + dot.right) / 2
    const y0 = (dot.top + dot.bottom) / 2 - DOT.reach * cardScale * a.scales.start * ppu
    const drawn = [...line, tip].map(p => ({ x: x0 + (p.x - start.x) * ppu, y: y0 + (p.y - start.y) * ppu }))
    const w = a.width / 2
    for (let i = 1; i < drawn.length; i++) {
      const [p, q] = [drawn[i - 1], drawn[i]]
      boxes.push({ left: Math.min(p.x, q.x) - w, top: Math.min(p.y, q.y) - w, right: Math.max(p.x, q.x) + w, bottom: Math.max(p.y, q.y) + w })
    }
  }
  return boxes
}

/** Each label's rank from what it shows: plan order is the order of `nodes` (steps in plan order, then decks). */
export function labelRanks(nodes: readonly LabelNode[], focusedId: string | null, top: Top = NO_TOP): Map<string, Rank> {
  return new Map(
    nodes.map((n, order) => [
      n.id,
      rankOf({
        order,
        selected: n.selected,
        chain: n.chain !== '',
        focused: n.id === focusedId,
        goal: top.goals.has(n.id),
        dueNear: !!n.due && (n.due.overdue || n.due.strength >= 1),
        high: n.priority === 'high',
        need: top.needs.has(n.id),
        ready: n.state === 'ready' || n.state === 'doing',
      }),
    ]),
  )
}

/**
 * Saved shapes hold while the words draw as they did: a web font swapping in changes that, so it starts them over
 * (`fontGeneration` is in every shape's key).
 */
let fontGeneration = 0

/**
 * Calls `changed` once the page's fonts have loaded and whenever more load later; returns a stop function. With
 * `titlesFont` (the titles' CSS font-family list, read when a font loads), a later load counts only where one of the
 * faces it names is a family the titles draw with: a font loading for something else on the page (the Next.js dev
 * overlay's, seconds after the page, in its own shadow root) leaves every title, and every size kept for one, as is.
 * Family names are compared whatever their case; a list read empty counts every load.
 */
export function watchFonts(
  changed: () => void,
  fonts: FontFaceSet | undefined = typeof document === 'undefined' ? undefined : document.fonts,
  titlesFont?: () => string,
): () => void {
  if (!fonts) return () => {}
  let live = true
  const bump = () => {
    if (!live) return
    fontGeneration++
    changed()
  }
  const loaded = (e: Event) => {
    const faces = (e as Partial<FontFaceSetLoadEvent>).fontfaces
    if (titlesFont && faces?.length) {
      // CSS family names match whatever their case; a list read empty (the layer detached as the font loaded) tells
      // nothing, so the load may be the titles' own
      const families = new Set(fontFamilies(titlesFont()).map(f => f.toLowerCase()))
      if (families.size > 0 && !faces.some(f => families.has(unquote(f.family).toLowerCase()))) return
    }
    bump()
  }
  fonts.ready.then(bump, () => {})
  fonts.addEventListener?.('loadingdone', loaded)
  return () => {
    live = false
    fonts.removeEventListener?.('loadingdone', loaded)
  }
}

const unquote = (name: string) => name.trim().replace(/^(["'])(.*)\1$/, '$2')

/** The family names in a CSS font-family list, unquoted. */
const fontFamilies = (list: string) => list.split(',').map(unquote).filter(Boolean)

/**
 * The boost a saved shape was measured at, in steps of 4%: a title wraps a little differently at another size (not
 * quite in proportion, at small sizes), so a shape is measured again once the boost has moved a step.
 */
export const boostStep = (boost: number) => Math.round(Math.log(boost) / Math.log(1.04))

const rectOf = (e: Element | null): Box | null => {
  if (!e) return null
  const r = e.getBoundingClientRect()
  return r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null
}
const union = (boxes: (Box | null)[]): Box | null =>
  boxes.reduce<Box | null>(
    (u, b) => (!b ? u : !u ? b : { left: Math.min(u.left, b.left), top: Math.min(u.top, b.top), right: Math.max(u.right, b.right), bottom: Math.max(u.bottom, b.bottom) }),
    null,
  )

/**
 * A step's words as drawn in full, relative to its circle's centre: across in card px (they start a fixed distance
 * right of the circle), the rest in boosted card px (the words draw --title-boost times the card), so one measurement
 * holds at every zoom until what the label says, or how, changes (`key`). Decks are measured every time.
 */
interface Shape {
  key: string
  /** The boost step it was measured at (boostStep): a still run measures again once it moved. */
  step: number
  left: number
  top: number
  w: number
  h: number
  due?: { top: number; w: number; h: number }
  textW: number
  /** How far its longest drawn line ends from where its text block starts (drawnLine), across like `w`. */
  line?: number
}
/**
 * The last few shapes of each label, by what it said and how (`key`): a step selected and let go again finds its
 * unselected shape still there, so a run that measures nothing (during a glide) can place it.
 */
const shapes = new WeakMap<HTMLElement, Map<string, Shape>>()
const SHAPES_KEPT = 4
function saveShape(el: HTMLElement, sh: Shape) {
  let m = shapes.get(el)
  if (!m) shapes.set(el, (m = new Map()))
  m.delete(sh.key)
  m.set(sh.key, sh)
  if (m.size > SHAPES_KEPT) m.delete(m.keys().next().value!)
}

/**
 * How far right of where a step's text block starts (`text`, .node-label-text) its longest drawn line ends on screen,
 * in px: the farthest a piece of its title (the priority mark and the words, each line as laid out) or its due line
 * reaches. The title is as wide as its text block once it wraps (fit-content), though its lines may end well short of
 * that. Null where the page gives no pieces. Read in a run that measures, with the label drawn in full and nothing
 * written since the run's reads began, so it lays nothing out again.
 */
export function drawnLine(text: HTMLElement): number | null {
  if (typeof Range === 'undefined' || typeof Range.prototype.getClientRects !== 'function') return null
  const left = text.getBoundingClientRect().left
  const range = document.createRange()
  let end: number | null = null
  const mark = rectOf(text.querySelector('.node-prio'))
  if (mark) end = mark.right
  for (const part of text.querySelectorAll('.node-label-title, .node-label-due')) {
    const walk = document.createTreeWalker(part, NodeFilter.SHOW_TEXT)
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      range.selectNodeContents(n)
      for (const r of range.getClientRects()) if (r.width > 0) end = Math.max(end ?? -Infinity, r.right)
    }
  }
  return end === null ? null : end - left
}

/**
 * What the last measure of a step's words found its longest drawn line to be (drawnLine): how far it ends from where
 * its text block starts, in card px at no boost (the words draw --title-boost times that), for the whole-plan frame
 * (frame.ts, TitleMeasure). Undefined until its words as drawn now were measured, and for a deck or the selected step (never kept).
 * A Map read, no layout: the frame takes it as data.
 */
export function titleLine(el: HTMLElement): number | undefined {
  // the shape kept for the words as drawn now (shapeKey reads attributes and text, no layout), not the one saved last:
  // words edited back to an earlier title are placed from its kept shape without saving it again
  return shapes.get(el)?.get(shapeKey(el))?.line
}

const shapeKey = (el: HTMLElement) =>
  [
    fontGeneration,
    el.querySelector('.node-label-title')?.textContent,
    el.querySelector('.node-label-due')?.textContent,
    el.style.getPropertyValue('--near-scale'),
    el.style.getPropertyValue('--dot-r'),
    el.dataset.priority,
    el.dataset.selected,
    el.dataset.dueInherited,
  ].join('|')

/**
 * A label's wall at the zoom: of the lanes running past its row (`walls`, layout units right of its card's centre, left
 * to right, layered.ts), the nearest drawn more than `past` px right of its circle's centre (runTitleFit passes where
 * a lane's line would end the gap before the words start: one left of that is no wall, the next one right is), in
 * screen px right of the circle's centre; none if no lane is. `ppu` is screen px per layout unit; the card is drawn labelScale(ppu) px per card px about its centre, so
 * the circle sits (cardW/2 - DOT.cx) of those left of that centre while a lane sits `w` units, ppu px each, right of
 * it. Decided here, at the zoom, not in the layout: past the card floor the circle moves left of where the layout puts
 * it, and a lane just left of it in the layout is drawn between the circle and the words (past the ceiling it moves
 * right, and a lane just right of it in the layout is drawn left of the circle, where it is no wall).
 */
export function laneWall(walls: readonly number[], ppu: number, past = 0): number | undefined {
  const centre = (LAYOUT.cardW / 2 - DOT.cx) * labelScale(ppu)
  for (const w of walls) if (centre + w * ppu > past) return centre + w * ppu
  return undefined
}

/**
 * The lanes ending a row or two from a label's (`runs`, layered.ts wallRuns: each one's x and run span, layout units
 * from its card's centre, y down) whose run as drawn at the zoom meets its words, from `top` to `bottom` (screen px
 * below its circle's centre), as `walls` has lanes (layout units right of its card's centre). A run is drawn half a card
 * past its ends at the card's drawn size (edgePath), cardH/2 card px of labelScale(ppu) screen px each, so past the card
 * floor, where cards stop shrinking, it reaches further into the rows past its ends the further out the zoom; a run
 * within FIT.gap of the words counts, as a lane's line is kept that clear of them.
 */
export function runWalls(runs: readonly { dx: number; top: number; bottom: number }[], ppu: number, top: number, bottom: number): number[] {
  const half = (LAYOUT.cardH / 2) * labelScale(ppu)
  return runs.filter(r => r.top * ppu - half < bottom + FIT.gap && r.bottom * ppu + half > top - FIT.gap).map(r => r.dx)
}

/** A label's data-wall-runs, parsed once for each value it is given. */
const parsedRuns = new WeakMap<HTMLElement, { from: string; runs: { dx: number; top: number; bottom: number }[] }>()
function runsOf(el: HTMLElement): { dx: number; top: number; bottom: number }[] {
  const from = el.dataset.wallRuns ?? ''
  const saved = parsedRuns.get(el)
  if (saved?.from === from) return saved.runs
  const runs = from
    ? from.split(',').map(r => {
        const [dx, top, bottom] = r.split(':').map(Number)
        return { dx, top, bottom }
      })
    : []
  parsedRuns.set(el, { from, runs })
  return runs
}

/** A label's data-walls as numbers, parsed once for each value it is given (the fit reads it on every run). */
const parsedWalls = new WeakMap<HTMLElement, { from: string; walls: number[] }>()
function wallsOf(el: HTMLElement): number[] {
  const from = el.dataset.walls ?? ''
  const saved = parsedWalls.get(el)
  if (saved?.from === from) return saved.walls
  const walls = from ? from.split(',').map(Number) : []
  parsedWalls.set(el, { from, walls })
  return walls
}

/**
 * Runs the rule once over every label on screen. On a still run (`measure`), a step whose words changed, or whose saved
 * shape is from another boost step, (and every deck) is drawn in full for a moment (in the same task, so that is never
 * painted) and measured; the rest are placed from their circle and what was measured before. While the view moves
 * (`measure` false) nothing is drawn afresh: saved shapes are scaled to the boost, a deck drawn in full is read where it
 * is drawn (that is its full size), and a label with neither (a cut or hidden deck, a new one) stays as it is drawn,
 * placed first as it stands. Then it decides and marks each. Labels the renderer has hidden are left as they are. `ppu`
 * (screen px per layout unit, the zoom) places a label's wall (laneWall over its data-walls), if it has one. A `fresh`
 * run decides every title as if none were shown before (no slack kept for a title or cut drawn last run): the run after
 * the load's frame lands, so the plan opens fitted at its own zoom, not at the one the labels first drew at. Returns
 * how long it took, in ms. `arrows`, the arrows drawn into the plan's goals from their own needs: a goal's and a goal's
 * own need's words keep clear of them (goalArrowBoxes, at `ppu`).
 */
export function runTitleFit(labels: Map<string, HTMLElement>, ranks: Map<string, Rank>, boost: number, measure = true, ppu?: number, area?: Box, fresh = false, arrows: readonly GoalArrow[] = []): number {
  const t0 = performance.now()
  type Row = { id: string; el: HTMLElement; prev?: Fit; prevCut?: FitInput['prevCut']; dot: Box | null; k: number; u: number; deck: boolean; key: string; shape?: Shape; asIs: boolean }
  const rows: Row[] = []
  const step = boostStep(boost)
  // Every circle first, while nothing is written yet (one layout).
  for (const [id, el] of labels) {
    if (!el.isConnected || el.style.display === 'none') continue
    const dot = rectOf(el.querySelector('.node-dot'))
    const r = parseFloat(el.style.getPropertyValue('--dot-r')) || SIZE.normal
    // Screen px per card px (the zoom and the due-date ratio together), from the circle's drawn size.
    const k = dot ? (dot.right - dot.left) / (2 * r) : 1
    const deck = el.dataset.deck === 'true'
    // The selected step's plate is measured every run, moving or not: it is always drawn (viewer.css), so what is on
    // the page is its real box, and it has its own size (not the boost every other title takes).
    const plate = el.dataset.selected === 'true'
    const key = shapeKey(el)
    const cached = shapes.get(el)?.get(key)
    const prev = el.dataset.titleFit as Fit | undefined
    // A cut as drawn: its lines, how far it is moved and how wide (--fit-w, in card px), on screen.
    const fitW = parseFloat(el.style.getPropertyValue('--fit-w'))
    const prevCut = prev === 'short' ? { lines: Number(el.dataset.titleLines) || 1, dy: (parseFloat(el.style.getPropertyValue('--fit-dy')) || 0) * k, ...(Number.isFinite(fitW) ? { width: fitW * k } : {}) } : undefined
    const shape = !deck && !plate && cached?.key === key && (!measure || cached.step === step) ? cached : undefined
    // A deck's words take the boost like any title (its text block keeps its card's width, and it lists as many names
    // as fit its row's room at that size: deckScale), hovered or not, so hovering one changes no fit.
    // A deck drawn in full is on the page as it would be measured: read where it is, moving or not, so its list gives
    // way to the selected plate and the chain's titles as any title does (not placed first as it stands). One under the
    // pointer or the keyboard focus stays as it stands until the view is still: cut, it would flip to the raised hover
    // style mid-gesture.
    const pointed = el.dataset.hovered === 'true' || el.matches(':focus')
    const seen = deck && (prev === undefined || prev === 'full') && !pointed
    rows.push({ id, el, prev, prevCut, dot, k, u: k * (plate ? 1 : boost), deck, key, shape, asIs: !measure && !shape && !plate && !seen })
  }
  placeMarks(rows, area)
  // Then the labels to measure afresh, all drawn in full at once.
  // (A deck already drawn in full while the view moves is read as it is: nothing to take off and write back.)
  for (const r of rows) if (!r.shape && !r.asIs && r.dot && (measure || r.prev !== 'full')) delete r.el.dataset.titleFit
  // The arrows into the goals, from where their needs' circles are drawn: the top rows' words keep clear of them.
  const overhead = ppu && arrows.length ? goalArrowBoxes(arrows, new Map(rows.map(r => [r.id, r.dot])), ppu) : []
  const inputs: FitInput[] = []
  for (const row of rows) {
    const { id, el, prev, prevCut, dot, k, u, deck } = row
    if (!dot) continue
    const cx = (dot.left + dot.right) / 2
    const cy = (dot.top + dot.bottom) / 2
    // The lanes in a block running past this row (layered.ts, data-walls), read from the label's own data, no layout:
    // the nearest drawn right of the circle at this zoom (laneWall), past any whose line (FIT.lane either side) ends
    // FIT.gap or more before the words start at `left` (a lane through the circle, or between it and the words with
    // room to spare, is no wall; one closer than that is, even with the words starting just past a large circle).
    // An arrow climbing past this row into the circle of a step beside a block bends to that circle as drawn, which sits
    // as far left of its card's centre as this circle does of this one's: data-wall-dot (card centre to card centre).
    // That holds for a hovered, selected or date-sized target too: those change a circle's radius, ring and brackets,
    // never its centre (viewer.css .node-card: a date-sized card is moved back so its dot stays where an unscaled one
    // would, and every card draws at the same labelScale(ppu)), and the arrow ends at that centre.
    const [dotDx, dotTop, dotBottom] = (el.dataset.wallDot ?? '').split(':').map(Number)
    const dotWall = el.dataset.wallDot && ppu ? cx + dotDx * ppu : undefined
    // A lane ending a row or two away whose run, drawn larger past the card floor, reaches the words' height is a wall
    // too (data-wall-runs, runWalls): `from`, `to` are the words' top and bottom on screen.
    const wallFor = (left: number, from: number, to: number) => {
      const reach = ppu ? runWalls(runsOf(el), ppu, from - cy, to - cy) : []
      const walls = reach.length ? [...wallsOf(el), ...reach].sort((a, b) => a - b) : wallsOf(el)
      const near = ppu ? laneWall(walls, ppu, Math.max(0, left - cx - FIT.lane - FIT.gap)) : undefined
      const lane = near === undefined ? undefined : cx + near
      return lane === undefined ? dotWall : dotWall === undefined ? lane : Math.min(lane, dotWall)
    }
    // Where the line at a label's wall is drawn, top to bottom on screen: its run (a lane's: data-wall-runs at its x; an
    // arrow's climb into a circle beside: data-wall-dot) drawn half a card past its ends at the card's drawn size, as
    // runWalls takes it. Undefined where the page does not say (the fit then takes the label's row, a line past it).
    const spanFor = (wall: number | undefined): { top: number; bottom: number } | undefined => {
      if (wall === undefined || !ppu) return undefined
      const half = (LAYOUT.cardH / 2) * labelScale(ppu)
      const centre = (LAYOUT.cardW / 2 - DOT.cx) * labelScale(ppu)
      const at = wall === dotWall ? (Number.isFinite(dotTop) && Number.isFinite(dotBottom) ? [{ top: dotTop, bottom: dotBottom }] : []) : runsOf(el).filter(r => Math.abs(cx + centre + r.dx * ppu - wall) < 1e-6)
      if (!at.length) return undefined
      return { top: cy + Math.min(...at.map(r => r.top)) * ppu - half, bottom: cy + Math.max(...at.map(r => r.bottom)) * ppu + half }
    }
    const walled = (left: number, from: number, to: number) => {
      const wall = wallFor(left, from, to)
      const span = spanFor(wall)
      return wall === undefined ? {} : span ? { wall, wallSpan: span } : { wall }
    }
    // The selected step's words are its plate (padding, priority mark and id line all inside it), placed first and never
    // cut; its circle is taken with the brackets drawn around it, so no other title is drawn over either.
    const whole = el.dataset.selected === 'true'
    let title: Box | null
    let due: Box | undefined
    let maxWidth: number
    // The "+N" tag under the circle (needs drawn elsewhere) is always drawn: kept clear like the circle.
    let fan = el.dataset.elsewhere ? (union([dot, rectOf(el.querySelector('.node-label-elsewhere'))]) ?? dot) : dot
    if (row.asIs) {
      // Not measured while the view moves: kept clear as it is drawn now (the circle alone when hidden).
      const text = prev === 'dot' ? null : rectOf(el.querySelector('.node-label-text'))
      if (deck) fan = union([dot, ...[...el.querySelectorAll('.node-deck-dot')].map(rectOf)]) ?? dot
      inputs.push({ id, rank: { tier: -1, order: 0 }, dot: fan, ring: ringOf(el) * k, title: text ?? { left: cx, top: cy, right: cx, bottom: cy }, line: TITLE_PX * u * LINE, maxWidth: 0, font: TITLE_PX * u, ...walled(text?.left ?? dot.right, text?.top ?? dot.top, text?.bottom ?? dot.bottom) })
      continue
    }
    if (row.shape) {
      const sh = row.shape
      const left = cx + sh.left * k
      const top = cy + sh.top * u
      title = { left, top, right: left + sh.w * u, bottom: top + sh.h * u }
      due = sh.due && { left, top: cy + sh.due.top * u, right: left + sh.due.w * u, bottom: cy + (sh.due.top + sh.due.h) * u }
      maxWidth = sh.textW * u
    } else {
      const text = rectOf(el.querySelector('.node-label-text'))
      const titleEl = el.querySelector('.node-label-title')
      // A deck's words are its title and its list.
      title = whole ? text : deck ? union([rectOf(titleEl), rectOf(el.querySelector('.node-deck-mix')), rectOf(el.querySelector('.node-deck-list'))]) : rectOf(titleEl)
      due = whole ? undefined : (rectOf(el.querySelector('.node-label-due')) ?? undefined)
      if (!text || !title) continue
      maxWidth = text.right - text.left
      if (deck) fan = union([dot, ...[...el.querySelectorAll('.node-deck-dot')].map(rectOf)]) ?? dot
      else if (!whole) {
        const line = drawnLine(el.querySelector<HTMLElement>('.node-label-text')!)
        const sh: Shape = {
          key: row.key,
          step,
          left: (title.left - cx) / k,
          top: (title.top - cy) / u,
          w: (title.right - title.left) / u,
          h: (title.bottom - title.top) / u,
          due: due && { top: (due.top - cy) / u, w: (due.right - due.left) / u, h: (due.bottom - due.top) / u },
          textW: maxWidth / u,
          ...(line === null ? {} : { line: line / u }),
        }
        saveShape(el, sh)
      }
    }
    const font = TITLE_PX * u
    // A held step's tag over its circle is part of what others keep clear of; so are the rings drawn around it.
    const held = el.dataset.hold === 'true' ? rectOf(el.querySelector('.node-label-held')) : null
    if (whole) fan = union([fan, bracketsOf(el, dot, k)])!
    const ring = ringOf(el) * k
    // A deck whose list is open keeps its words whole: the list is placed beside them.
    const rank = el.getAttribute('aria-expanded') === 'true' ? { tier: 0, order: -1 } : (ranks.get(id) ?? { tier: 8, order: Number.MAX_SAFE_INTEGER })
    inputs.push({ id, rank, dot: held ? union([fan, held])! : fan, ring, title, due, mark: markRoom((el.dataset.priority ?? 'normal') as Priority, k, font / k) * k, line: font * LINE, maxWidth, font, ...walled(title.left, title.top, Math.max(title.bottom, due?.bottom ?? -Infinity)), ...(rank.top && overhead.length ? { overhead } : {}), ...(fresh ? {} : { prev, prevCut }) })
  }
  const fits = fitTitles(inputs)
  for (const { id, el, prev, k, asIs } of rows) {
    if (asIs) continue
    const f = fits.get(id)
    // Not measured (no circle drawn yet): keep what it had.
    const fit = f?.fit ?? prev
    if (fit && el.dataset.titleFit !== fit) el.dataset.titleFit = fit
    const cut = f?.fit === 'short'
    // In card px: the words draw inside the card, which is k times its size on screen.
    setVar(el, '--fit-w', cut && f.width !== undefined ? `${(f.width / k).toFixed(1)}px` : '')
    setVar(el, '--fit-dy', cut && f.dy ? `${(f.dy / k).toFixed(1)}px` : '')
    const lines = cut && f.lines === 2 ? '2' : undefined
    if (el.dataset.titleLines !== lines) {
      if (lines) el.dataset.titleLines = lines
      else delete el.dataset.titleLines
    }
  }
  return performance.now() - t0
}

/**
 * The selected step's brackets and plate alone (placeMarks), from where every circle is drawn now, with no title
 * fitted: run each frame of a glide, where titles are fitted only once, so the brackets and the plate follow the circles
 * gliding round them (the plate stays where it is while that crosses none). O(labels).
 */
export function fitBrackets(labels: Map<string, HTMLElement>, area?: Box) {
  const rows: { el: HTMLElement; dot: Box | null; k: number; deck: boolean }[] = []
  for (const el of labels.values()) {
    if (!el.isConnected || el.style.display === 'none') continue
    const dot = rectOf(el.querySelector('.node-dot'))
    const r = parseFloat(el.style.getPropertyValue('--dot-r')) || SIZE.normal
    rows.push({ el, dot, k: dot ? (dot.right - dot.left) / (2 * r) : 1, deck: el.dataset.deck === 'true' })
  }
  placeMarks(rows, area, true)
}

/**
 * The selected step's brackets (markRooms), then its plate (fitPlate), from every other circle as drawn now, found
 * once. `area` is the free graph area on screen (the window less the toolbar, side panel and bottom card strips).
 *
 * On a frame of a glide (`glide`) the plate is read with every circle, before anything is written, and where the
 * brackets' room changes it is shifted across by what that moves it (plateShift) rather than measured again after the
 * write, which would lay the page out on every frame; it is measured only where the place so worked out crosses a circle
 * (or leaves the free area), and then placed as before.
 */
function placeMarks(rows: readonly CircleRow[], area?: Box, glide = false) {
  const sel = rows.find(r => r.dot && r.el.dataset.selected === 'true')
  const others = sel ? circlesBut(rows, sel) : []
  const seen = glide && sel ? rectOf(sel.el.querySelector('.node-label-text')) : null
  const from = sel ? roomOf(sel.el) : Infinity
  markRooms(rows, sel, others)
  if (!seen || !sel) return fitPlate(rows, sel, others, area)
  const style = markStyleOf(sel)
  const to = roomOf(sel.el)
  const shift = plateShift(from, to, style, sel.k)
  const full = { ...seen, left: seen.left + shift, right: seen.right + shift }
  fitPlate(rows, sel, others, area, { full, s: sel.k * plateBoost(style), side: markSide(to, style) * sel.k })
}

/** How much larger than its card the stylesheet draws the plate's words (--boost), exactly. */
const plateBoost = (style: MarkStyle) => Math.max(1, MARK_CSS.minTitle / (MARK_CSS.title * style.z))

/** The brackets' room as written (--mark-room, card px): Infinity where none is. */
function roomOf(el: HTMLElement): number {
  const v = el.style.getPropertyValue('--mark-room')
  return v ? parseFloat(v) : Infinity
}

/** The selected circle as the stylesheet sizes its brackets, from what is written on it and on the label layer. */
function markStyleOf(sel: { el: HTMLElement }): MarkStyle {
  const scale = parseFloat(sel.el.parentElement?.style.getPropertyValue('--label-scale') ?? '') || 1
  const near = parseFloat(sel.el.style.getPropertyValue('--near-scale')) || 1
  return { dotR: parseFloat(sel.el.style.getPropertyValue('--dot-r')) || SIZE.normal, z: scale * near, overdue: sel.el.dataset.overdue === 'true' }
}

/**
 * The selected step's brackets get as much room as there is before the nearest other circle (with its ring, a deck with
 * its fan, and its "+N" tag), as --mark-room in its card px (bracketRoom.ts; viewer.css draws the brackets no wider, but never inside the
 * circle's own ring). Every other label drops one it had, so a step selected again starts from the usual size. Runs
 * before the brackets and the plate are measured, so the fit sees them as drawn.
 */
function markRooms(rows: readonly CircleRow[], sel: CircleRow | undefined, others: readonly Other[]) {
  for (const r of rows) if (r !== sel) setVar(r.el, '--mark-room', '')
  if (!sel?.dot) return
  // a "held" tag is not a circle: the brackets hold circles alone (the plate keeps clear of it too)
  const room = bracketRoom((sel.dot.left + sel.dot.right) / 2, (sel.dot.top + sel.dot.bottom) / 2, others.filter(o => !o.held).map(o => o.box))
  setVar(sel.el, '--mark-room', Number.isFinite(room) && sel.k > 0 ? `${(room / sel.k).toFixed(1)}px` : '')
}

type CircleRow = { el: HTMLElement; dot: Box | null; k: number; deck: boolean }

/**
 * Every other step's circle on screen as drawn, each with what is drawn round it: its ring, a deck's fan, and its "+N"
 * tag (needs drawn elsewhere) and its "held" tag (both always drawn), each a box of its own, named by the step's id.
 */
function circlesBut(rows: readonly CircleRow[], sel: CircleRow): Other[] {
  const out: Other[] = []
  for (const r of rows) {
    if (r === sel || !r.dot) continue
    const id = r.el.dataset.nodeId ?? ''
    const fan = r.deck ? (union([r.dot, ...[...r.el.querySelectorAll('.node-deck-dot')].map(rectOf)]) ?? r.dot) : r.dot
    const ring = ringOf(r.el) * r.k
    out.push({ id, box: { left: fan.left - ring, top: fan.top - ring, right: fan.right + ring, bottom: fan.bottom + ring } })
    const tag = r.el.dataset.elsewhere ? rectOf(r.el.querySelector('.node-label-elsewhere')) : null
    if (tag) out.push({ id, box: tag })
    const held = r.el.dataset.hold === 'true' ? rectOf(r.el.querySelector('.node-label-held')) : null
    if (held) out.push({ id, box: held, held: true })
  }
  return out
}

/**
 * The selected step's plate hides no other circle (plateFit.ts). Where it is drawn now is kept while that crosses none
 * (and is its usual place or inside `area`). Otherwise it is drawn in full, then, where that crosses one, at each
 * narrower width that would end it before one (--plate-w, in the plate's own px; its words wrap), measured, and placed
 * (moved up or down by --plate-dy) where it crosses the fewest, inside `area` (else the window). Every label it still
 * crosses is marked data-under-plate, and the plate's backing is cut round it (--plate-holes, with data-plate-holes on
 * the selected label), so viewer.css shows that circle through the plate under its words; every other label drops the
 * mark, and a label not selected drops its plate's place and holes. Runs after the brackets are sized (markRooms) and before the plate is
 * measured for the fit, so every other title keeps clear of it as drawn. `drawn`, where given, is the plate worked out
 * without measuring it (placeMarks, on a glide frame; its `full` is where it is drawn now, in full where it is in its
 * usual place): kept as is where that keeps, else placed afresh from it (one drawn narrowed or moved, from its size in
 * full as last drawn so: drawnInFull), measuring only the narrower widths tried.
 */
function fitPlate(rows: readonly CircleRow[], sel: CircleRow | undefined, others: readonly Other[], area?: Box, drawn?: KnownPlate) {
  const under = new Set<string>()
  let cut: Cut | null = null
  for (const r of rows)
    if (r !== sel) {
      setVar(r.el, '--plate-w', '')
      setVar(r.el, '--plate-dy', '')
      setVar(r.el, '--plate-holes', '')
      if (r.el.dataset.plateHoles) delete r.el.dataset.plateHoles
    }
  const text = sel?.el.querySelector<HTMLElement>('.node-label-text')
  if (sel?.dot && text) {
    const within = area ?? { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
    const usual = !sel.el.style.getPropertyValue('--plate-w') && !sel.el.style.getPropertyValue('--plate-dy')
    if (drawn) {
      // where it is drawn now is known (drawn.full is so only where it is drawn in full): measured only past here
      if (!keeps(drawn.full, usual, others, within)) cut = placeAfresh(sel, text, others, within, under, usual ? drawn : drawnInFull(sel, drawn))
    } else {
      const now = rectOf(text)
      if (!now || !keeps(now, usual, others, within)) cut = placeAfresh(sel, text, others, within, under)
    }
  }
  if (sel) {
    const holes = cut ? plateHoles(cut.plate, cut.s, others, cut.covered) : ''
    // kept so each frame until the next fit aims them where the zoom moves their circles (aimPlateHoles)
    const aim = cut && aimOf(rows, sel, others, cut)
    if (aim) aims.set(sel.el, aim)
    else aims.delete(sel.el)
    setVar(sel.el, '--plate-holes', holes)
    if (holes) sel.el.dataset.plateHoles = 'true'
    else if (sel.el.dataset.plateHoles) delete sel.el.dataset.plateHoles
  }
  for (const r of rows) {
    const id = r.el.dataset.nodeId ?? ''
    if (under.has(id) && r !== sel) r.el.dataset.underPlate = 'true'
    else if (r.el.dataset.underPlate) delete r.el.dataset.underPlate
  }
}

/**
 * The holes last cut in each selected plate, as aimed (HoleAim): a zoom moves a covered circle against the plate on
 * every frame, but the plate is placed only when the titles are fitted (every TITLE_FIT_MS while the view moves).
 */
const aims = new WeakMap<HTMLElement, HoleAim>()

/** Where the renderer puts a label (CSS2DRenderer's transform, its last translate: screen px), read from its style. */
function anchorOf(el: HTMLElement): { x: number; y: number } | null {
  const m = /translate\(([-\d.e+]+)px,\s*([-\d.e+]+)px\)/.exec(el.style.transform)
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null
}

/**
 * The holes of `cut` kept in card px from each label's anchor (HoleAim), from the page as read for the cut: the
 * selected circle, the plate, and each box of a covered step that the plate crosses. Undefined where a label has no
 * anchor (not drawn by the renderer), so nothing aims them.
 */
function aimOf(rows: readonly CircleRow[], sel: CircleRow, others: readonly Other[], cut: Cut): HoleAim | undefined {
  const a = anchorOf(sel.el)
  if (!a || !sel.dot || !(sel.k > 0)) return undefined
  const cy = (sel.dot.top + sel.dot.bottom) / 2
  const parts: HoleAim['parts'] = []
  for (const o of others) {
    if (!cut.covered.includes(o.id)) continue
    const r = rows.find(r => r.el.dataset.nodeId === o.id)
    const at = r && anchorOf(r.el)
    if (!r || !at || !(r.k > 0)) return undefined
    const b = o.box
    parts.push({ id: o.id, x: ((b.left + b.right) / 2 - at.x) / r.k, y: ((b.top + b.bottom) / 2 - at.y) / r.k, hw: (b.right - b.left) / 2 / r.k, hh: (b.bottom - b.top) / 2 / r.k })
  }
  const p = cut.plate
  return { dot: { x: ((sel.dot.left + sel.dot.right) / 2 - a.x) / sel.k, y: (cy - a.y) / sel.k }, top: (p.top - cy) / cut.s, w: (p.right - p.left) / cut.s, h: (p.bottom - p.top) / cut.s, parts }
}

/**
 * The selected plate's holes aimed where this frame draws their circles (aimHoles), from what is written alone (each
 * label's place from the renderer, --label-scale, --near-scale, the brackets' room): nothing is read laid out, so it
 * runs among the graph frame's writes, after the frame's --label-scale. A pan moves nothing against the plate; a zoom,
 * between two title fits, moves each covered circle against it, and its hole with it. Writes only a hole that moved.
 */
export function aimPlateHoles(labels: Map<string, HTMLElement>) {
  for (const el of labels.values()) {
    if (el.dataset.selected !== 'true' || el.dataset.plateHoles !== 'true') continue
    const aim = aims.get(el)
    if (!aim) return
    const scale = parseFloat(el.parentElement?.style.getPropertyValue('--label-scale') ?? '') || 1
    const drawn = (l: HTMLElement) => {
      const a = l.isConnected && l.style.display !== 'none' ? anchorOf(l) : null
      return a && { ...a, z: scale * (parseFloat(l.style.getPropertyValue('--near-scale')) || 1) }
    }
    const me = drawn(el)
    if (!me) return
    const at = new Map<string, Drawn>()
    for (const p of aim.parts) {
      const d = labels.get(p.id)
      const there = d && drawn(d)
      if (there) at.set(p.id, there)
    }
    setVar(el, '--plate-holes', aimHoles(aim, { ...me, room: roomOf(el), style: markStyleOf({ el }) }, at))
    return
  }
}

/**
 * The plate as drawn in full, known without measuring it (placeMarks, on a glide frame, where it is drawn in full): its
 * box, screen px per px of its own, and the brackets' side on screen.
 */
interface KnownPlate {
  full: Box
  s: number
  side: number
}

/**
 * The narrower widths each selected plate was measured at, and its size in full where last drawn so, while what it says
 * and how stays the same (shapeKey): a plate placed afresh on frame after frame of a glide finds most widths it tries
 * among them (wrappedAt), and one drawn narrowed or moved is known in full (drawnInFull). All in the plate's own px from
 * where it is drawn in full, which the words' boost zooms whole, so a glide takes them at any zoom (a frame's place is
 * worked out again on the next). Each width keeps the zoom it was measured at (`s`, screen px a plate px): a still run,
 * whose place stays, takes only those measured within SAME_ZOOM of its own, as a width right on a line break may wrap
 * otherwise at another zoom.
 */
interface Wraps {
  key: string
  seen: (Wrapped & { s: number })[]
  full?: { w: number; h: number }
}
const wraps = new WeakMap<HTMLElement, Wraps>()
const WRAPS_KEPT = 24
const SAME_ZOOM = 0.005
function wrapsOf(el: HTMLElement): Wraps {
  const key = shapeKey(el)
  let w = wraps.get(el)
  if (!w || w.key !== key) wraps.set(el, (w = { key, seen: [] }))
  return w
}

/**
 * A plate drawn narrowed or moved (`drawn`, as read on a glide frame) as it would be drawn in full, from its size in full
 * as last drawn so: it starts where it is drawn (narrowing and moving leave its left edge), and is centred where its
 * middle is drawn less its move (--plate-dy). Undefined where that size is not known, so placeAfresh draws it in full
 * and measures it.
 */
function drawnInFull(sel: CircleRow, drawn: KnownPlate): KnownPlate | undefined {
  const full = wrapsOf(sel.el).full
  if (!full) return undefined
  const { left, top, bottom } = drawn.full
  const middle = (top + bottom) / 2 - (parseFloat(sel.el.style.getPropertyValue('--plate-dy')) || 0) * drawn.s
  const h = full.h * drawn.s
  return { ...drawn, full: { left, top: middle - h / 2, right: left + full.w * drawn.s, bottom: middle + h / 2 } }
}

/**
 * fitPlate's search, from the plate drawn in full (`known`, else drawn so and measured): sets --plate-w and
 * --plate-dy, adds what it still crosses to `under`, and gives where it is drawn crossing those (null where it crosses
 * none), for the holes cut in its backing round them. Only a narrower width tried that no two measured before tell
 * (wrappedAt) is measured after it is written (measureWrap).
 */
function placeAfresh(sel: CircleRow, text: HTMLElement, others: readonly Other[], within: Box, under: Set<string>, known?: KnownPlate): Cut | null {
  const dot = sel.dot!
  setVar(sel.el, '--plate-w', '')
  setVar(sel.el, '--plate-dy', '')
  const full = known ? known.full : rectOf(text)
  // screen px per px of the plate's own (it draws its own zoom on top of the card's), as the stylesheet zooms it: the
  // page's whole px (offsetWidth) would put it up to about 0.7% off
  const s = known ? known.s : sel.k * plateBoost(markStyleOf(sel))
  if (!full || !(s > 0)) return null
  const cx = (dot.left + dot.right) / 2
  const cy = (dot.top + dot.bottom) / 2
  // its size in full, for a glide frame that has to place it afresh once it is drawn narrowed or moved (drawnInFull)
  const kept = wrapsOf(sel.el)
  kept.full = { w: (full.right - full.left) / s, h: (full.bottom - full.top) / s }
  if (crossed(full, others).length === 0) return null
  const font = (known ? TITLE_PX : parseFloat(getComputedStyle(text.querySelector('.node-label-title') ?? text).fontSize) || TITLE_PX) * s
  // a few letters a line, and the plate's padding (6px each side)
  const least = PLATE.minChars * PLATE.charEm * font + 12 * s
  const seen = kept.seen
  // a still run's place stays: only widths measured at its own zoom
  // and the plate in full (no narrower width takes fewer lines: one between it and a width measured on as many is as
  // tall too)
  const usable = [...(known ? seen : seen.filter(x => Math.abs(x.s / s - 1) <= SAME_ZOOM)), { at: kept.full.w, left: 0, top: 0, w: kept.full.w, h: kept.full.h }]
  const tries = plateWidths(full, others, least).map((exact, i) => {
    if (i === 0) return { width: exact, box: full }
    const at = stepDown(exact / s, least / s)
    const width = at * s
    // a width known from the ones measured before is not drawn and measured again
    const wrap = wrappedAt(usable, at)
    if (wrap) return { width, box: { left: full.left + wrap.left * s, top: full.top + wrap.top * s, right: full.left + (wrap.left + wrap.w) * s, bottom: full.top + (wrap.top + wrap.h) * s } }
    return { width, box: measureWrap(sel.el, text, at, full, s, seen) ?? full }
  })
  const marks = known ? { left: cx - known.side / 2, top: cy - known.side / 2, right: cx + known.side / 2, bottom: cy + known.side / 2 } : bracketsOf(sel.el, dot, sel.k)
  const reach = marks ? (marks.bottom - marks.top) / 2 : (dot.bottom - dot.top) / 2
  const at = placePlate(tries, { cy: (dot.top + dot.bottom) / 2, reach }, font * LINE, others, within)
  setVar(sel.el, '--plate-w', at.width < full.right - full.left - 1 ? `${(at.width / s).toFixed(2)}px` : '')
  setVar(sel.el, '--plate-dy', at.dy ? `${(at.dy / s).toFixed(2)}px` : '')
  for (const id of at.covered) under.add(id)
  if (at.covered.length === 0) return null
  // the plate where it is drawn now: the width taken, moved by its dy
  const b = tries.find(t => t.width === at.width)?.box ?? full
  return { plate: { left: b.left, top: b.top + at.dy, right: b.right, bottom: b.bottom + at.dy }, s, covered: at.covered }
}

/** Where placeAfresh left the plate crossing circles (`covered`): the plate on screen, at `s` screen px a plate px. */
interface Cut {
  plate: Box
  s: number
  covered: string[]
}

/**
 * A narrower width to try (`exact`, plate px: it ends the plate PLATE.gap before a circle), rounded down to a whole
 * number of PLATE.step px, so the widths a glide tries frame after frame, each a little off the last, fall on the few
 * already measured (wrappedAt) instead of each being measured. Down is always safe: the plate, and its words inside its
 * padding, only end further before that circle (at most a step, 4 plate px, about 2-5 screen px at the words' boost,
 * less than the 6 px padding the words sit in). Kept exact where a step down would leave under `least` (PLATE.minChars
 * letters a line and the padding), which plateWidths kept it at or over.
 */
function stepDown(exact: number, least: number): number {
  const at = Math.floor(exact / PLATE.step + 1e-6) * PLATE.step
  return at >= least ? at : Number(exact.toFixed(2))
}

/**
 * The plate drawn at `at` px of its own wide (--plate-w) and measured: the one thing placeAfresh lays the page out for.
 * Kept in `seen` (from where it is drawn in full, `full`, at `s` screen px a plate px), with the widths it would still
 * wrap just so at (read from the page as just laid out, which lays out nothing more), as a page breaks lines: each word
 * on the line it starts while it fits there. Narrower (`from`), down to its longest line and its padding, as each line
 * still fits; wider (`to`), up to where a line would take the next line's first word (counting no space between them).
 */
function measureWrap(el: HTMLElement, text: HTMLElement, at: number, full: Box, s: number, seen: Wraps['seen']): Box | null {
  setVar(el, '--plate-w', `${at.toFixed(2)}px`)
  const box = rectOf(text)
  if (!box) return null
  const end = linesEnd(text)
  // plate px to spare past its longest line inside its padding, less half a px for rounding on the page
  const spare = end === null ? 0 : (box.right - end) / s - MARK_CSS.padding - 0.5
  const from = spare > 0 ? Number((at - spare).toFixed(2)) : undefined
  const next = nextFits(text)
  const more = next === null ? 0 : (next - box.right) / s + MARK_CSS.padding - 0.5
  const to = more > 0 ? Number((at + more).toFixed(2)) : undefined
  seen.push({ s, at, from, to, left: (box.left - full.left) / s, top: (box.top - full.top) / s, w: (box.right - box.left) / s, h: (box.bottom - box.top) / s })
  if (seen.length > WRAPS_KEPT) seen.shift()
  return box
}

/**
 * Where the furthest right of the plate's lines of words ends on screen (each piece of text, as laid out), or null where
 * the page gives none.
 */
function linesEnd(text: HTMLElement): number | null {
  if (typeof Range === 'undefined' || typeof Range.prototype.getClientRects !== 'function') return null
  const range = document.createRange()
  const walk = document.createTreeWalker(text, NodeFilter.SHOW_TEXT)
  let end: number | null = null
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    range.selectNodeContents(n)
    for (const r of range.getClientRects()) if (r.width > 0) end = Math.max(end ?? -Infinity, r.right)
  }
  return end
}

/**
 * Where on screen the plate's words (.node-label-words) would end a line that took the next line's first word, at the
 * nearest such line (with no space between them: never further than a page would), or null where the page gives no
 * words, they are on one line, or a word is broken across two (a word too long for a line breaks wherever it reaches).
 * Null too where a line's first word could break inside itself (after a hyphen, slash or dash, or between CJK letters:
 * a piece of it could join the line above sooner), or the due line is wrapped (it could unwrap sooner).
 */
function nextFits(text: HTMLElement): number | null {
  const words = text.querySelector('.node-label-words')
  if (!words || typeof Range === 'undefined' || typeof Range.prototype.getClientRects !== 'function') return null
  const range = document.createRange()
  const due = text.querySelector('.node-label-due')
  if (due?.textContent) {
    range.selectNodeContents(due)
    const tops = new Set([...range.getClientRects()].filter(r => r.width > 0).map(r => Math.round(r.top)))
    if (tops.size > 1) return null
  }
  const walk = document.createTreeWalker(words, NodeFilter.SHOW_TEXT)
  const boxes: { box: DOMRect; word: string }[] = []
  for (let n = walk.nextNode(); n; n = walk.nextNode())
    for (const m of (n.textContent ?? '').matchAll(/\S+/g)) {
      range.setStart(n, m.index)
      range.setEnd(n, m.index + m[0].length)
      const rs = [...range.getClientRects()].filter(r => r.width > 0)
      if (rs.length !== 1) return null
      boxes.push({ box: rs[0], word: m[0] })
    }
  boxes.sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left)
  const lines: (typeof boxes)[] = []
  for (const b of boxes) {
    const line = lines[lines.length - 1]
    if (line && Math.abs(b.box.top - line[0].box.top) < 1) line.push(b)
    else lines.push([b])
  }
  let end: number | null = null
  for (let j = 1; j < lines.length; j++) {
    const first = lines[j][0]
    if (BREAKS_INSIDE.test(first.word)) return null
    const at = Math.max(...lines[j - 1].map(b => b.box.right)) + (first.box.right - first.box.left)
    end = end === null ? at : Math.min(end, at)
  }
  return end
}

/** A word a page may break inside: after a hyphen, slash or dash, or between CJK letters (and the like). */
const BREAKS_INSIDE = /[-\u2010-\u2015/\u2E3A\u2E3B\u3000-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]/

/**
 * How far (card px) past a label's circle the ring drawn around it reaches: overdue, or chain or open deck. The selected
 * step's brackets reach past all of them and are measured instead (bracketsOf).
 */
function ringOf(el: HTMLElement): number {
  if (el.dataset.selected === 'true') return 0
  if (el.dataset.overdue === 'true') return TITLE_CSS.overdueRing
  return el.dataset.chain || el.getAttribute('aria-expanded') === 'true' ? TITLE_CSS.ring : 0
}

/**
 * The selected step's brackets on screen: a square as wide as the stylesheet draws them (--mark, in card px), centred on
 * the circle. Read from the computed size, not the drawn box, so the moment they close in on the circle (a scale from
 * 1.6) is not taken for their size.
 */
function bracketsOf(el: HTMLElement, dot: Box, k: number): Box | null {
  const mark = el.querySelector('.node-mark')
  if (!mark) return null
  const side = parseFloat(getComputedStyle(mark).width) * k
  if (!(side > 0)) return null
  const cx = (dot.left + dot.right) / 2
  const cy = (dot.top + dot.bottom) / 2
  return { left: cx - side / 2, top: cy - side / 2, right: cx + side / 2, bottom: cy + side / 2 }
}

function setVar(el: HTMLElement, name: string, v: string) {
  if (el.style.getPropertyValue(name) === v) return
  if (v) el.style.setProperty(name, v)
  else el.style.removeProperty(name)
}

/** Where the camera is and how large the view is: what the fit's schedule compares from frame to frame. */
export interface ViewAt {
  x: number
  y: number
  z: number
  w: number
  h: number
}

/** A move of the view under this many screen px (a pan, or a zoom at the view's edge) is taken for still. */
export const STILL_PX = 0.5

/**
 * Whether the view moved since `last`: resized, or panned or zoomed by `STILL_PX` screen px or more (a zoom measured
 * where it moves things most, at the view's edge). A camera that only creeps by a hair, as a zoom eases out over
 * seconds, counts as still, so titles are measured again without waiting for it to stop to the last bit; `last` is
 * kept from the last move, so a slow creep still adds up to one.
 */
export function viewMoved(last: ViewAt, now: ViewAt, fovDeg: number, px: number = STILL_PX): boolean {
  if (now.w !== last.w || now.h !== last.h) return true
  if (![last.x, last.y, last.z].every(Number.isFinite) || !(now.z > 0)) return true
  const pan = Math.hypot(now.x - last.x, now.y - last.y) * pxPerUnit(now.z, fovDeg, now.h)
  const zoom = (Math.max(now.w, now.h) / 2) * (Math.abs(now.z - last.z) / now.z)
  return pan >= px || zoom >= px
}
