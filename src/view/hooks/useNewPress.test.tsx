// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'
import { useNewPress } from './useNewPress.js'

afterEach(cleanup)

describe('useNewPress', () => {
  it('does not fire on mount, even when the counter was pressed before (a plan switch remounts the graph)', () => {
    const onPress = vi.fn()
    renderHook(() => useNewPress(3, onPress))
    expect(onPress).not.toHaveBeenCalled()
  })

  it('fires once for each new press after mount', () => {
    const onPress = vi.fn()
    const { rerender } = renderHook(({ n }) => useNewPress(n, onPress), { initialProps: { n: 1 } })
    rerender({ n: 1 })
    expect(onPress).not.toHaveBeenCalled()
    rerender({ n: 2 })
    expect(onPress).toHaveBeenCalledTimes(1)
    rerender({ n: 2 })
    rerender({ n: 3 })
    expect(onPress).toHaveBeenCalledTimes(2)
  })
})
