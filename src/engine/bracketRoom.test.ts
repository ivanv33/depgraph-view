import { describe, expect, it } from 'vitest'
import { BRACKET_CLEAR, bracketRoom } from './bracketRoom.js'

const box = (cx: number, cy: number, r: number) => ({ left: cx - r, top: cy - r, right: cx + r, bottom: cy + r })

describe('bracketRoom', () => {
  it('has no limit with no other circle on screen', () => {
    expect(bracketRoom(100, 100, [])).toBe(Infinity)
  })

  it('is the widest square on the centre that keeps clear of the nearest circle beside, above or below it', () => {
    // a circle 30px to the right with radius 5: its near edge is 25px off, so the square reaches 25 - clear each way
    expect(bracketRoom(100, 100, [box(130, 100, 5)])).toBeCloseTo(2 * (25 - BRACKET_CLEAR))
    // one 20px above (radius 4) is nearer
    expect(bracketRoom(100, 100, [box(130, 100, 5), box(100, 80, 4)])).toBeCloseTo(2 * (16 - BRACKET_CLEAR))
  })

  it('measures a corner neighbour by the farther of its two gaps: a square misses it if it clears either way', () => {
    // 20px right and 20px down, radius 5: 15px off on both axes
    expect(bracketRoom(0, 0, [box(20, 20, 5)])).toBeCloseTo(2 * (15 - BRACKET_CLEAR))
    // 40px right and 12px down: 35px off across, 7px down, so a square up to 35px each way misses it
    expect(bracketRoom(0, 0, [box(40, 12, 5)])).toBeCloseTo(2 * (35 - BRACKET_CLEAR))
  })

  it('keeps every square it allows clear of every circle given', () => {
    const others = Array.from({ length: 40 }, (_, i) => box(Math.sin(i * 7.3) * 80, Math.cos(i * 3.1) * 60, 3 + (i % 5))).filter(
      // none within 10px of the centre, so there is some room to check
      b => Math.max(b.left, -b.right, b.top, -b.bottom) > 10,
    )
    expect(others.length).toBeGreaterThan(10)
    const h = bracketRoom(0, 0, others) / 2
    expect(h).toBeGreaterThan(0)
    for (const b of others) {
      const meets = b.left < h + BRACKET_CLEAR && b.right > -h - BRACKET_CLEAR && b.top < h + BRACKET_CLEAR && b.bottom > -h - BRACKET_CLEAR
      expect(meets).toBe(false)
    }
  })

  it('is 0 (the brackets as tight as they go) for a circle closer than any square clears, even one drawn over the centre', () => {
    expect(bracketRoom(0, 0, [box(6, 0, 5)])).toBe(0)
    expect(bracketRoom(0, 0, [box(1, 1, 5), box(40, 0, 5)])).toBe(0)
  })
})
