// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useToday } from './useToday.js'

describe('useToday', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('is the local date and follows midnight within a minute', () => {
    vi.setSystemTime(new Date(2026, 9, 4, 23, 59, 30))
    const { result } = renderHook(() => useToday())
    expect(result.current).toBe('2026-10-04')
    act(() => {
      vi.setSystemTime(new Date(2026, 9, 5, 0, 0, 10))
      vi.advanceTimersByTime(60_000)
    })
    expect(result.current).toBe('2026-10-05')
  })

  it('stops checking after unmount', () => {
    const { unmount } = renderHook(() => useToday())
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
