// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useElementBox, useElementCorner, useElementHeight, useElementWidth } from './useElementHeight.js'

// jsdom has no layout and no ResizeObserver: a fake one that the test fires by hand, and heights set per element.
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
const resize = (el: HTMLElement, h: number) => {
  Object.defineProperty(el, 'offsetHeight', { configurable: true, value: h })
  for (const o of observers) o.fire(el)
}
const card = (h: number) => {
  const el = document.createElement('div')
  el.dataset.testid = 'card'
  Object.defineProperty(el, 'offsetHeight', { configurable: true, value: h })
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

describe('useElementHeight', () => {
  it('reports the height of an element there from the start, and its growth after the debounce', async () => {
    const el = card(100)
    document.body.append(el)
    const { result } = renderHook(() => useElementHeight(SEL, true, 150))
    await flush()
    expect(result.current).toBe(100)
    act(() => resize(el, 140))
    await flush(100)
    expect(result.current, 'not before the debounce').toBe(100)
    await flush(100)
    expect(result.current).toBe(140)
  })

  it('finds an element that mounts after the hook started, then follows its growth', async () => {
    const { result } = renderHook(() => useElementHeight(SEL, true, 150))
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

  it('follows a replacement element (a remount), and stops watching once inactive or unmounted', async () => {
    const a = card(100)
    document.body.append(a)
    const { result, rerender, unmount } = renderHook(({ on }) => useElementHeight(SEL, on, 150), { initialProps: { on: true } })
    await flush()
    const b = card(150)
    act(() => {
      a.remove()
      document.body.append(b)
    })
    await flush()
    expect(result.current).toBe(150)
    rerender({ on: false })
    act(() => resize(b, 300))
    await flush()
    expect(result.current).toBe(150)
    unmount()
    expect(observers.size).toBe(0)
  })

  it('coalesces a burst of resizes into one update', async () => {
    const el = card(100)
    document.body.append(el)
    const seen: (number | null)[] = []
    renderHook(() => {
      const h = useElementHeight(SEL, true, 150)
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

  it('useElementWidth reports offsetWidth', async () => {
    const el = card(100)
    Object.defineProperty(el, 'offsetWidth', { configurable: true, value: 320 })
    document.body.append(el)
    const { result } = renderHook(() => useElementWidth(SEL, true, 150))
    await flush()
    expect(result.current).toBe(320)
    act(() => {
      Object.defineProperty(el, 'offsetWidth', { configurable: true, value: 400 })
      for (const o of observers) o.fire(el)
    })
    await flush(100)
    expect(result.current, 'not before the debounce').toBe(320)
    await flush(100)
    expect(result.current).toBe(400)
  })
})

describe('useElementCorner', () => {
  const place = (el: HTMLElement, right: number, bottom: number) => {
    el.getBoundingClientRect = () => ({ right, bottom }) as DOMRect
  }

  it('reports the bottom right corner and the window width, again when the element, its column or the window changes', async () => {
    const column = document.createElement('div')
    const el = card(30)
    place(el, 136, 113)
    column.append(el)
    document.body.append(column)
    const { result } = renderHook(() => useElementCorner(SEL, true, 150))
    await flush()
    expect(result.current).toEqual({ right: 136, bottom: 113, viewW: innerWidth })
    // the toolbar above it wraps: its column grows and it moves down
    place(el, 136, 149)
    act(() => {
      for (const o of observers) o.fire(column)
    })
    await flush()
    expect(result.current).toEqual({ right: 136, bottom: 149, viewW: innerWidth })
    // the window narrows
    place(el, 136, 185)
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    await flush()
    expect(result.current?.bottom).toBe(185)
  })

  it('forgets the corner once inactive, so the next activation never starts from an old place', async () => {
    const el = card(30)
    place(el, 136, 113)
    document.body.append(el)
    const { result, rerender } = renderHook(({ on }) => useElementCorner(SEL, on, 150), { initialProps: { on: true } })
    await flush()
    expect(result.current).toEqual({ right: 136, bottom: 113, viewW: innerWidth })
    rerender({ on: false })
    expect(result.current).toBeNull()
    place(el, 136, 149)
    rerender({ on: true })
    expect(result.current?.bottom, 'the new corner at once, never the old one').toBe(149)
  })

  it('measures a freshly found element at once, without the debounce, so the sheet never starts from the wrong top', async () => {
    const el = card(30)
    place(el, 136, 113)
    document.body.append(el)
    const { result } = renderHook(() => useElementCorner(SEL, true, 100))
    expect(result.current).toEqual({ right: 136, bottom: 113, viewW: innerWidth })
    // a later move still waits for the debounce
    place(el, 136, 149)
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(result.current?.bottom).toBe(113)
    await flush(100)
    expect(result.current?.bottom).toBe(149)
  })

  it('is null until the element is there', async () => {
    const { result } = renderHook(() => useElementCorner(SEL, true, 150))
    await flush()
    expect(result.current).toBeNull()
  })
})

describe('useElementBox', () => {
  it('measures again at once when `version` changes (a panel opened or closed), though nothing resized', async () => {
    const el = card(30)
    const at = (left: number, top: number, right: number, bottom: number) => {
      el.getBoundingClientRect = () => ({ left, top, right, bottom }) as DOMRect
    }
    at(385, 66, 784, 108)
    document.body.append(el)
    const { result, rerender } = renderHook(({ v }) => useElementBox(SEL, true, 0, v), { initialProps: { v: 'folded' } })
    await flush()
    expect(result.current).toEqual({ left: 385, top: 66, right: 784, bottom: 108 })
    // it slides open with no resize the observers see
    at(384, 64, 784, 490)
    rerender({ v: 'open' })
    expect(result.current).toEqual({ left: 384, top: 64, right: 784, bottom: 490 })
  })
})
