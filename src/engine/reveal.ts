import type { Vec3 } from './camera.js'
import type { Box } from './titleFit.js'

/**
 * Bringing a label the keyboard focused into view: a label that lies even in part outside the free area (the window
 * less the strips the frames keep clear: toolbar, legend or ready-now list, bottom card, side panel) is obscured, and
 * the camera pans, at the same zoom, by the shortest move that puts the whole label inside that area, `pad` px clear
 * of its edges along each axis it was out on. Pure: the graph measures the label and the area and moves the camera.
 */

/** Along one axis: how far (px) to move the span [lo, hi] into [aLo, aHi], `pad` clear of the edge it crosses. */
const shiftAlong = (lo: number, hi: number, aLo: number, aHi: number, pad: number): number => {
  if (lo >= aLo && hi <= aHi) return 0
  // Too large to fit between the pads: centred in the area, so neither end is favoured.
  if (hi - lo > aHi - aLo - 2 * pad) return (aLo + aHi) / 2 - (lo + hi) / 2
  return lo < aLo + pad ? aLo + pad - lo : aHi - pad - hi
}

/** The on-screen move (px, y down) that brings `label` into `area`, or null when it lies wholly inside already. */
export function revealShift(label: Box, area: Box, pad: { x: number; y: number }): { dx: number; dy: number } | null {
  const dx = shiftAlong(label.left, label.right, area.left, area.right, pad.x)
  const dy = shiftAlong(label.top, label.bottom, area.top, area.bottom, pad.y)
  return dx === 0 && dy === 0 ? null : { dx, dy }
}

/**
 * Where the camera goes to bring `label` into `area` (revealShift): the same distance, moved in the plane by the
 * screen move over `ppu` (px per unit at the plane), the other way, with the plane's y up. Null when no move is needed.
 */
export function panToReveal(
  label: Box,
  area: Box,
  pad: { x: number; y: number },
  camera: { position: Vec3; lookAt: Vec3 },
  ppu: number,
): { position: Vec3; lookAt: Vec3 } | null {
  const shift = revealShift(label, area, pad)
  if (shift === null || !(ppu > 0)) return null
  const ux = -shift.dx / ppu
  const uy = shift.dy / ppu
  const by = (p: Vec3): Vec3 => ({ x: p.x + ux, y: p.y + uy, z: p.z })
  return { position: by(camera.position), lookAt: by(camera.lookAt) }
}
