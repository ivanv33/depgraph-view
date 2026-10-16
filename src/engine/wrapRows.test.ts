import { describe, expect, it } from 'vitest'
import { NEAR_MAX, SIZE } from './due.js'
import { DOT, TEXT_RIGHT, slotTail } from './nodeLabel.js'
import { WRAP, blockShape, boxShape, wrapRows } from './wrapRows.js'

const CARD = { cardW: 170, cardH: 44, colGap: 36 }

describe('wrapRows', () => {
  it('keeps fewer than WRAP.min steps in one row', () => {
    for (let n = 0; n < WRAP.min; n++) expect(wrapRows(n)).toEqual(n ? [n] : [])
  })

  it('wraps into balanced rows, longer rows first, a little wider than tall', () => {
    expect(wrapRows(5)).toEqual([3, 2])
    expect(wrapRows(7)).toEqual([4, 3])
    expect(wrapRows(10)).toEqual([4, 3, 3])
    expect(wrapRows(12)).toEqual([4, 4, 4])
    expect(wrapRows(20)).toEqual([5, 5, 5, 5])
  })

  it('for any count from WRAP.min up: at least two rows, every step once, rows differ by one at most, never more rows than columns', () => {
    for (let n = WRAP.min; n <= 300; n++) {
      const rows = wrapRows(n)
      expect(rows.length, `${n}`).toBeGreaterThanOrEqual(2)
      expect(rows.reduce((a, b) => a + b, 0), `${n}`).toBe(n)
      expect(Math.max(...rows) - Math.min(...rows), `${n}`).toBeLessThanOrEqual(1)
      expect([...rows].sort((a, b) => b - a), `${n}`).toEqual(rows)
      expect(rows.length, `${n}`).toBeLessThanOrEqual(rows[0])
    }
  })
})

describe('blockShape', () => {
  it('puts the steps in reading order into left-aligned columns, one sub-row under another', () => {
    const b = blockShape(7, 0, CARD)
    expect(b.rows).toEqual([4, 3])
    expect(b.cells.map(c => c.sub)).toEqual([0, 0, 0, 0, 1, 1, 1])
    expect(b.cells.map(c => c.col)).toEqual([0, 1, 2, 3, 0, 1, 2])
    // same column, same x; columns one pitch apart
    for (const c of b.cells) expect(c.dx).toBeCloseTo(b.cells[c.col].dx, 9)
    for (let j = 1; j < 4; j++) expect(b.cells[j].dx - b.cells[j - 1].dx).toBeCloseTo(b.pitch, 9)
    expect(b.cells.map(c => c.dy)).toEqual([0, 0, 0, 0, b.subPitch, b.subPitch, b.subPitch])
    expect(b.subPitch).toBe(CARD.cardH + WRAP.subGap)
    expect(b.down).toBe(b.subPitch + CARD.cardH / 2)
  })

  it('is as wide as its columns and the lane left of the first, centred on its slot', () => {
    for (const tail of [0, 30]) {
      const b = blockShape(12, tail, CARD)
      expect(b.pitch).toBe(CARD.cardW + CARD.colGap + tail + WRAP.laneRoom)
      expect(b.width).toBeCloseTo(WRAP.laneRoom + CARD.cardW + 3 * b.pitch, 9)
      const left = Math.min(...b.cells.map(c => c.dx)) - CARD.cardW / 2 - WRAP.laneRoom
      const right = Math.max(...b.cells.map(c => c.dx)) + CARD.cardW / 2
      expect(left).toBeCloseTo(-b.width / 2, 9)
      expect(right).toBeCloseTo(b.width / 2, 9)
      expect(b.tail).toBe(tail)
    }
  })

  it('runs each lane between the words of the column on its left and the circle of its own, at the largest scale it allows', () => {
    // a lane is a line: it must clear the text of the column before and the circle (with its outline) of its own
    for (const scale of [1, 1.2, NEAR_MAX]) {
      const tail = slotTail(scale, CARD.cardW, CARD.colGap)
      const b = blockShape(20, tail, CARD)
      for (let j = 0; j < b.rows[0]; j++) {
        const lane = b.laneDx[j]
        const ownLeft = b.cells[j].dx - CARD.cardW / 2
        const circleLeft = ownLeft + DOT.cx - (scale > 1 ? SIZE.near * scale : SIZE.normal) - 4
        expect(circleLeft - lane, `scale ${scale} col ${j}`).toBeGreaterThanOrEqual(WRAP.laneRoom / 2 - 1e-9)
        // left of the first column: a step beside the block in the plan's row, as drawn at the same scale
        const prevLeft = j > 0 ? b.cells[j - 1].dx - CARD.cardW / 2 : -b.width / 2 - CARD.colGap - tail - CARD.cardW
        const textEnd = prevLeft + DOT.cx + (TEXT_RIGHT - DOT.cx) * scale
        expect(lane - textEnd, `scale ${scale} col ${j}`).toBeGreaterThanOrEqual(WRAP.laneRoom / 2 - 1e-9)
      }
    }
  })

  it('is much narrower than the same steps in one line', () => {
    for (const n of [5, 7, 12, 20]) {
      const line = n * CARD.cardW + (n - 1) * CARD.colGap
      expect(blockShape(n, 0, CARD).width / line, `${n}`).toBeLessThanOrEqual(0.7)
    }
  })
})

describe('boxShape: needs with needs of their own', () => {
  const leaf = (tail = 0) => ({ w: CARD.cardW, tail, cx: CARD.cardW / 2, down: CARD.cardH / 2 })

  it('gives the same block as blockShape for steps that need nothing', () => {
    for (const [n, tail] of [[5, 0], [7, 0], [12, 30], [20, 12.5]])
      expect(boxShape(Array.from({ length: n }, () => leaf(tail)), wrapRows(n).length, CARD)).toEqual(blockShape(n, tail, CARD))
  })

  it('sizes each column by its widest need and each band by its deepest, a block gap apart', () => {
    // six needs in two bands of three; the second need is a branch 400 wide, its step 100 from the left, reaching 200 down
    const boxes = [leaf(), { w: 400, tail: 0, cx: 100, down: 200 }, leaf(), leaf(), leaf(), { w: 300, tail: 0, cx: 150, down: 150 }]
    const b = boxShape(boxes, 2, CARD)
    expect(b.rows).toEqual([3, 3])
    // band 2 starts under band 1's deepest box
    expect(b.cells.slice(3).map(c => c.dy)).toEqual([1, 1, 1].map(() => 200 + WRAP.subGap + CARD.cardH / 2))
    expect(b.down).toBe(200 + WRAP.subGap + CARD.cardH / 2 + 150)
    // column 1 is 400 wide: column 2 starts past it, its lane and the gaps; columns holding a branch keep a wider lane
    const left = (i: number) => b.cells[i].dx - boxes[i].cx
    expect(left(4)).toBeCloseTo(left(1), 9)
    expect(left(2) - left(1)).toBeCloseTo(400 + CARD.colGap + WRAP.branchLane, 9)
    expect(b.width).toBeCloseTo(WRAP.laneRoom + CARD.cardW + 400 + 300 + 2 * (CARD.colGap + WRAP.branchLane), 9)
    expect(left(1) - b.laneDx[1] - (left(0) - b.laneDx[0])).toBeCloseTo((WRAP.branchLane - WRAP.laneRoom) / 2, 9)
    // each lane left of its column, right of the column before it
    for (let j = 1; j < 3; j++) {
      expect(b.laneDx[j]).toBeLessThan(left(j))
      expect(b.laneDx[j]).toBeGreaterThan(left(j - 1) + Math.max(boxes[j - 1].w, boxes[j + 2].w))
    }
    expect(b.bandY).toEqual([0, 200 + WRAP.subGap + CARD.cardH / 2])
    expect(b.bandDown).toEqual([200, 150])
  })
})
