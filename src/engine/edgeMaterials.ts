import * as THREE from 'three'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'

/**
 * The materials the graph's lines and arrowheads draw with, one per look (colour, width, dashes, opacity), shared by
 * every line of that look and kept for the graph's life.
 *
 * The graph library disposes a line's material whenever it takes the line off the scene, and it takes every line off
 * and builds it again whenever a line's look may have changed (a new selection, a hover, a zoom step that resizes the
 * cards), as a glide does on each of its frames. A material per line meant that once all of them were disposed, the
 * GPU program they drew with was destroyed with them and compiled again for the next frame: on a big plan that compile
 * was most of every such frame. A shared material ignores those disposals (the library still disposes each line's
 * geometry), so its program stays compiled; `release` disposes them all when the graph goes.
 */

export interface EdgeLook {
  color: string
  width: number
  dashed: boolean
}

/** A material that many lines share: a line taken off the scene leaves it alone; only its cache releases it. */
class SharedLineMaterial extends LineMaterial {
  dispose() {}
  release() {
    super.dispose()
  }
}
class SharedMeshMaterial extends THREE.MeshBasicMaterial {
  dispose() {}
  release() {
    super.dispose()
  }
}

/** Opacity to a hundredth: the due-date haze is continuous, and a material per exact value would pile up. */
const hundredth = (opacity: number) => Math.round(opacity * 100) / 100

export function edgeMaterials() {
  const lines = new Map<string, SharedLineMaterial>()
  const heads = new Map<string, SharedMeshMaterial>()
  return {
    /** The material of a line of this look and opacity (to a hundredth), drawn in a view `view` px in size. */
    line(look: EdgeLook, alpha: number, view: { w: number; h: number }): LineMaterial {
      const opacity = hundredth(alpha)
      const key = `${look.color}|${look.width}|${look.dashed}|${opacity}`
      let m = lines.get(key)
      if (!m) {
        m = new SharedLineMaterial({
          color: look.color,
          linewidth: look.width,
          dashed: look.dashed,
          dashSize: 6,
          gapSize: 5,
          transparent: opacity < 1,
          opacity,
          resolution: new THREE.Vector2(view.w, view.h),
        })
        lines.set(key, m)
      } else if (m.resolution.x !== view.w || m.resolution.y !== view.h) m.resolution.set(view.w, view.h)
      return m
    },
    /** The material of an arrowhead of this colour and opacity (to a hundredth). */
    head(color: string, alpha: number): THREE.MeshBasicMaterial {
      const opacity = hundredth(alpha)
      const key = `${color}|${opacity}`
      let m = heads.get(key)
      if (!m) {
        m = new SharedMeshMaterial({ color, side: THREE.DoubleSide, transparent: opacity < 1, opacity })
        heads.set(key, m)
      }
      return m
    },
    /** Disposes every material (the graph is gone), and starts afresh. */
    release() {
      for (const m of lines.values()) m.release()
      for (const m of heads.values()) m.release()
      lines.clear()
      heads.clear()
    },
  }
}
export type EdgeMaterials = ReturnType<typeof edgeMaterials>
