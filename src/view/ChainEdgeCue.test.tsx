// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { createRef, type RefObject } from 'react'
import ChainEdgeCues, { drawnParts, type CueScene } from './ChainEdgeCue.js'
import { OVERDUE_RING, cueSize } from '../engine/edgeCue.js'

// jsdom has no layout and no ResizeObserver: a quiet one, and boxes set per element.
class QuietResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
type B = { left: number; top: number; right: number; bottom: number }
const place = (el: HTMLElement, b: B) => {
  el.getBoundingClientRect = () => ({ ...b, x: b.left, y: b.top, width: b.right - b.left, height: b.bottom - b.top, toJSON: () => b }) as DOMRect
}
const plain = (r: DOMRect | B): B => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })

/**
 * A step's label as the graph draws it: its circle (`dot`) and its title. Cards scale by CSS zoom, and Chromium may
 * count that zoom in the circle's offsetWidth, so its CSS size says nothing of its scale: it is set to the drawn width.
 */
function label(id: string, dot: B, title: B, { overdue = false } = {}) {
  const el = document.createElement('div')
  el.className = 'node-label'
  el.dataset.nodeId = id
  if (overdue) el.dataset.overdue = 'true'
  const card = document.createElement('div')
  card.className = 'node-card'
  const d = document.createElement('span')
  d.className = 'node-dot'
  Object.defineProperty(d, 'offsetWidth', { configurable: true, value: dot.right - dot.left })
  place(d, dot)
  const t = document.createElement('span')
  t.className = 'node-label-title'
  place(t, title)
  card.append(d, t)
  el.append(card)
  return { el, dot: d, title: t }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('ResizeObserver', QuietResizeObserver)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('drawnParts', () => {
  it("counts an overdue step's red ring (OVERDUE_RING css px outside its circle, at the card's scale k) as part of its circle", () => {
    const dot = { left: 100, top: 189, right: 122, bottom: 211 }
    const title = { left: 126, top: 192, right: 200, bottom: 208 }
    expect(drawnParts(label('a', dot, title).el, 2).map(plain)).toEqual([dot, title])
    // the card drawn at twice its size (k 2): the ring is twice as far out on screen
    const pad = OVERDUE_RING * 2
    const parts = drawnParts(label('a', dot, title, { overdue: true }).el, 2).map(plain)
    expect(parts).toEqual([{ left: 100 - pad, top: 189 - pad, right: 122 + pad, bottom: 211 + pad }, title])
  })
})

describe('ChainEdgeCues', () => {
  const area = { left: 0, top: 72, right: 800, bottom: 500 }
  // one marked step above the top edge, its line at x 300; a step 'a' near the top edge, left of that line
  const scene: CueScene = { key: 'still', points: [{ x: 300, y: -50, kind: 'down' }], cards: [{ id: 'a', x: 150, y: 90, k: 1 }] }
  const half = cueSize(1).w / 2
  const pillCentre = (c: HTMLElement) => parseFloat(c.querySelector<HTMLElement>('[data-testid="edge-cue"]')!.style.left) + half

  it('measures the cards again when their words change with no view move (an edit, a new title fit), so a pill keeps clear of a title grown onto its line', () => {
    const a = label('a', { left: 140, top: 80, right: 160, bottom: 100 }, { left: 165, top: 82, right: 200, bottom: 98 })
    const labels = new Map([['a', a.el]])
    const sceneRef = { current: () => scene } as RefObject<() => CueScene | null>
    const tickRef = createRef<(() => void) | null>() as RefObject<(() => void) | null>
    const words = { current: 0 }
    const { container } = render(<ChainEdgeCues active area={area} scene={sceneRef} tickRef={tickRef} labels={labels} boxes={{}} words={words} />)
    const tick = () => act(() => tickRef.current?.())
    tick()
    act(() => vi.advanceTimersByTime(200))
    tick()
    // measured: the short title ends well left of the line, so the pill sits on it
    expect(pillCentre(container)).toBe(300)
    // the title grows onto the line (an edit); the view does not move: until the words count changes, nothing is measured
    place(a.title, { left: 165, top: 82, right: 290, bottom: 98 })
    tick()
    act(() => vi.advanceTimersByTime(200))
    tick()
    expect(pillCentre(container), 'nothing moved and no fit ran: the old measure stands').toBe(300)
    words.current++
    tick()
    act(() => vi.advanceTimersByTime(200))
    tick()
    expect(pillCentre(container), 'measured again: the pill is clear of the longer title').toBe(Math.round(290 + 4 + half))
  })
})
