import { describe, expect, it } from 'vitest'
import { panToReveal, revealShift } from './reveal.js'

const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom })
// A 1280x720 window less the toolbar (72), the legend (240) and the bottom strip (170).
const area = box(240, 72, 1280, 550)
const pad = { x: 77, y: 43 }

describe('revealShift', () => {
  it('leaves a label wholly inside the free area alone, even inside the pad', () => {
    expect(revealShift(box(250, 80, 400, 120), area, pad)).toBeNull()
    expect(revealShift(box(240, 72, 1280, 550), area, pad)).toBeNull()
  })

  it('moves a label past the right edge left, to the pad, and not up or down', () => {
    expect(revealShift(box(1300, 200, 1450, 240), area, pad)).toEqual({ dx: 1280 - 77 - 1450, dy: 0 })
  })

  it('moves a label cut by the left strip (the legend) right, to the pad', () => {
    expect(revealShift(box(200, 200, 350, 240), area, pad)).toEqual({ dx: 240 + 77 - 200, dy: 0 })
  })

  it('moves a label under the bottom strip (the card) up, and one under the toolbar down', () => {
    expect(revealShift(box(500, 540, 650, 580), area, pad)).toEqual({ dx: 0, dy: 550 - 43 - 580 })
    expect(revealShift(box(500, -100, 650, -60), area, pad)).toEqual({ dx: 0, dy: 72 + 43 + 100 })
  })

  it('moves along both axes for a label off a corner', () => {
    expect(revealShift(box(1300, 700, 1400, 740), area, pad)).toEqual({ dx: 1280 - 77 - 1400, dy: 550 - 43 - 740 })
  })

  it('centres a label too large for the padded area in the area, along the axis it is out on', () => {
    // 1000 wide: more than the 1040 - 2 x 77 = 886 px left between the pads
    expect(revealShift(box(1100, 200, 2100, 240), area, pad)).toEqual({ dx: (240 + 1280) / 2 - (1100 + 2100) / 2, dy: 0 })
  })

  it('centres a label in an area narrower than its two pads', () => {
    expect(revealShift(box(150, 200, 190, 240), box(0, 72, 100, 550), pad)).toEqual({ dx: 50 - 170, dy: 0 })
  })
})

describe('panToReveal', () => {
  const camera = { position: { x: 10, y: 20, z: 300 }, lookAt: { x: 10, y: 20, z: 0 } }

  it('is null when the label is in the free area', () => {
    expect(panToReveal(box(300, 100, 400, 140), area, pad, camera, 2)).toBeNull()
  })

  it('pans the camera at the same zoom, the other way from the label on screen (y is up in the plane)', () => {
    // the label goes 123 px left on screen: at 2 px a unit the camera goes 61.5 units right
    const left = panToReveal(box(1253, 200, 1353, 240), box(0, 0, 1280, 550), { x: 50, y: 0 }, camera, 2)
    expect(left).toEqual({ position: { x: 10 + 61.5, y: 20, z: 300 }, lookAt: { x: 10 + 61.5, y: 20, z: 0 } })
    // the label goes 50 px up on screen: the camera goes 25 units down
    const up = panToReveal(box(300, 560, 400, 600), box(0, 0, 1280, 550), { x: 0, y: 0 }, camera, 2)
    expect(up).toEqual({ position: { x: 10, y: 20 - 25, z: 300 }, lookAt: { x: 10, y: 20 - 25, z: 0 } })
  })
})
