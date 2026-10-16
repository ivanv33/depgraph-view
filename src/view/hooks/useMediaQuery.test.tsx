// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useMediaQuery } from './useMediaQuery.js'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('useMediaQuery', () => {
  it('follows the query as it starts and stops matching', () => {
    let matches = true
    const listeners = new Set<() => void>()
    vi.stubGlobal('matchMedia', (media: string) => ({
      media,
      get matches() {
        return matches
      },
      addEventListener: (_: string, f: () => void) => listeners.add(f),
      removeEventListener: (_: string, f: () => void) => listeners.delete(f),
    }))
    const { result, unmount } = renderHook(() => useMediaQuery('(min-width: 860px)'))
    expect(result.current).toBe(true)
    matches = false
    act(() => listeners.forEach(f => f()))
    expect(result.current).toBe(false)
    unmount()
    expect(listeners.size).toBe(0)
  })

  it('is false without matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined)
    const { result } = renderHook(() => useMediaQuery('(min-width: 860px)'))
    expect(result.current).toBe(false)
  })
})
