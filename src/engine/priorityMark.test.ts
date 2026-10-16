// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { PRIORITY_MARK, PRIORITY_NAME, createPriorityMark, markBars } from './priorityMark.js'

describe('markBars', () => {
  it('high is three rising bars, all lit in the one light colour', () => {
    const bars = markBars('high')!
    expect(bars).toHaveLength(3)
    expect(bars.map(b => b.height)).toEqual([...bars.map(b => b.height)].sort((a, b) => a - b))
    expect(new Set(bars.map(b => b.height)).size).toBe(3)
    expect(bars.every(b => b.fill === PRIORITY_MARK.on)).toBe(true)
    // each bar stands on the same floor
    expect(new Set(bars.map(b => b.y + b.height))).toEqual(new Set([PRIORITY_MARK.h]))
  })

  it('low is the same three positions with only the lowest bar lit', () => {
    const high = markBars('high')!
    const low = markBars('low')!
    expect(low.map(({ x, y, width, height }) => ({ x, y, width, height }))).toEqual(high.map(({ x, y, width, height }) => ({ x, y, width, height })))
    expect(low.map(b => b.fill)).toEqual([PRIORITY_MARK.lowOn, PRIORITY_MARK.off, PRIORITY_MARK.off])
  })

  it('normal draws nothing', () => {
    expect(markBars('normal')).toBeNull()
  })

  it('normal can be asked for as the bare glyph, every bar unlit (for a control that teaches the scale)', () => {
    const normal = markBars('normal', { unlitNormal: true })!
    expect(normal.map(b => [b.x, b.height])).toEqual(markBars('high')!.map(b => [b.x, b.height]))
    expect(normal.map(b => b.fill)).toEqual([PRIORITY_MARK.off, PRIORITY_MARK.off, PRIORITY_MARK.off])
    expect(markBars(undefined, { unlitNormal: true })!.length).toBe(3)
  })

  it('bars and gaps are whole units, so at the minimum size each is a whole pixel', () => {
    for (const b of markBars('high')!) for (const v of [b.x, b.y, b.width, b.height]) expect(Number.isInteger(v)).toBe(true)
    const [a, b, c] = markBars('high')!
    expect(b.x - (a.x + a.width)).toBeGreaterThanOrEqual(1)
    expect(c.x - (b.x + b.width)).toBeGreaterThanOrEqual(1)
    expect(c.x + c.width).toBe(PRIORITY_MARK.w)
  })

  it('the colours are fixed neutrals, never the text colour', () => {
    for (const p of ['high', 'low'] as const) for (const b of markBars(p)!) expect(b.fill).not.toMatch(/currentColor/i)
  })
})

describe('createPriorityMark', () => {
  it('is an svg image named "High priority" / "Low priority", with no text of its own', () => {
    for (const p of ['high', 'low'] as const) {
      const svg = createPriorityMark(document, p)!
      expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg')
      expect(svg.getAttribute('role')).toBe('img')
      expect(svg.getAttribute('aria-label')).toBe(PRIORITY_NAME[p])
      expect(svg.getAttribute('viewBox')).toBe(`0 0 ${PRIORITY_MARK.w} ${PRIORITY_MARK.h}`)
      expect(svg.getAttribute('shape-rendering')).toBe('crispEdges')
      expect(svg.getAttribute('data-priority')).toBe(p)
      expect(svg.textContent).toBe('')
      const rects = [...svg.querySelectorAll('rect')]
      expect(rects.map(r => r.getAttribute('fill'))).toEqual(markBars(p)!.map(b => b.fill))
    }
    expect(PRIORITY_NAME).toEqual({ high: 'High priority', low: 'Low priority' })
  })

  it('is nothing for normal', () => {
    expect(createPriorityMark(document, 'normal')).toBeNull()
  })
})
