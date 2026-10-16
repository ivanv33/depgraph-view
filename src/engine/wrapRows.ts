import { NEAR_MAX, SIZE } from './due.js'
import { DOT } from './nodeLabel.js'

/**
 * Many needs of one step side by side wrap into a compact block of short rows under it (see layoutPlan in layered.ts).
 *
 * - `min`: the fewest needs that wrap; fewer stay in one line.
 * - `subGap`: the space between one row of the block and the next, in layout units (a row of the plan keeps
 *   LAYOUT.rowGap). Room for a two-line title and its date line on each side, at the largest date scale.
 * - `laneRoom`: the free band left of each column's circles where the arrows of the steps lower in that column run
 *   up past the rows above them (one line, so a narrow band), between the words of the column on its left and the circles.
 * - `branchLane`: the same band in a column holding a need with needs of its own, wider: there the lane runs beside
 *   that branch's own upright arrows for its whole height (24 left the two lines about 7 px apart at 800 px wide).
 * - `wide`: needs with needs of their own wrap only into as many bands as keep the block at least this many times as
 *   wide as it is tall (a block of steps that need nothing always is): a few deep branches stacked would make the plan
 *   taller than the one line was wide, and the window is wider than tall.
 */
export const WRAP = { min: 5, subGap: 36, laneRoom: 24, branchLane: 48, wide: 2 } as const

/**
 * The rows `count` steps wrap into, longest first: floor(sqrt(count)) rows, the steps shared out as evenly as they go
 * (7 is 4 + 3, 10 is 4 + 3 + 3, 12 is 4 + 4 + 4, 20 is 5 + 5 + 5 + 5), so a block is a little wider than tall in
 * steps. Fewer than WRAP.min steps stay in one row. `rowCount` asks for fewer rows than that (layered.ts does for needs
 * with needs of their own, see WRAP.wide).
 */
export function wrapRows(count: number, rowCount = Math.floor(Math.sqrt(count))): number[] {
  if (count <= 0) return []
  if (count < WRAP.min) return [count]
  const rows = Math.max(1, Math.min(rowCount, count))
  const base = Math.floor(count / rows)
  const extra = count % rows
  return Array.from({ length: rows }, (_, r) => base + (r < extra ? 1 : 0))
}

/**
 * Where a circle's left edge can reach, from its slot's left edge, at the largest date scale (with its 4px of chain
 * outline): the circle grows around a fixed centre (DOT.cx), so this is negative, just left of the slot.
 */
const DOT_LEFT = DOT.cx - SIZE.near * NEAR_MAX - 4

/**
 * One need as the block sees it: a step alone, or a step with its own needs laid out under it (a branch). `w`: from
 * the left edge of its leftmost card to the right edge of its rightmost; `tail`: room its dates need past that; `cx`:
 * the need's own centre from that left edge; `down`: how far it reaches below the need's own centre.
 */
export interface NeedBox {
  w: number
  tail: number
  cx: number
  down: number
}

export interface BlockShape {
  rows: number[]
  /** Centre to centre of two columns (of steps that need nothing; columns of branches are as wide as their widest). */
  pitch: number
  /** Centre to centre of two rows of steps that need nothing (bandY has every band's top). */
  subPitch: number
  /** The block's slot: its width (the cards and the lane left of the first column) and the room kept on its right. */
  width: number
  tail: number
  /** How far the block reaches below its first row's centre. */
  down: number
  /** Each step in reading order: its column and row in the block, and its centre from the block's top-row centre. */
  cells: { col: number; sub: number; dx: number; dy: number }[]
  /** Each column's lane, from the block's centre. */
  laneDx: number[]
  /** Each band (row of the block): its needs' centre below the first band's, and how far its deepest reaches below that. */
  bandY: number[]
  bandDown: number[]
}

/**
 * The block `count` steps wrap into, as a slot of the layout: columns left-aligned (a short last row starts at the left,
 * under the first column), each one pitch from the next, where a pitch is a card, the column gap, the room the widest
 * date on a step needs past its slot (`tail`, slotTail) and the lane band. The block is centred on its slot.
 */
export function blockShape(count: number, tail: number, card: { cardW: number; cardH: number; colGap: number }): BlockShape {
  return boxShape(Array.from({ length: count }, () => ({ w: card.cardW, tail, cx: card.cardW / 2, down: card.cardH / 2 })), wrapRows(count).length, card)
}

/**
 * The block needs of any size wrap into (blockShape for steps that need nothing), in `rowCount` bands: each column as
 * wide as its widest need, with the lane band left of it and the room the widest date needs right of it; each band
 * starts WRAP.subGap under the lowest card of the band above. A need sits at its column's left edge, its own needs
 * under it as they were laid out.
 */
export function boxShape(boxes: NeedBox[], rowCount: number, card: { cardW: number; cardH: number; colGap: number }): BlockShape {
  const rows = wrapRows(boxes.length, rowCount)
  const cols = rows[0] ?? 0
  const tail = Math.max(0, ...boxes.map(b => b.tail))
  const at: { col: number; sub: number }[] = []
  rows.forEach((len, sub) => {
    for (let col = 0; col < len; col++) at.push({ col, sub })
  })
  const colW = Array.from({ length: cols }, (_, col) => Math.max(0, ...boxes.filter((_, i) => at[i].col === col).map(b => b.w)))
  // a column holding a need with needs of its own keeps a wider lane band: its arrows run up beside that branch's own
  const lane = Array.from({ length: cols }, (_, col) => (boxes.some((b, i) => at[i].col === col && b.down > card.cardH / 2) ? WRAP.branchLane : WRAP.laneRoom))
  const colLeft: number[] = [lane[0] ?? WRAP.laneRoom]
  for (let col = 1; col < cols; col++) colLeft.push(colLeft[col - 1] + colW[col - 1] + card.colGap + tail + lane[col])
  const width = cols ? colLeft[cols - 1] + colW[cols - 1] : WRAP.laneRoom
  const bandDown = rows.map((_, sub) => Math.max(card.cardH / 2, ...boxes.filter((_, i) => at[i].sub === sub).map(b => b.down)))
  const bandY = [0]
  for (let sub = 1; sub < rows.length; sub++) bandY.push(bandY[sub - 1] + bandDown[sub - 1] + WRAP.subGap + card.cardH / 2)
  const cells = boxes.map((b, i) => ({ ...at[i], dx: -width / 2 + colLeft[at[i].col] + b.cx, dy: bandY[at[i].sub] }))
  // the lane sits in the middle of the band just left of where the column's circle can reach
  const laneDx = colLeft.map((left, col) => -width / 2 + left + DOT_LEFT - lane[col] / 2)
  return {
    rows,
    pitch: card.cardW + card.colGap + tail + WRAP.laneRoom,
    subPitch: card.cardH + WRAP.subGap,
    width,
    tail,
    down: bandY[rows.length - 1] + bandDown[rows.length - 1],
    cells,
    laneDx,
    bandY,
    bandDown,
  }
}
