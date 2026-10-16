import * as THREE from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import type { EdgeMaterials } from './edgeMaterials.js'
import { edgeCurve } from './edgePath.js'
import { LAYOUT, type Pt } from './layered.js'
import type { LinkStyle } from './linkStyle.js'
import { DOT } from './nodeLabel.js'

/** How an edge is drawn, apart from where its waypoints are. */
export interface EdgeDraw {
  style: LinkStyle
  /** Rendered card size relative to its layout slot. */
  cardScale: number
  view: { w: number; h: number }
  /** Depth: highlighted edges in front of plain ones, implied ones behind. */
  z: number
  /** How much larger than its slot each end's node draws (due soon or far off). */
  scales: { start: number; end: number }
  opacity: number
}

/** The stroke's polyline and the arrowhead's three corners, in scene coordinates (y up). */
function shape(points: Pt[], d: EdgeDraw): { line: Pt[]; corners: [number, number, number, number, number, number, number, number, number] } {
  const arrow = d.style.arrow * d.cardScale
  const { line, tip } = edgeCurve(points, { cardH: LAYOUT.cardH, cardScale: d.cardScale, arrow, dx: LAYOUT.cardW / 2 - DOT.cx, reach: DOT.reach, scales: d.scales })
  // The head points along the last run of the line (upward into the dependent's bottom edge).
  const half = arrow * 0.45
  const dir = Math.sign(tip.y - line[line.length - 1].y) || 1
  const baseY = -(tip.y - dir * arrow)
  return { line, corners: [tip.x, -tip.y, d.z, tip.x + half, baseY, d.z, tip.x - half, baseY, d.z] }
}

/**
 * One edge as a fat polyline (width in pixels) with a flat arrowhead whose tip touches the dependent's dot. Its
 * materials are the ones every edge of its look shares (edgeMaterials.ts); its geometry is its own.
 */
export function edgeObject(points: Pt[], d: EdgeDraw, materials: EdgeMaterials): THREE.Group {
  const { line, corners } = shape(points, d)
  const group = new THREE.Group()
  const geometry = new LineGeometry()
  geometry.setPositions(line.flatMap(p => [p.x, -p.y, d.z]))
  const stroke = new Line2(geometry, materials.line(d.style, d.opacity, d.view))
  if (d.style.dashed) stroke.computeLineDistances()
  group.add(stroke)
  const head = new THREE.BufferGeometry()
  head.setAttribute('position', new THREE.Float32BufferAttribute(corners, 3))
  group.add(new THREE.Mesh(head, materials.head(d.style.color, d.opacity)))
  return group
}

/**
 * Moves an edge built by edgeObject, of the same look, to new waypoints in place: its buffers are rewritten, nothing is
 * allocated for the GPU, and it then draws exactly as edgeObject would draw it there. false (and nothing changed) when
 * the new shape has another number of points, or `group` is no such edge: the caller builds it afresh.
 */
export function reshapeEdge(group: THREE.Object3D, points: Pt[], d: EdgeDraw): boolean {
  const [stroke, head] = group.children
  if (!(stroke instanceof Line2) || !(head instanceof THREE.Mesh) || group.children.length !== 2) return false
  const start = stroke.geometry.attributes.instanceStart as THREE.InterleavedBufferAttribute | undefined
  const pos = head.geometry.attributes.position as THREE.BufferAttribute | undefined
  if (!start || !pos || pos.count !== 3) return false
  const { line, corners } = shape(points, d)
  const segs = start.data.array as Float32Array
  if (segs.length !== (line.length - 1) * 6) return false
  const distAttr = stroke.geometry.attributes.instanceDistanceStart as THREE.InterleavedBufferAttribute | undefined
  const dist = distAttr ? (distAttr.data.array as Float32Array) : null
  if (dist && dist.length !== (line.length - 1) * 2) return false
  // as LineGeometry.setPositions lays them out: each segment's two ends, in turn
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i]
    const b = line[i + 1]
    const o = i * 6
    segs[o] = a.x
    segs[o + 1] = -a.y
    segs[o + 2] = d.z
    segs[o + 3] = b.x
    segs[o + 4] = -b.y
    segs[o + 5] = d.z
    if (dist) {
      // as Line2.computeLineDistances counts them: from the float32 ends, each run from the float32 one before
      const dx = segs[o + 3] - segs[o]
      const dy = segs[o + 4] - segs[o + 1]
      const dz = segs[o + 5] - segs[o + 2]
      dist[i * 2] = i === 0 ? 0 : dist[i * 2 - 1]
      dist[i * 2 + 1] = dist[i * 2] + Math.sqrt(dx * dx + dy * dy + dz * dz)
    }
  }
  start.data.needsUpdate = true
  if (distAttr) distAttr.data.needsUpdate = true
  stroke.geometry.computeBoundingBox()
  stroke.geometry.computeBoundingSphere()
  ;(pos.array as Float32Array).set(corners)
  pos.needsUpdate = true
  // its bounds, where worked out before, for its new place
  if (head.geometry.boundingSphere) head.geometry.computeBoundingSphere()
  if (head.geometry.boundingBox) head.geometry.computeBoundingBox()
  return true
}
