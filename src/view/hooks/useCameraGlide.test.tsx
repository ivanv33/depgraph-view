// @vitest-environment jsdom
import { StrictMode, useEffect, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, renderHook } from '@testing-library/react'
import { useCameraGlide, type Pose } from './useCameraGlide.js'

const from: Pose = { position: { x: 0, y: 0, z: 100 }, lookAt: { x: 0, y: 0, z: 0 } }
const to: Pose = { position: { x: 50, y: -20, z: 40 }, lookAt: { x: 50, y: -20, z: 0 } }
const other: Pose = { position: { x: -30, y: 10, z: 60 }, lookAt: { x: -30, y: 10, z: 0 } }

// Animation frames run by hand, at a clock the test moves.
let now = 0
let frames = new Map<number, FrameRequestCallback>()
let nextId = 1
const runFrames = (ms: number, step = 16) => {
  for (let t = 0; t < ms; t += step) {
    now += step
    const due = [...frames.values()]
    frames = new Map()
    for (const f of due) f(now)
  }
}

beforeEach(() => {
  now = 0
  frames = new Map()
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => {
    const id = nextId++
    frames.set(id, f)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => void frames.delete(id))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useCameraGlide', () => {
  it('glides to the end over its time, then lands once', () => {
    const put = vi.fn()
    const land = vi.fn()
    const { result } = renderHook(() => useCameraGlide(put))
    result.current.glide(from, to, 600, land)
    runFrames(300)
    expect(land).not.toHaveBeenCalled()
    runFrames(400)
    expect(put).toHaveBeenLastCalledWith(to)
    expect(land).toHaveBeenCalledTimes(1)
  })

  it('a new glide cuts the running one short: it never lands, and the camera ends at the new one', () => {
    const put = vi.fn()
    const first = vi.fn()
    const second = vi.fn()
    const { result } = renderHook(() => useCameraGlide(put))
    result.current.glide(from, to, 600, first)
    runFrames(200)
    result.current.glide(from, other, 600, second)
    runFrames(800)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    expect(put).toHaveBeenLastCalledWith(other)
  })

  it('says whether a glide is running: from its start until it lands or is stopped', () => {
    const { result } = renderHook(() => useCameraGlide(vi.fn()))
    expect(result.current.active()).toBe(false)
    result.current.glide(from, to, 600)
    expect(result.current.active()).toBe(true)
    runFrames(300)
    expect(result.current.active()).toBe(true)
    runFrames(400)
    expect(result.current.active()).toBe(false)
    result.current.glide(to, other, 600)
    runFrames(100)
    result.current.stop()
    expect(result.current.active()).toBe(false)
  })

  it('stop cuts the running glide short', () => {
    const put = vi.fn()
    const land = vi.fn()
    const { result } = renderHook(() => useCameraGlide(put))
    result.current.glide(from, to, 600, land)
    runFrames(100)
    result.current.stop()
    const calls = put.mock.calls.length
    runFrames(800)
    expect(put.mock.calls.length).toBe(calls)
    expect(land).not.toHaveBeenCalled()
  })

  it('unmounting cuts the running glide short', () => {
    const put = vi.fn()
    const land = vi.fn()
    const { result, unmount } = renderHook(() => useCameraGlide(put))
    result.current.glide(from, to, 600, land)
    runFrames(100)
    unmount()
    const calls = put.mock.calls.length
    runFrames(800)
    expect(put.mock.calls.length).toBe(calls)
    expect(land).not.toHaveBeenCalled()
  })

  // React StrictMode (dev, how the app runs) mounts effects twice: the first pass's cleanup runs before the second pass.
  // A frame started from a mount effect records itself as made (as the selection's frame does, `framed` in Graph.tsx),
  // so the second pass starts nothing: the glide the cleanup cut short must still arrive. (A real unmount still cuts it
  // short, above.)
  it('a glide started from a mount effect still arrives under StrictMode', () => {
    const put = vi.fn()
    const land = vi.fn()
    function Framer() {
      const glider = useCameraGlide(put)
      const framed = useRef(false)
      useEffect(() => {
        if (framed.current) return
        framed.current = true
        glider.glide(from, to, 600, land)
      })
      return null
    }
    render(
      <StrictMode>
        <Framer />
      </StrictMode>,
    )
    // on its own schedule: it lands when it would have, not a full glide after the second pass
    runFrames(624)
    expect(put).toHaveBeenLastCalledWith(to)
    expect(land).toHaveBeenCalledTimes(1)
  })
})
