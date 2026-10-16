import { describe, expect, it } from 'vitest'
import { edgeCurve } from './edgePath.js'

const cardH = 44

describe('edgeCurve', () => {
  it('runs a straight vertical edge from the source bottom to the arrow base, with the tip on the target top', () => {
    const { line, tip } = edgeCurve([{ x: 10, y: 22 }, { x: 10, y: 100 }], { cardH, cardScale: 1, arrow: 9 })
    expect(line[0]).toEqual({ x: 10, y: 22 })
    expect(line.at(-1)).toEqual({ x: 10, y: 91 })
    expect(tip).toEqual({ x: 10, y: 100 })
    for (const p of line) expect(p.x).toBe(10)
  })

  it('bends with vertical tangents at both ends and passes through the middle', () => {
    const { line } = edgeCurve([{ x: 0, y: 0 }, { x: 200, y: 100 }], { cardH, cardScale: 1, arrow: 0, steps: 20 })
    expect(line[0]).toEqual({ x: 0, y: 0 })
    expect(line.at(-1)).toEqual({ x: 200, y: 100 })
    // vertical tangent: the first and last steps move much more in y than in x
    expect(Math.abs(line[1].x - line[0].x)).toBeLessThan(Math.abs(line[1].y - line[0].y))
    expect(Math.abs(line.at(-1)!.x - line.at(-2)!.x)).toBeLessThan(Math.abs(line.at(-1)!.y - line.at(-2)!.y))
    const mid = line[10]
    expect(mid.x).toBeCloseTo(100, 6)
    expect(mid.y).toBeCloseTo(50, 6)
    for (let i = 1; i < line.length; i++) expect(line[i].y).toBeGreaterThan(line[i - 1].y)
  })

  it('passes each virtual point as a straight vertical run the height of a card', () => {
    const v = { x: 300, y: 122 }
    const { line } = edgeCurve([{ x: 0, y: 22 }, v, { x: 0, y: 222 }], { cardH, cardScale: 1, arrow: 9 })
    expect(line).toContainEqual({ x: 300, y: 100 })
    expect(line).toContainEqual({ x: 300, y: 144 })
    for (const p of line) if (Math.abs(p.y - v.y) <= cardH / 2) expect(p.x).toBe(300)
  })

  it('runs upward when the dependent sits above: arrow tip on the dependent bottom, lane runs passed bottom to top', () => {
    const v = { x: 300, y: 122 }
    const { line, tip } = edgeCurve([{ x: 0, y: 222 }, v, { x: 0, y: 22 }], { cardH, cardScale: 1, arrow: 9 })
    expect(line[0]).toEqual({ x: 0, y: 222 })
    expect(line.at(-1)).toEqual({ x: 0, y: 31 })
    expect(tip).toEqual({ x: 0, y: 22 })
    expect(line.findIndex(p => p.x === 300 && p.y === 144)).toBeLessThan(line.findIndex(p => p.x === 300 && p.y === 100))
    for (let i = 1; i < line.length; i++) expect(line[i].y).toBeLessThanOrEqual(line[i - 1].y)
    const small = edgeCurve([{ x: 0, y: 100 }, { x: 0, y: 22 }], { cardH, cardScale: 0.5, arrow: 9 })
    expect(small.line[0]).toEqual({ x: 0, y: 111 })
    expect(small.tip).toEqual({ x: 0, y: 11 })
  })

  it('meets the cards where they really are when they render smaller or larger than their slot', () => {
    const small = edgeCurve([{ x: 0, y: 22 }, { x: 0, y: 100 }], { cardH, cardScale: 0.5, arrow: 9 })
    expect(small.line[0]).toEqual({ x: 0, y: 11 })
    expect(small.tip).toEqual({ x: 0, y: 111 })
    const large = edgeCurve([{ x: 0, y: 22 }, { x: 0, y: 100 }], { cardH, cardScale: 1.5, arrow: 9 })
    expect(large.line[0]).toEqual({ x: 0, y: 33 })
    expect(large.tip).toEqual({ x: 0, y: 89 })
  })

  it('can start and end at a dot: x offset left of the slot centre and a shorter reach, both scaled', () => {
    const dot = { dx: 67, reach: 18 }
    const up = edgeCurve([{ x: 100, y: 100 }, { x: 100, y: 22 }], { cardH, cardScale: 1, arrow: 0, ...dot })
    expect(up.line[0]).toEqual({ x: 33, y: 104 })
    expect(up.tip).toEqual({ x: 33, y: 18 })
    const down = edgeCurve([{ x: 100, y: 22 }, { x: 100, y: 100 }], { cardH, cardScale: 0.5, arrow: 0, ...dot })
    expect(down.line[0]).toEqual({ x: 100 - 33.5, y: 9 })
    expect(down.tip).toEqual({ x: 100 - 33.5, y: 113 })
  })

  it('leaves lane points where they are when ends move to the dot', () => {
    const v = { x: 300, y: 122 }
    const { line } = edgeCurve([{ x: 0, y: 222 }, v, { x: 0, y: 22 }], { cardH, cardScale: 1, arrow: 0, dx: 67, reach: 18 })
    expect(line[0]).toEqual({ x: -67, y: 226 })
    expect(line.some(p => p.x === 300 && p.y === 144)).toBe(true)
    expect(line.some(p => p.x === 300 && p.y === 100)).toBe(true)
  })
  it('meets a scaled node (due soon or far off) at its scaled reach, the dot staying where it is across', () => {
    const dot = { dx: 67, reach: 18 }
    const plain = edgeCurve([{ x: 100, y: 100 }, { x: 100, y: 22 }], { cardH, cardScale: 1, arrow: 0, ...dot })
    const scaled = edgeCurve([{ x: 100, y: 100 }, { x: 100, y: 22 }], { cardH, cardScale: 1, arrow: 0, ...dot, scales: { start: 0.85, end: 1.3 } })
    // the points are the slot edges (centres at 122 and 0); the source at 0.85 is left 18 * 0.85 above its centre,
    // the target at 1.3 is met 18 * 1.3 below its centre; across, both stay at the unscaled dot
    expect(scaled.line[0].x).toBe(33)
    expect(scaled.line[0].y).toBeCloseTo(122 - 18 * 0.85, 9)
    expect(scaled.tip.x).toBe(33)
    expect(scaled.tip.y).toBeCloseTo(18 * 1.3, 9)
    expect(plain.tip).toEqual({ x: 33, y: 18 })
  })
})
