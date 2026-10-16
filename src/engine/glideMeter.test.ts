import { describe, expect, it } from 'vitest'
import { GLIDE_PARTS, glideMeter } from './glideMeter.js'

describe('glideMeter', () => {
  it('records nothing while idle and finishes nothing', () => {
    const m = glideMeter()
    m.add('edges', 5, 16)
    m.count('edgeObjects', 3)
    expect(m.recording()).toBe(false)
    expect(m.settle(false, 16)).toBeNull()
  })

  it('times each frame of a glide: intervals, parts per frame, from the last idle frame to the first idle one after', () => {
    const m = glideMeter()
    // an idle frame at 100: the glide's first interval counts from there (it holds the change's commit)
    m.add('titleFit', 1, 100)
    m.settle(false, 100)
    m.layout(() => null)
    m.begin('layout')
    // three frames, the first one long
    m.add('tween', 1, 150)
    m.add('edges', 10, 150)
    m.add('labels', 2, 150)
    m.settle(true, 150)
    m.add('tween', 1, 166)
    m.add('edges', 4, 166)
    m.settle(true, 166)
    m.add('tween', 1, 182)
    m.add('edges', 4, 182)
    m.add('camera', 0.5, 182)
    m.settle(true, 182)
    // the frame that finds nothing moving ends it: its parts are not counted, the wait for it is (the last busy
    // frame's work)
    m.add('titleFit', 3, 198)
    const s = m.settle(false, 198)!
    expect(s).not.toBeNull()
    expect(s.seq).toBe(1)
    expect(s.kinds).toEqual(['layout'])
    expect(s.frames).toBe(3)
    expect(s.durationMs).toBeCloseTo(98)
    expect(s.interval.max).toBeCloseTo(50)
    expect(s.interval.mean).toBeCloseTo((50 + 16 + 16 + 16) / 4)
    expect(s.interval.p95).toBeCloseTo(50)
    expect(s.parts.edges.mean).toBeCloseTo(6)
    expect(s.parts.edges.max).toBeCloseTo(10)
    expect(s.parts.tween.mean).toBeCloseTo(1)
    expect(s.parts.camera.mean).toBeCloseTo(0.5 / 3)
    expect(s.parts.titleFit.max).toBe(0)
    expect(Object.keys(s.parts).sort()).toEqual([...GLIDE_PARTS].sort())
    expect(s.counts.layouts).toBe(1)
    expect(m.recording()).toBe(false)
  })

  it('a slow last frame shows: the wait from it to the first frame at rest is an interval', () => {
    const m = glideMeter()
    m.settle(false, 0)
    m.begin('layout')
    m.add('tween', 1, 16)
    m.settle(true, 16)
    m.add('render', 900, 32)
    m.settle(true, 32)
    const s = m.settle(false, 940)!
    expect(s.frames).toBe(2)
    expect(s.interval.max).toBeCloseTo(908)
    expect(s.durationMs).toBeCloseTo(940)
    expect(s.parts.render.max).toBeCloseTo(900)
  })

  it('work done outside a drawn frame (the first step of a glide, applied as it starts) goes into the next frame drawn: frames are the frames drawn', () => {
    const m = glideMeter()
    m.settle(false, 100)
    m.begin('layout')
    // applied at once, in the effect that starts the glide: the animation frame time is still the last one at rest
    m.carry('tween', 2)
    m.carry('edges', 5)
    // then three animation frames
    let rafSteps = 0
    for (const at of [116, 132, 148]) {
      rafSteps++
      m.add('tween', 1, at)
      m.add('edges', 1, at)
      m.settle(true, at)
    }
    const s = m.settle(false, 164)!
    expect(s.frames).toBe(rafSteps)
    expect(s.interval.max).toBeCloseTo(16)
    expect(s.interval.mean).toBeCloseTo(16)
    expect(s.parts.edges.max).toBeCloseTo(6)
    expect(s.parts.tween.max).toBeCloseTo(3)
    expect(s.parts.edges.mean).toBeCloseTo(8 / 3)
  })

  it('carried work left over when a recording ends goes into none after it', () => {
    const m = glideMeter()
    m.settle(false, 0)
    m.begin('layout')
    m.add('tween', 1, 16)
    m.carry('tween', 50)
    m.settle(false, 32)
    // and nothing is carried while idle either
    m.carry('tween', 50)
    m.begin('camera')
    m.add('tween', 1, 48)
    expect(m.settle(false, 64)!.parts.tween.max).toBeCloseTo(1)
  })

  it('gives each part its median per frame, so one slow frame does not move it', () => {
    const m = glideMeter()
    m.settle(false, 0)
    m.begin('layout')
    const renders = [700, 1, 2, 1, 3, 2, 1]
    renders.forEach((ms, i) => {
      m.add('render', ms, 16 * (i + 1))
      m.settle(true, 16 * (i + 1))
    })
    const s = m.settle(false, 16 * 8)!
    expect(s.parts.render.p50).toBe(2)
    expect(s.parts.render.max).toBe(700)
    expect(s.parts.tween.p50).toBe(0)
    // nearest rank: the lower middle of an even count
    const e = glideMeter()
    e.settle(false, 0)
    e.begin('camera')
    ;[4, 1, 3, 2].forEach((ms, i) => e.add('render', ms, 16 * (i + 1)))
    expect(e.settle(false, 80)!.parts.render.p50).toBe(2)
  })

  it('joins a camera glide started during a layout glide into one recording, and counts each kind once', () => {
    const m = glideMeter()
    m.settle(false, 0)
    m.begin('snap')
    m.begin('camera')
    m.begin('camera')
    m.add('render', 2, 16)
    m.settle(true, 16)
    m.add('render', 2, 32)
    const s = m.settle(false, 48)!
    expect(s.kinds).toEqual(['snap', 'camera'])
    expect(s.frames).toBe(2)
    expect(s.parts.render.mean).toBeCloseTo(2)
  })

  it('counts what happened since the last idle frame, not before it', () => {
    const m = glideMeter()
    m.count('edgeObjects', 40)
    m.settle(false, 10)
    m.count('edgeObjects', 5)
    m.begin('layout')
    m.add('edges', 1, 26)
    m.count('edgeObjects', 2)
    const s = m.settle(false, 42)!
    expect(s.counts.edgeObjects).toBe(7)
    // and the next one starts from zero
    m.settle(false, 58)
    m.begin('camera')
    m.add('camera', 1, 74)
    expect(m.settle(false, 90)!.counts.edgeObjects).toBe(0)
  })

  it('counts and times a layout, handing back what it returns', () => {
    const m = glideMeter()
    m.settle(false, 0)
    expect(m.layout(() => 42)).toBe(42)
    m.begin('layout')
    m.add('tween', 0, 16)
    const s = m.settle(false, 32)!
    expect(s.counts.layouts).toBe(1)
    expect(s.counts.layoutMs).toBeGreaterThanOrEqual(0)
  })

  it('a layout belongs to the transition it starts, even with frames at rest between its render and its commit', () => {
    const m = glideMeter()
    m.layout(() => null)
    // React may render, then draw a frame or two, then commit
    m.settle(false, 16)
    m.settle(false, 32)
    m.begin('snap')
    m.add('render', 1, 48)
    expect(m.settle(false, 64)!.counts.layouts).toBe(1)
  })

  it('a layout that starts no transition is forgotten, and a camera glide alone counts none', () => {
    const m = glideMeter()
    m.layout(() => null)
    m.forgetLayouts()
    m.layout(() => null)
    m.begin('camera')
    m.add('camera', 1, 16)
    expect(m.settle(false, 32)!.counts.layouts).toBe(0)
    m.begin('layout')
    m.add('tween', 1, 48)
    expect(m.settle(false, 64)!.counts.layouts).toBe(1)
  })

  it('numbers its recordings and keeps the last few', () => {
    const m = glideMeter(2)
    for (let i = 0; i < 3; i++) {
      m.settle(false, i * 100)
      m.begin('camera')
      m.add('camera', 1, i * 100 + 16)
      m.settle(false, i * 100 + 32)
    }
    expect(m.history().map(s => s.seq)).toEqual([2, 3])
  })

  it('p95 is the nearest-rank value of the intervals', () => {
    const m = glideMeter()
    m.settle(false, 0)
    m.begin('layout')
    let t = 0
    for (let i = 0; i < 20; i++) {
      t += i === 7 ? 40 : 16
      m.add('tween', 0, t)
      m.settle(true, t)
    }
    const s = m.settle(false, t + 16)!
    expect(s.frames).toBe(20)
    expect(s.interval.max).toBe(40)
    expect(s.interval.p95).toBe(16)
  })
})
