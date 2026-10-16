import type { Priority } from './schema.js'

/**
 * The priority mark: three rising bars. High lights all three, low only the lowest (the other two stay as faint
 * outlines of the glyph, so the shape is the same and only the count of lit bars differs), normal draws nothing.
 * The one copy of its look: the graph labels (createPriorityMark) and every React place (PriorityMark.tsx) draw from it.
 *
 * Units are the viewBox's: bars 2 wide with 1 between, 3, 5 and 7 tall, all on one floor. At the smallest size the
 * graph draws it (MARK_MIN_PX, 8 x 7 px) each unit is one pixel; above it `shape-rendering: crispEdges` keeps the edges
 * sharp. The colours are fixed light neutrals, never the text or state colour, so the mark never competes with the
 * circle's colour and reads the same in greyscale.
 */
export const PRIORITY_MARK = {
  w: 8,
  h: 7,
  bars: [
    { x: 0, width: 2, height: 3 },
    { x: 3, width: 2, height: 5 },
    { x: 6, width: 2, height: 7 },
  ],
  /** A lit bar of the high mark. */
  on: '#eef1f6',
  /** The one lit bar of the low mark: grey, quieter than high. */
  lowOn: '#9aa3b5',
  /** An unlit bar of the low mark. */
  off: 'rgba(139, 149, 167, 0.3)',
} as const

/** The smallest the graph draws the mark, in screen px, however far out the view is zoomed (viewer.css, .node-prio). */
export const MARK_MIN_PX = { w: PRIORITY_MARK.w, h: PRIORITY_MARK.h } as const

/** The mark's accessible name. Normal has no mark and no name. */
export const PRIORITY_NAME: Readonly<Record<'high' | 'low', string>> = { high: 'High priority', low: 'Low priority' }

export interface MarkBar {
  x: number
  y: number
  width: number
  height: number
  fill: string
}

/**
 * The bars to draw for a priority, left to right, or null for normal (nothing is drawn). `unlitNormal` draws normal as
 * the bare glyph, every bar unlit: only for a control that shows the three side by side, so the scale reads whole.
 */
export function markBars(priority: Priority | undefined, { unlitNormal = false }: { unlitNormal?: boolean } = {}): MarkBar[] | null {
  if (priority !== 'high' && priority !== 'low' && !unlitNormal) return null
  return PRIORITY_MARK.bars.map((b, i) => ({
    ...b,
    y: PRIORITY_MARK.h - b.height,
    fill: priority === 'high' ? PRIORITY_MARK.on : priority === 'low' && i === 0 ? PRIORITY_MARK.lowOn : PRIORITY_MARK.off,
  }))
}

const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * The mark as an svg element for DOM-built places (graph labels, deck rows): an image named "High priority" or
 * "Low priority" with no text of its own (so a title's textContent stays the title). Null for normal. Its size comes
 * from the stylesheet (the element carries the `priority-mark` class).
 */
export function createPriorityMark(doc: Document, priority: Priority | undefined): SVGSVGElement | null {
  const bars = markBars(priority)
  if (!bars) return null
  const svg = doc.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('class', 'priority-mark')
  svg.setAttribute('viewBox', `0 0 ${PRIORITY_MARK.w} ${PRIORITY_MARK.h}`)
  svg.setAttribute('shape-rendering', 'crispEdges')
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', PRIORITY_NAME[priority as 'high' | 'low'])
  svg.setAttribute('data-priority', priority!)
  for (const b of bars) {
    const r = doc.createElementNS(SVG_NS, 'rect')
    for (const k of ['x', 'y', 'width', 'height', 'fill'] as const) r.setAttribute(k, String(b[k]))
    svg.append(r)
  }
  return svg
}
