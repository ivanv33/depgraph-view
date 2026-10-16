export interface Vec3 {
  x: number
  y: number
  z: number
}

export const FLY_DISTANCE = 120

/** The graph is laid out on the z = 0 plane and viewed straight on, so the camera always sits on the plane normal above the node. */
export function cameraFor(node: { x?: number; y?: number; z?: number }, distance = FLY_DISTANCE): { position: Vec3; lookAt: Vec3 } {
  const lookAt = { x: node.x ?? 0, y: node.y ?? 0, z: node.z ?? 0 }
  return { position: { x: lookAt.x, y: lookAt.y, z: lookAt.z + distance }, lookAt }
}

/**
 * Where a camera glide is at `t` (0 to 1 of its time): the camera and the point it looks at move together, eased the
 * same way (fast, then slowing into the end), so a camera that looks straight down at both ends looks straight down the
 * whole way. The step a glide ends over then only nears its place on screen while the zoom only grows. (The graph
 * library's own glide turns the camera toward the new point in a third of the time it takes to get there, so the view
 * tilts on the way and a step can slide away before it comes back.)
 */
export function glideAt(from: { position: Vec3; lookAt: Vec3 }, to: { position: Vec3; lookAt: Vec3 }, t: number): { position: Vec3; lookAt: Vec3 } {
  if (t <= 0) return from
  if (t >= 1) return to
  const k = t * (2 - t)
  const mix = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k })
  return { position: mix(from.position, to.position), lookAt: mix(from.lookAt, to.lookAt) }
}

/** Screen pixels covered by one unit of the z = 0 plane, for a perspective camera `distance` away looking straight at it. */
export function pxPerUnit(distance: number, fovDeg: number, viewH: number): number {
  return viewH / (2 * distance * Math.tan((fovDeg * Math.PI) / 360))
}

/** Camera distance that gives `ppu` pixels per unit. */
export function distanceFor(ppu: number, fovDeg: number, viewH: number): number {
  return viewH / (2 * ppu * Math.tan((fovDeg * Math.PI) / 360))
}

/**
 * Where the camera goes when the view's height changes from `hBefore` to `hAfter` px, so the plan keeps its pixels per
 * unit: the field of view is vertical, so a camera left where it is would scale the plan with the height (a width
 * change alone keeps it). It moves along its line of sight, toward or away from the point it looks at, by the ratio.
 */
export function keepScale(position: Vec3, lookAt: Vec3, hBefore: number, hAfter: number): Vec3 {
  if (!(hBefore > 0 && hAfter > 0) || hBefore === hAfter) return position
  const k = hAfter / hBefore
  return { x: lookAt.x + (position.x - lookAt.x) * k, y: lookAt.y + (position.y - lookAt.y) * k, z: lookAt.z + (position.z - lookAt.z) * k }
}

/**
 * How far to move the camera (and the point it looks at) on the z = 0 plane when the pointer drags the view by
 * (dxPx, dyPx) screen pixels (y down), so the point grabbed stays under the pointer: one pixel across or up and down is
 * the same distance on the plane, the camera moves opposite to the drag, and screen y runs opposite to the plane's y.
 */
export function panFor(dxPx: number, dyPx: number, distance: number, fovDeg: number, viewH: number): { x: number; y: number } {
  const unitsPerPx = 1 / pxPerUnit(distance, fovDeg, viewH)
  return { x: -dxPx * unitsPerPx, y: dyPx * unitsPerPx }
}

/** Cards scale with the zoom like a map, but stay legible when zoomed far out and do not balloon when zoomed in. */
export const LABEL_SCALE = { min: 0.45, max: 1.6 }

export function labelScale(ppu: number): number {
  return Math.min(LABEL_SCALE.max, Math.max(LABEL_SCALE.min, ppu))
}

/**
 * What a press stops. The button going down on the canvas (not on a title, which sits in the label layer above it)
 * makes the camera the user's at once: a glide still running (a frame, Fit) is cut where it is and a wheel zoom still
 * easing ends where it is, so the point under the pointer stays under it from the press on, not only from the first
 * move. A press with nothing moving stops nothing.
 */
export function pressStops(p: { onCanvas: boolean; gliding: boolean; zoomEasing: boolean }): { glide: boolean; zoom: boolean } {
  return { glide: p.onCanvas && p.gliding, zoom: p.onCanvas && p.zoomEasing }
}
