import { useEffect, useRef, useState } from 'react'
import { glideAt, type Vec3 } from '../../engine/camera.js'

/** Where the camera is and the point it looks at. */
export type Pose = { position: Vec3; lookAt: Vec3 }

export type CameraGlide = {
  /**
   * Glides from `from` to `to` over `ms`, one step a frame (glideAt), cutting short any glide still running. `land`,
   * when given, is called once the camera arrives (the glide's last step), never for a glide cut short.
   */
  glide(from: Pose, to: Pose, ms: number, land?: () => void): void
  /** Cuts short the glide running, if any. */
  stop(): void
  /** Whether a glide is running: started, not yet landed nor cut short. */
  active(): boolean
}

/**
 * Drives camera glides, each step put where `put` sends it. Unmounting cuts short the glide running. A remount picks
 * it up again, on its own schedule: React StrictMode (dev) runs the mount effects twice, and the first pass's cleanup
 * would otherwise cut short a glide started in that pass (a selection's first frame), which the second pass, finding
 * that frame already made, does not start again.
 */
export function useCameraGlide(put: (at: Pose) => void): CameraGlide {
  const putRef = useRef(put)
  useEffect(() => {
    putRef.current = put
  })
  const [glider] = useState(() => {
    let frame: number | null = null
    // The step of the glide running (null when none), and of the one an unmount cut short, until a remount resumes it.
    let running: (() => void) | null = null
    let paused: (() => void) | null = null
    const stop = () => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = null
      running = null
      paused = null
    }
    const glide = (from: Pose, to: Pose, ms: number, land?: () => void) => {
      stop()
      const start = performance.now()
      const step = () => {
        const t = Math.min(1, (performance.now() - start) / ms)
        putRef.current(glideAt(from, to, t))
        frame = t < 1 ? requestAnimationFrame(step) : null
        if (t >= 1) {
          running = null
          land?.()
        }
      }
      running = step
      frame = requestAnimationFrame(step)
    }
    const mount = () => {
      if (paused !== null) {
        running = paused
        paused = null
        frame = requestAnimationFrame(running)
      }
      return () => {
        const cut = running
        stop()
        paused = cut
      }
    }
    return { glide, stop, active: () => running !== null, mount }
  })
  useEffect(() => glider.mount(), [glider])
  return glider
}
