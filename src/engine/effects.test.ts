// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BURST_MS, burstFrame, prefersReducedMotion, takeNewlyDone } from './effects.js'
import type { Status } from './schema.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('takeNewlyDone', () => {
  it('reports nodes that just turned done, ignores first sightings, and remembers statuses', () => {
    const seen = new Map<string, Status>()
    expect(takeNewlyDone(seen, [{ id: 'a', status: 'todo' }, { id: 'b', status: 'done' }])).toEqual([])
    expect(
      takeNewlyDone(seen, [
        { id: 'a', status: 'done' },
        { id: 'b', status: 'done' },
        { id: 'c', status: 'done' },
      ]),
    ).toEqual(['a'])
    expect(takeNewlyDone(seen, [{ id: 'a', status: 'done' }])).toEqual([])
    expect([...seen.entries()]).toEqual([['a', 'done']])
  })
})

describe('burstFrame', () => {
  it('grows and fades over BURST_MS, then reports done', () => {
    expect(BURST_MS).toBe(700)
    expect(burstFrame(0)).toEqual({ scale: 1, opacity: 0.9, done: false })
    const mid = burstFrame(350)
    expect(mid.scale).toBeCloseTo(2.5)
    expect(mid.opacity).toBeCloseTo(0.45)
    expect(mid.done).toBe(false)
    expect(burstFrame(700)).toEqual({ scale: 4, opacity: 0, done: true })
    expect(burstFrame(900)).toEqual({ scale: 4, opacity: 0, done: true })
    expect(burstFrame(-5)).toEqual({ scale: 1, opacity: 0.9, done: false })
  })
})

describe('prefersReducedMotion', () => {
  it('reads the media query and defaults to false without matchMedia', () => {
    expect(prefersReducedMotion()).toBe(false)
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(prefers-reduced-motion: reduce)' }))
    expect(prefersReducedMotion()).toBe(true)
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    expect(prefersReducedMotion()).toBe(false)
  })
})
