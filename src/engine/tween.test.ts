import { describe, expect, it } from 'vitest'
import { TWEEN_MS, easeOut, originOf, tween, tweenEdge } from './tween.js'

describe('tween', () => {
  it('starts at from, ends at to and clamps outside 0..1', () => {
    expect(tween({ x: 0, y: 10 }, { x: 100, y: 50 }, 0)).toEqual({ x: 0, y: 10 })
    expect(tween({ x: 0, y: 10 }, { x: 100, y: 50 }, 1)).toEqual({ x: 100, y: 50 })
    expect(tween({ x: 0, y: 10 }, { x: 100, y: 50 }, -1)).toEqual({ x: 0, y: 10 })
    expect(tween({ x: 0, y: 10 }, { x: 100, y: 50 }, 3)).toEqual({ x: 100, y: 50 })
  })

  it('eases out: more than half way at half the time, and never backwards', () => {
    expect(TWEEN_MS).toBe(300)
    expect(tween({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.5).x).toBeGreaterThan(50)
    let last = -1
    for (let t = 0; t <= 1; t += 0.1) {
      expect(easeOut(t)).toBeGreaterThanOrEqual(last)
      last = easeOut(t)
    }
  })
})

describe('tweenEdge', () => {
  const to = [{ x: 0, y: 0 }, { x: 10, y: -100 }]
  const ends = { sourceFrom: { x: 0, y: 40 }, sourceTo: { x: 0, y: 0 }, targetFrom: { x: 10, y: -60 }, targetTo: { x: 10, y: -100 } }

  it('moves matching waypoints one by one', () => {
    const from = [{ x: 0, y: 40 }, { x: 10, y: -60 }]
    expect(tweenEdge(to, from, ends, 0)).toEqual(from)
    expect(tweenEdge(to, from, ends, 1)).toEqual(to)
  })

  it('starts a new or reshaped edge where its ends were, and ends on the new points', () => {
    const start = tweenEdge(to, undefined, ends, 0)
    expect(start[0]).toEqual({ x: 0, y: 40 })
    expect(start[start.length - 1]).toEqual({ x: 10, y: -60 })
    expect(tweenEdge(to, undefined, ends, 1)).toEqual(to)
    // a different waypoint count counts as new
    expect(tweenEdge(to, [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 9, y: 9 }], ends, 0)).toEqual(start)
  })
})

describe('originOf', () => {
  const shown = new Map([['A', { x: 1, y: 2 }], ['deck:B', { x: 5, y: 6 }], ['B', { x: 7, y: 8 }]])

  it('is where the node already was', () => {
    expect(originOf('A', shown, new Map(), () => [])).toEqual({ x: 1, y: 2 })
  })

  it("puts a new deck at its parent's old place", () => {
    expect(originOf('deck:C', new Map([['C', { x: 3, y: 4 }]]), new Map(), () => [])).toEqual({ x: 3, y: 4 })
  })

  it("puts a member that just opened at the deck it was in, else at a node that needs it", () => {
    expect(originOf('D', shown, new Map([['D', ['deck:X', 'deck:B']]]), () => [])).toEqual({ x: 5, y: 6 })
    expect(originOf('D', shown, new Map(), id => (id === 'D' ? ['B'] : []))).toEqual({ x: 7, y: 8 })
    expect(originOf('D', shown, new Map(), () => [])).toBeNull()
  })
})
