// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useGrouping } from './useGrouping.js'

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('useGrouping', () => {
  it('is on when this browser has not chosen', () => {
    const { result } = renderHook(() => useGrouping())
    expect(result.current[0]).toBe(true)
  })

  it('is off when 0 is stored', () => {
    localStorage.setItem('depgraph.group', '0')
    expect(renderHook(() => useGrouping()).result.current[0]).toBe(false)
  })

  it('is on when 1 is stored', () => {
    localStorage.setItem('depgraph.group', '1')
    expect(renderHook(() => useGrouping()).result.current[0]).toBe(true)
  })

  it('stores 0 when switched off and 1 when switched on again, and remembers each', () => {
    const { result, unmount } = renderHook(() => useGrouping())
    act(() => result.current[1]())
    expect(result.current[0]).toBe(false)
    expect(localStorage.getItem('depgraph.group')).toBe('0')
    unmount()
    const again = renderHook(() => useGrouping())
    expect(again.result.current[0]).toBe(false)
    act(() => again.result.current[1]())
    expect(again.result.current[0]).toBe(true)
    expect(localStorage.getItem('depgraph.group')).toBe('1')
  })

  it('is on, and still toggles, when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const { result } = renderHook(() => useGrouping())
    expect(result.current[0]).toBe(true)
    act(() => result.current[1]())
    expect(result.current[0]).toBe(false)
  })
})
