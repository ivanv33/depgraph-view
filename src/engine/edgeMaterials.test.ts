import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { edgeMaterials } from './edgeMaterials.js'

const plain = { color: '#c9d3e6', width: 1.8, dashed: false }
const view = { w: 1280, h: 720 }

describe('edgeMaterials', () => {
  it('hands every line of one look the same material, a line of another look its own', () => {
    const m = edgeMaterials()
    const a = m.line(plain, 1, view)
    expect(m.line(plain, 1, view)).toBe(a)
    expect(m.line({ ...plain, color: '#ffb454' }, 1, view)).not.toBe(a)
    expect(m.line({ ...plain, width: 2.6 }, 1, view)).not.toBe(a)
    expect(m.line({ ...plain, dashed: true }, 1, view)).not.toBe(a)
    expect(m.line(plain, 0.5, view)).not.toBe(a)
    expect(m.head('#c9d3e6', 1)).toBe(m.head('#c9d3e6', 1))
    expect(m.head('#c9d3e6', 1)).not.toBe(m.head('#c9d3e6', 0.5))
  })

  it('opacities a hundredth or less apart share one material (the haze is continuous, the materials kept stay few)', () => {
    const m = edgeMaterials()
    const a = m.line(plain, 0.501, view)
    expect(m.line(plain, 0.504, view)).toBe(a)
    expect(a.opacity).toBe(0.5)
    expect(m.line(plain, 0.52, view)).not.toBe(a)
    const h = m.head('#c9d3e6', 0.498)
    expect(m.head('#c9d3e6', 0.503)).toBe(h)
    expect(h.opacity).toBe(0.5)
    // a line drawn whole stays opaque
    expect(m.line(plain, 0.999, view).transparent).toBe(false)
  })

  it('draws as the line drew before: its colour, width, dashes, opacity and the view it is drawn in', () => {
    const m = edgeMaterials()
    const line = m.line({ color: '#2a3040', width: 0.8, dashed: true }, 0.4, view)
    expect(line.color.getHexString()).toBe('2a3040')
    expect(line.linewidth).toBe(0.8)
    expect(line.dashed).toBe(true)
    expect(line.dashSize).toBe(6)
    expect(line.gapSize).toBe(5)
    expect(line.transparent).toBe(true)
    expect(line.opacity).toBe(0.4)
    expect(line.resolution.toArray()).toEqual([1280, 720])
    expect(m.line(plain, 1, view).transparent).toBe(false)
    // a new view size reaches the shared material
    expect(m.line({ color: '#2a3040', width: 0.8, dashed: true }, 0.4, { w: 390, h: 844 }).resolution.toArray()).toEqual([390, 844])
    const head = m.head('#5ac8fa', 0.4)
    expect(head.color.getHexString()).toBe('5ac8fa')
    expect(head.side).toBe(THREE.DoubleSide)
    expect(head.transparent).toBe(true)
    expect(head.opacity).toBe(0.4)
  })

  it('a line taken off the scene does not dispose its shared material (its shader stays compiled); release does', () => {
    const m = edgeMaterials()
    const line = m.line(plain, 1, view)
    const head = m.head('#c9d3e6', 1)
    let disposed = 0
    line.addEventListener('dispose', () => disposed++)
    head.addEventListener('dispose', () => disposed++)
    line.dispose()
    head.dispose()
    expect(disposed).toBe(0)
    m.release()
    expect(disposed).toBe(2)
    expect(m.line(plain, 1, view)).not.toBe(line)
  })
})
