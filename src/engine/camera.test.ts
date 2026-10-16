import { describe, expect, it } from 'vitest'
import { FLY_DISTANCE, LABEL_SCALE, cameraFor, distanceFor, glideAt, keepScale, labelScale, panFor, pressStops, pxPerUnit } from './camera.js'

describe('cameraFor', () => {
  it('looks straight at the node from FLY_DISTANCE along the plane normal (+z)', () => {
    expect(FLY_DISTANCE).toBe(120)
    expect(cameraFor({ x: 30, y: -40, z: 0 })).toEqual({ position: { x: 30, y: -40, z: 120 }, lookAt: { x: 30, y: -40, z: 0 } })
  })

  it('keeps exactly `distance` between camera and node without tilting', () => {
    const { position, lookAt } = cameraFor({ x: 3, y: 4, z: 0 }, 5)
    expect(position).toEqual({ x: 3, y: 4, z: 5 })
    expect(Math.hypot(position.x - lookAt.x, position.y - lookAt.y, position.z - lookAt.z)).toBeCloseTo(5)
  })

  it('stays on the normal even when the node has a z offset', () => {
    expect(cameraFor({ x: 10, y: 0, z: 30 })).toEqual({ position: { x: 10, y: 0, z: 150 }, lookAt: { x: 10, y: 0, z: 30 } })
  })

  it('treats a node without coordinates as the origin', () => {
    expect(cameraFor({})).toEqual({ position: { x: 0, y: 0, z: 120 }, lookAt: { x: 0, y: 0, z: 0 } })
  })
})

describe('pxPerUnit / distanceFor', () => {
  const tan30 = Math.tan(Math.PI / 6)

  it('is how many screen pixels one unit on the z = 0 plane covers', () => {
    expect(pxPerUnit(1000 / (2 * tan30), 60, 1000)).toBeCloseTo(1, 9)
    expect(pxPerUnit(250 / tan30, 60, 1000)).toBeCloseTo(2, 9)
  })

  it('distanceFor is its inverse', () => {
    expect(pxPerUnit(distanceFor(1.2, 60, 800), 60, 800)).toBeCloseTo(1.2, 9)
  })
})

describe('labelScale', () => {
  it('follows the zoom inside [0.45, 1.6]', () => {
    expect(LABEL_SCALE).toEqual({ min: 0.45, max: 1.6 })
    expect(labelScale(1)).toBe(1)
    expect(labelScale(0.7)).toBe(0.7)
    expect(labelScale(0.1)).toBe(0.45)
    expect(labelScale(9)).toBe(1.6)
  })
})

describe('glideAt', () => {
  // the chip glide of camera.spec: from a far frame with the step off to the side to right over it, much nearer
  const from = cameraFor({ x: -900, y: 400 }, 3400)
  const to = cameraFor({ x: -12, y: -1586 }, 643)
  const step = { x: -12, y: -1586 }

  it('starts where the camera is and ends at the frame it was given', () => {
    expect(glideAt(from, to, 0)).toEqual(from)
    expect(glideAt(from, to, 1)).toEqual(to)
  })

  it('keeps looking straight down the whole way: what it looks at is always right under it', () => {
    for (let t = 0; t <= 1; t += 0.01) {
      const at = glideAt(from, to, t)
      expect(at.lookAt.x).toBeCloseTo(at.position.x, 9)
      expect(at.lookAt.y).toBeCloseTo(at.position.y, 9)
      expect(at.lookAt.z).toBe(0)
    }
  })

  it('brings the step it ends on only nearer to where it ends on screen, and only zooms in, at any frame rate', () => {
    // on screen, a point sits (p - camera) / z from the view's centre (times a constant), for a camera looking straight down
    const screen = (t: number) => {
      const c = glideAt(from, to, t)
      return { x: (step.x - c.position.x) / c.position.z, y: (step.y - c.position.y) / c.position.z, z: c.position.z }
    }
    const end = screen(1)
    let last = screen(0)
    // a frame now and then, as uneven as a busy page draws them
    for (const t of [0.001, 0.02, 0.021, 0.3, 0.31, 0.6, 0.95, 1]) {
      const now = screen(t)
      expect(Math.hypot(now.x - end.x, now.y - end.y)).toBeLessThanOrEqual(Math.hypot(last.x - end.x, last.y - end.y) + 1e-12)
      expect(now.z).toBeLessThanOrEqual(last.z)
      last = now
    }
  })
})

describe('panFor', () => {
  const tan30 = Math.tan(Math.PI / 6)
  // At this distance one unit of the plane covers exactly one pixel of a 1000 px tall view.
  const d = 1000 / (2 * tan30)

  it('moves the camera one plane unit per pixel the pointer travels when a unit covers a pixel, opposite to the drag', () => {
    // Drag right: the plan follows the pointer right, so the camera moves left; drag down (screen y grows): camera up.
    expect(panFor(200, 0, d, 60, 1000).x).toBeCloseTo(-200, 9)
    expect(panFor(200, 0, d, 60, 1000).y).toBeCloseTo(0, 9)
    expect(panFor(0, 100, d, 60, 1000).x).toBeCloseTo(0, 9)
    expect(panFor(0, 100, d, 60, 1000).y).toBeCloseTo(100, 9)
  })

  it('treats a pixel across and a pixel up and down the same, whatever the view is wide', () => {
    const p = panFor(30, 30, d, 60, 1000)
    expect(Math.abs(p.x)).toBeCloseTo(Math.abs(p.y), 9)
  })

  it('moves the camera less per pixel the nearer it is (zoomed in) and more the farther (zoomed out)', () => {
    expect(panFor(100, 0, d / 2, 60, 1000).x).toBeCloseTo(-50, 9)
    expect(panFor(100, 0, d * 3, 60, 1000).x).toBeCloseTo(-300, 9)
  })

  it('keeps the grabbed point under the pointer: the pan undoes exactly the pointer travel in pixels', () => {
    const ppu = pxPerUnit(1529.85, 50, 720)
    const p = panFor(-200, 40, 1529.85, 50, 720)
    expect(p.x * ppu).toBeCloseTo(200, 6)
    expect(p.y * ppu).toBeCloseTo(40, 6)
  })
})

describe('pressStops', () => {
  it('a press on the canvas during a glide cuts the glide', () => {
    expect(pressStops({ onCanvas: true, gliding: true, zoomEasing: false })).toEqual({ glide: true, zoom: false })
  })

  it('a press on the canvas while the wheel zoom still eases ends the easing', () => {
    expect(pressStops({ onCanvas: true, gliding: false, zoomEasing: true })).toEqual({ glide: false, zoom: true })
    expect(pressStops({ onCanvas: true, gliding: true, zoomEasing: true })).toEqual({ glide: true, zoom: true })
  })

  it('a press on a title (not the canvas) stops nothing', () => {
    expect(pressStops({ onCanvas: false, gliding: true, zoomEasing: true })).toEqual({ glide: false, zoom: false })
  })

  it('a press with nothing moving stops nothing', () => {
    expect(pressStops({ onCanvas: true, gliding: false, zoomEasing: false })).toEqual({ glide: false, zoom: false })
  })
})

describe('keepScale', () => {
  it('moves the camera along its line of sight so a taller view keeps the pixels per unit', () => {
    const lookAt = { x: 30, y: -40, z: 0 }
    const position = { x: 30, y: -40, z: 300 }
    const at = keepScale(position, lookAt, 720, 760)
    expect(pxPerUnit(at.z - lookAt.z, 75, 760)).toBeCloseTo(pxPerUnit(300, 75, 720), 10)
    expect(at.x).toBe(30)
    expect(at.y).toBe(-40)
  })

  it('works the same way for a shorter view, and leaves the camera alone when the height is unchanged', () => {
    const lookAt = { x: 0, y: 0, z: 0 }
    expect(keepScale({ x: 0, y: 0, z: 300 }, lookAt, 760, 720).z).toBeCloseTo(300 * (720 / 760), 10)
    expect(keepScale({ x: 5, y: 6, z: 300 }, { x: 5, y: 6, z: 0 }, 720, 720)).toEqual({ x: 5, y: 6, z: 300 })
  })

  it('leaves the camera alone for a view with no height (no size yet)', () => {
    const position = { x: 1, y: 2, z: 300 }
    expect(keepScale(position, { x: 1, y: 2, z: 0 }, 0, 720)).toEqual(position)
    expect(keepScale(position, { x: 1, y: 2, z: 0 }, 720, 0)).toEqual(position)
  })
})
