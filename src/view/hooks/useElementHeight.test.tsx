// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useElementEdge, useElementHeight } from './useElementHeight.js'

// jsdom has no layout and no ResizeObserver: a fake one that the test fires by hand, and each element's bottom set by hand.
const observers = new Set<FakeResizeObserver>()
class FakeResizeObserver {
  els = new Set<Element>()
  constructor(private cb: () => void) {
    observers.add(this)
  }
  observe(el: Element) {
    this.els.add(el)
  }
  unobserve(el: Element) {
    this.els.delete(el)
  }
  disconnect() {
    this.els.clear()
    observers.delete(this)
  }
  fire(el: Element) {
    if (this.els.has(el)) this.cb()
  }
}
/** The element now reaches `bottom` px down the window. */
const reach = (el: HTMLElement, bottom: number) => {
  el.getBoundingClientRect = () => ({ left: 16, bottom }) as DOMRect
}
/** The element grows to reach `bottom`, and the size observers hear of it. */
const resize = (el: HTMLElement, bottom: number) => {
  reach(el, bottom)
  for (const o of observers) o.fire(el)
}
const card = (bottom: number) => {
  const el = document.createElement('div')
  el.dataset.testid = 'card'
  reach(el, bottom)
  return el
}
const SEL = '[data-testid="card"]'

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
})
afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
  observers.clear()
})

/** Let the MutationObserver callbacks (microtasks) run, then the debounce. */
const flush = async (ms = 200) => {
  await act(async () => {
    await Promise.resolve()
    vi.advanceTimersByTime(ms)
  })
}

describe('useElementEdge, measuring', () => {
  const top = (on = true, delayMs = 150) => useElementEdge(SEL, 'top', on, delayMs)

  it('measures an element there from the start at once, and its growth after the debounce', async () => {
    const el = card(100)
    document.body.append(el)
    const { result } = renderHook(() => top())
    expect(result.current).toBe(100)
    act(() => resize(el, 140))
    await flush(100)
    expect(result.current, 'not before the debounce').toBe(100)
    await flush(100)
    expect(result.current).toBe(140)
  })

  it('is null until the element is there, finds it when it mounts later, then follows its growth', async () => {
    const { result } = renderHook(() => top())
    await flush()
    expect(result.current).toBeNull()
    const el = card(120)
    act(() => {
      document.body.append(el)
    })
    await flush()
    expect(result.current).toBe(120)
    act(() => resize(el, 180))
    await flush()
    expect(result.current).toBe(180)
  })

  it('follows a replacement element (a remount), forgets the value once inactive, and stops watching once unmounted', async () => {
    const a = card(100)
    document.body.append(a)
    const { result, rerender, unmount } = renderHook(({ on }) => top(on), { initialProps: { on: true } })
    await flush()
    const b = card(150)
    act(() => {
      a.remove()
      document.body.append(b)
    })
    await flush()
    expect(result.current).toBe(150)
    rerender({ on: false })
    expect(result.current, 'forgotten once inactive').toBeNull()
    act(() => resize(b, 300))
    await flush()
    expect(result.current).toBeNull()
    rerender({ on: true })
    expect(result.current, 'the new place at once, never the old one').toBe(300)
    unmount()
    expect(observers.size).toBe(0)
  })

  it('coalesces a burst of resizes into one update', async () => {
    const el = card(100)
    document.body.append(el)
    const seen: (number | null)[] = []
    renderHook(() => {
      const h = top()
      seen.push(h)
      return h
    })
    await flush()
    const before = seen.length
    for (const h of [110, 120, 130, 140]) {
      act(() => resize(el, h))
      await flush(50)
    }
    await flush(200)
    expect(seen.at(-1)).toBe(140)
    expect(new Set(seen.slice(before)).size, 'one new value after the burst').toBe(1)
  })

  it('measures again when its parent changes size (something above it wraps)', async () => {
    const column = document.createElement('div')
    const el = card(113)
    column.append(el)
    document.body.append(column)
    const { result } = renderHook(() => top())
    reach(el, 149)
    act(() => {
      for (const o of observers) o.fire(column)
    })
    await flush()
    expect(result.current).toBe(149)
  })
})

describe('useElementEdge', () => {
  const at = (el: HTMLElement, left: number, bottom: number) => {
    el.getBoundingClientRect = () => ({ left, bottom }) as DOMRect
  }

  it('top is how far down the window the element reaches (its bottom), gap from the edge included', async () => {
    const column = document.createElement('div')
    const el = card(40)
    at(el, 16, 56)
    column.append(el)
    document.body.append(column)
    const { result } = renderHook(() => useElementEdge(SEL, 'top', true, 0))
    expect(result.current).toBe(56)
    // it wraps to two rows
    at(el, 16, 96)
    act(() => {
      for (const o of observers) o.fire(el)
    })
    await flush()
    expect(result.current).toBe(96)
  })

  it('right is how far in from the window\'s right edge the element reaches, again when the window resizes', async () => {
    vi.stubGlobal('innerWidth', 1200)
    const el = card(600)
    at(el, 768, 600)
    document.body.append(el)
    const { result, rerender } = renderHook(({ on }) => useElementEdge(SEL, 'right', on, 0), { initialProps: { on: true } })
    expect(result.current).toBe(432)
    vi.stubGlobal('innerWidth', 1000)
    at(el, 568, 600)
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    await flush()
    expect(result.current).toBe(432)
    at(el, 600, 600)
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    await flush()
    expect(result.current).toBe(400)
    rerender({ on: false })
    expect(result.current, 'forgotten once inactive').toBeNull()
  })
  it('bottom is how far up from the window\'s bottom edge the element reaches (the height less its top)', async () => {
    vi.stubGlobal('innerHeight', 844)
    const el = card(828)
    el.getBoundingClientRect = () => ({ top: 500 }) as DOMRect
    document.body.append(el)
    const { result } = renderHook(() => useElementEdge(SEL, 'bottom', true, 0))
    expect(result.current).toBe(344)
    // its content grows: the sheet rises
    el.getBoundingClientRect = () => ({ top: 420 }) as DOMRect
    act(() => {
      for (const o of observers) o.fire(el)
    })
    await flush()
    expect(result.current).toBe(424)
  })
})

describe('useElementHeight', () => {
  const tall = (el: HTMLElement, h: number) => Object.defineProperty(el, 'offsetHeight', { configurable: true, value: h })
  it("reports the element's height at once, and its growth after the debounce", async () => {
    const el = card(0); tall(el, 120); document.body.append(el)
    const { result } = renderHook(() => useElementHeight(SEL, true))
    await flush(0)
    expect(result.current).toBe(120)
    tall(el, 150); for (const o of observers) o.fire(el)
    await flush(100); expect(result.current).toBe(120)
    await flush(100); expect(result.current).toBe(150)
  })
  it('keeps its last height once inactive, and a window resize alone does not measure it', async () => {
    const el = card(0); tall(el, 120); document.body.append(el)
    const { result, rerender } = renderHook(({ on }) => useElementHeight(SEL, on), { initialProps: { on: true } })
    await flush(0)
    tall(el, 180); window.dispatchEvent(new Event('resize'))
    await flush(); expect(result.current).toBe(120)
    rerender({ on: false }); await flush()
    expect(result.current).toBe(120)
  })
})
