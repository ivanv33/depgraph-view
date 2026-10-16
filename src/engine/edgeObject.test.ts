import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { edgeObject, reshapeEdge, type EdgeDraw } from './edgeObject.js'
import { edgeMaterials } from './edgeMaterials.js'
import { linkStyle } from './linkStyle.js'
import type { Pt } from './layered.js'

const draw = (dashed = false): EdgeDraw => ({
  style: dashed ? linkStyle('none', false, true) : linkStyle('none', false),
  cardScale: 1.2,
  view: { w: 1280, h: 720 },
  z: dashed ? -2 : 0,
  scales: { start: 1, end: 1.3 },
  opacity: 0.8,
})
// a two-row edge (one bend) and a three-row edge (a lane point)
const short: Pt[] = [
  { x: 0, y: 200 },
  { x: 80, y: 0 },
]
const long: Pt[] = [
  { x: 0, y: 400 },
  { x: 40, y: 200 },
  { x: 120, y: 0 },
]
const shift = (pts: Pt[], dx: number, dy: number) => pts.map(p => ({ x: p.x + dx, y: p.y + dy }))

/** What the GPU is handed for the edge: the stroke's segments (and dash distances), the head's corners. */
function drawn(group: THREE.Object3D) {
  const [stroke, head] = group.children as [Line2, THREE.Mesh]
  const g = stroke.geometry
  const segs = Array.from((g.attributes.instanceStart as THREE.InterleavedBufferAttribute).data.array as Float32Array)
  const dist = g.attributes.instanceDistanceStart ? Array.from((g.attributes.instanceDistanceStart as THREE.InterleavedBufferAttribute).data.array as Float32Array) : null
  const corners = Array.from(head.geometry.attributes.position.array as Float32Array)
  // the renderer computes a missing bounding sphere when it first culls
  if (!head.geometry.boundingSphere) head.geometry.computeBoundingSphere()
  return { segs, dist, corners, count: g.instanceCount, sphere: g.boundingSphere?.clone(), headSphere: head.geometry.boundingSphere?.clone(), stroke: stroke.material, head: head.material }
}

describe('reshapeEdge', () => {
  for (const [name, pts] of [
    ['an edge across two rows', short],
    ['an edge with a lane point', long],
  ] as const)
    for (const dashed of [false, true])
      it(`${name}${dashed ? ', dashed' : ''}: moved in place, it draws exactly as one built afresh at its new place`, () => {
        const mats = edgeMaterials()
        const group = edgeObject(pts, draw(dashed), mats)
        const before = drawn(group)
        const to = shift(pts, 37.5, -12.25)
        expect(reshapeEdge(group, to, draw(dashed))).toBe(true)
        const after = drawn(group)
        const fresh = drawn(edgeObject(to, draw(dashed), mats))
        expect(after.segs).toEqual(fresh.segs)
        expect(after.dist).toEqual(fresh.dist)
        expect(after.corners).toEqual(fresh.corners)
        expect(after.count).toBe(fresh.count)
        expect(after.sphere!.center.toArray()).toEqual(fresh.sphere!.center.toArray())
        expect(after.sphere!.radius).toBeCloseTo(fresh.sphere!.radius, 4)
        expect(after.headSphere!.center.toArray()).toEqual(fresh.headSphere!.center.toArray())
        // the same materials, nothing new
        expect(after.stroke).toBe(before.stroke)
        expect(after.head).toBe(before.head)
        expect(after.segs).not.toEqual(before.segs)
      })

  it('a box the head had worked out is worked out again for its new place', () => {
    const mats = edgeMaterials()
    const group = edgeObject(short, draw(), mats)
    const head = group.children[1] as THREE.Mesh
    head.geometry.computeBoundingBox()
    const to = shift(short, 37.5, -12.25)
    reshapeEdge(group, to, draw())
    const fresh = edgeObject(to, draw(), mats).children[1] as THREE.Mesh
    fresh.geometry.computeBoundingBox()
    if (!head.geometry.boundingBox) head.geometry.computeBoundingBox()
    expect(head.geometry.boundingBox!.min.toArray()).toEqual(fresh.geometry.boundingBox!.min.toArray())
    expect(head.geometry.boundingBox!.max.toArray()).toEqual(fresh.geometry.boundingBox!.max.toArray())
  })

  it('says no when the new shape has another number of points (the caller builds it afresh)', () => {
    const group = edgeObject(short, draw(), edgeMaterials())
    const before = drawn(group).segs
    expect(reshapeEdge(group, long, draw())).toBe(false)
    expect(drawn(group).segs).toEqual(before)
  })

  it('says no for an object that is not an edge', () => {
    expect(reshapeEdge(new THREE.Group(), short, draw())).toBe(false)
  })
})
