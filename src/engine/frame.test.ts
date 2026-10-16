// The host insets passed in these tests are the values the app's layout produced at each width.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bottomInsetFor, CHAIN_FRAME, SPARE_BACKOFF, chainFrame, doneForFrame, fitOnce, fitPlan, previewPlan, planFitStep, planFitTracker, planFrame, planPoints, frameFor, frameInsets, FRAME, selectionFrameStep, shouldFrameResize, shouldFrameSelection, sizeSettler, hidStep, flyStep, RESIZE_SETTLE_MS, insideArea, userMoveTracker, flyTakesFrame, selectionPoints, selectionFrame, previewSelection, selectedReach, flyX, flyY, flyAt, type Frame } from './frame.js'
import { distanceFor, LABEL_SCALE, labelScale, pxPerUnit } from './camera.js'
import { layoutPlan, LAYOUT, type Layout } from './layered.js'
import { NEAR, SIZE } from './due.js'
import { DOT, LABEL_TEXT, slotTail } from './nodeLabel.js'
import { titleBoost } from './titleFitDom.js'
import { MARK_CSS, markSide, plateLeft } from './plateFit.js'

describe('frameFor', () => {
  const tan30 = Math.tan(Math.PI / 6)

  it('looks straight down at the centre from far enough to fit the height', () => {
    const f = frameFor([{ x: 0, y: -350 }, { x: 0, y: 350 }], { w: 800, h: 1000 }, 60, { pad: 0, maxZ: Infinity })
    expect(f.lookAt).toEqual({ x: 0, y: 0, z: 0 })
    expect(f.position.x).toBe(0)
    expect(f.position.y).toBe(0)
    expect(f.position.z).toBeCloseTo(350 / tan30, 5)
  })

  it('backs off further when the width is the limit', () => {
    const f = frameFor([{ x: -800, y: 0 }, { x: 800, y: 0 }], { w: 500, h: 1000 }, 60, { pad: 0, maxZ: Infinity })
    expect(f.position.z).toBeCloseTo(800 / (tan30 * 0.5), 5)
  })

  it('leaves room around the edges', () => {
    const f = frameFor([{ x: 0, y: -350 }, { x: 0, y: 350 }], { w: 800, h: 1000 }, 60, { pad: 0.1, maxZ: Infinity })
    expect(f.position.z).toBeCloseTo(350 / (tan30 * 0.8), 5)
  })

  it('never backs off past maxZ, and then keeps the root row at the top of the view', () => {
    const f = frameFor([{ x: 0, y: -600 }, { x: 0, y: 600 }], { w: 800, h: 1000 }, 60, { pad: 0, maxZ: 500 })
    expect(f.position.z).toBe(500)
    const halfVisible = 500 * tan30
    expect(f.lookAt.y).toBeCloseTo(600 - halfVisible, 5)
    expect(f.position.y).toBeCloseTo(600 - halfVisible, 5)
  })

  it('keeps a strip of `top` pixels clear for the toolbar and centres the box in the rest', () => {
    const f = frameFor([{ x: 0, y: -350 }, { x: 0, y: 350 }], { w: 800, h: 1000 }, 60, { pad: 0, maxZ: Infinity, top: 100 })
    // the box fills the lower 900 px exactly
    expect(f.position.z).toBeCloseTo(350 / (tan30 * 0.9), 5)
    const unitsPerPx = (2 * f.position.z * tan30) / 1000
    const screenY = (y: number) => 500 - (y - f.lookAt.y) / unitsPerPx
    expect(screenY(350)).toBeCloseTo(100, 5)
    expect(screenY(-350)).toBeCloseTo(1000, 5)
  })

  it('puts the root row just under the toolbar strip when clamped', () => {
    const f = frameFor([{ x: 0, y: -600 }, { x: 0, y: 600 }], { w: 800, h: 1000 }, 60, { pad: 0, maxZ: 500, top: 100 })
    const unitsPerPx = (2 * 500 * tan30) / 1000
    expect(500 - (600 - f.lookAt.y) / unitsPerPx).toBeCloseTo(100, 5)
  })

  it('keeps a strip of `left` pixels clear for the legend and centres the box in the rest', () => {
    const f = frameFor([{ x: -300, y: 0 }, { x: 300, y: 0 }], { w: 1000, h: 1000 }, 60, { pad: 0, maxZ: Infinity, left: 200 })
    expect(f.position.z).toBeCloseTo(300 / (tan30 * 0.8), 5)
    const unitsPerPx = (2 * f.position.z * tan30) / 1000
    const screenX = (x: number) => 500 + (x - f.lookAt.x) / unitsPerPx
    expect(screenX(-300)).toBeCloseTo(200, 5)
    expect(screenX(300)).toBeCloseTo(1000, 5)
  })

  it('keeps a strip of `bottom` pixels clear for the node HUD as well', () => {
    const f = frameFor([{ x: 0, y: -350 }, { x: 0, y: 350 }], { w: 800, h: 1000 }, 60, { pad: 0, maxZ: Infinity, top: 100, bottom: 200 })
    expect(f.position.z).toBeCloseTo(350 / (tan30 * 0.7), 5)
    const unitsPerPx = (2 * f.position.z * tan30) / 1000
    const screenY = (y: number) => 500 - (y - f.lookAt.y) / unitsPerPx
    expect(screenY(350)).toBeCloseTo(100, 5)
    expect(screenY(-350)).toBeCloseTo(800, 5)
  })

  it('does not shift a box that already clears the left strip when centred', () => {
    const f = frameFor([{ x: -100, y: -350 }, { x: 100, y: 350 }], { w: 1000, h: 1000 }, 60, { pad: 0, maxZ: Infinity, left: 200 })
    expect(f.lookAt.x).toBe(0)
  })

  it('centres a single node', () => {
    const f = frameFor([{ x: 5, y: -7 }], { w: 800, h: 1000 }, 60, { pad: 0, maxZ: 500 })
    expect(f.lookAt).toEqual({ x: 5, y: -7, z: 0 })
    expect(f.position.z).toBeGreaterThan(0)
  })
})

describe('fitOnce', () => {
  it('frames the whole tree the first time the layout settles, and never again', () => {
    const moves: unknown[] = []
    const host = {
      nodes: () => [{ x: 0, y: -350 }, { x: 0, y: 350 }],
      fov: () => 60,
      view: () => ({ w: 800, h: 1000 }),
      move: (position: unknown, lookAt: unknown, ms: number) => moves.push([position, lookAt, ms]),
    }
    const onStop = fitOnce(host)
    onStop()
    onStop()
    expect(moves).toHaveLength(1)
    const [position, lookAt, ms] = moves[0] as [{ z: number }, { x: number; y: number; z: number }, number]
    expect(lookAt.x).toBe(0)
    expect(lookAt.z).toBe(0)
    // shifted so the box sits centred between the toolbar strip and the bottom strip (on an 800px-wide view with the
    // legend shown, the bottom strip reaches up past the legend)
    const unitsPerPx = (2 * position.z * Math.tan(Math.PI / 6)) / 1000
    expect(lookAt.y).toBeCloseTo(((FRAME.topInset - FRAME.legendTop) / 2) * unitsPerPx, 6)
    expect(position.z).toBeGreaterThan(0)
    expect(ms).toBe(FRAME.fitMs)
  })

  it('backs off as far as a big plan needs: seeing all of it wins over the readability cap', () => {
    const moves: { z: number }[] = []
    const host = {
      nodes: () => [{ x: -5000, y: 0 }, { x: 5000, y: -9000 }],
      fov: () => 60,
      view: () => ({ w: 800, h: 1000 }),
      move: (position: { z: number }) => moves.push(position),
    }
    fitOnce(host)()
    const tan30 = Math.tan(Math.PI / 6)
    expect(moves[0].z).toBeGreaterThan(1000 / (2 * tan30 * FRAME.minPxPerUnit))
  })

  it('waits while a selection is set (its own frame owns the camera), and fits the first time it runs without one', () => {
    const moves: unknown[] = []
    const host = { nodes: () => [{ x: 0, y: 0 }, { x: 10, y: 10 }], fov: () => 60, view: () => ({ w: 800, h: 1000 }), move: (...a: unknown[]) => moves.push(a) }
    let selected = true
    const onStop = fitOnce(host, () => selected)
    onStop()
    expect(moves).toHaveLength(0)
    selected = false
    onStop()
    onStop()
    expect(moves).toHaveLength(1)
  })

  it('says whether this call framed the plan: only the one that did (so its caller can fit the titles afresh there)', () => {
    const host = { nodes: () => [{ x: 0, y: 0 }, { x: 10, y: 10 }], fov: () => 60, view: () => ({ w: 800, h: 1000 }), move: () => {} }
    let selected = true
    const onStop = fitOnce(host, () => selected)
    expect(onStop()).toBe(false)
    selected = false
    expect(onStop()).toBe(true)
    expect(onStop()).toBe(false)
    expect(fitOnce({ ...host, nodes: () => [] })()).toBe(false)
  })

  it('does nothing before there are nodes to frame', () => {
    const moves: unknown[] = []
    const host = { nodes: () => [], fov: () => 60, view: () => ({ w: 800, h: 1000 }), move: (...a: unknown[]) => moves.push(a) }
    fitOnce(host)()
    expect(moves).toHaveLength(0)
  })
})

describe('frameFor right inset', () => {
  const tan30 = Math.tan(Math.PI / 6)

  it('keeps a strip of `right` pixels clear for the side panel and centres the box in the rest', () => {
    const f = frameFor([{ x: -300, y: 0 }, { x: 300, y: 0 }], { w: 1000, h: 1000 }, 60, { pad: 0, maxZ: Infinity, right: 200 })
    expect(f.position.z).toBeCloseTo(300 / (tan30 * 0.8), 5)
    const unitsPerPx = (2 * f.position.z * tan30) / 1000
    const screenX = (x: number) => 500 + (x - f.lookAt.x) / unitsPerPx
    expect(screenX(-300)).toBeCloseTo(0, 5)
    expect(screenX(300)).toBeCloseTo(800, 5)
  })

  it('centres the box between a left and a right strip', () => {
    const f = frameFor([{ x: -300, y: 0 }, { x: 300, y: 0 }], { w: 1000, h: 1000 }, 60, { pad: 0, maxZ: Infinity, left: 100, right: 400 })
    const unitsPerPx = (2 * f.position.z * tan30) / 1000
    const screenX = (x: number) => 500 + (x - f.lookAt.x) / unitsPerPx
    expect(screenX(-300)).toBeCloseTo(100, 5)
    expect(screenX(300)).toBeCloseTo(600, 5)
  })

  it('centres a box too wide for the space between the strips on that space, not past it', () => {
    const f = frameFor([{ x: -3000, y: 0 }, { x: 3000, y: 0 }], { w: 1000, h: 1000 }, 60, { pad: 0, maxZ: 500, left: 100, right: 400 })
    expect(f.position.z).toBe(500)
    const unitsPerPx = (2 * 500 * tan30) / 1000
    expect(500 + (0 - f.lookAt.x) / unitsPerPx).toBeCloseTo((100 + 600) / 2, 5)
  })

  it('does not shift a box that already clears the right strip when centred', () => {
    const f = frameFor([{ x: -100, y: -350 }, { x: 100, y: 350 }], { w: 1000, h: 1000 }, 60, { pad: 0, maxZ: Infinity, right: 200 })
    expect(f.lookAt.x).toBe(0)
  })
})

describe('chainFrame', () => {
  const view = { w: 1000, h: 800 }
  const opts = { pad: 0, minZ: 100, maxZ: 5000 }
  const insets = { top: 72, bottom: 170, left: 240, right: 416 }
  const free = { left: insets.left, right: view.w - insets.right, top: insets.top, bottom: view.h - insets.bottom }
  const freeCentre = { x: (free.left + free.right) / 2, y: (free.top + free.bottom) / 2 }
  const screen = (f: Frame, p: { x: number; y: number }) => {
    const unitsPerPx = (2 * f.position.z * Math.tan(Math.PI / 6)) / view.h
    return { x: view.w / 2 + (p.x - f.lookAt.x) / unitsPerPx, y: view.h / 2 - (p.y - f.lookAt.y) / unitsPerPx }
  }
  const inFree = (s: { x: number; y: number }) => {
    expect(s.x).toBeGreaterThanOrEqual(free.left - 1e-6)
    expect(s.x).toBeLessThanOrEqual(free.right + 1e-6)
    expect(s.y).toBeGreaterThanOrEqual(free.top - 1e-6)
    expect(s.y).toBeLessThanOrEqual(free.bottom + 1e-6)
  }

  it('centres the bounding box of the focus and its chain in the free area, and fills it', () => {
    const focus = { x: 0, y: 0 }
    const chain = [{ x: 100, y: 300 }, { x: 400, y: -50 }]
    const f = chainFrame(focus, chain, view, 60, { ...opts, ...insets })
    const tl = screen(f, { x: 0, y: 300 }), br = screen(f, { x: 400, y: -50 })
    expect((tl.x + br.x) / 2).toBeCloseTo(freeCentre.x, 4)
    expect((tl.y + br.y) / 2).toBeCloseTo(freeCentre.y, 4)
    for (const p of [focus, ...chain]) inFree(screen(f, p))
    // the box touches the free area on the limiting axis, no mirror half wasted
    const spanX = (br.x - tl.x) / (free.right - free.left), spanY = (br.y - tl.y) / (free.bottom - free.top)
    expect(Math.max(spanX, spanY)).toBeCloseTo(1, 4)
  })

  it('a chain that only extends upward puts the focus below the centre', () => {
    const f = chainFrame({ x: 0, y: 0 }, [{ x: 0, y: 200 }, { x: 0, y: 400 }], view, 60, { ...opts, ...insets })
    const at = screen(f, { x: 0, y: 0 })
    expect(at.y).toBeGreaterThan(freeCentre.y + 50)
    expect(at.y).toBeCloseTo(free.bottom, 4)
  })

  it('a far chain point backs the camera off', () => {
    const near = chainFrame({ x: 0, y: 0 }, [{ x: 0, y: 300 }], view, 60, opts)
    const far = chainFrame({ x: 0, y: 0 }, [{ x: 0, y: 300 }, { x: 0, y: -900 }], view, 60, opts)
    expect(far.position.z).toBeCloseTo(near.position.z * 4, 5)
  })

  it('clamps the distance at both ends', () => {
    const close = chainFrame({ x: 7, y: 9 }, [{ x: 9, y: 11 }], view, 60, opts)
    expect(close.position.z).toBe(100)
    expect(close.lookAt).toEqual({ x: 8, y: 10, z: 0 })
    const wide = chainFrame({ x: 7, y: 9 }, [{ x: 7, y: 90000 }], view, 60, opts)
    expect(wide.position.z).toBe(5000)
  })

  it('keeps the focus inside the free area when the chain is too big to show whole', () => {
    for (const chain of [[{ x: 0, y: 90000 }], [{ x: 0, y: -90000 }], [{ x: -90000, y: 0 }], [{ x: 90000, y: 50000 }]]) {
      const f = chainFrame({ x: 0, y: 0 }, chain, view, 60, { ...opts, ...insets })
      expect(f.position.z).toBe(5000)
      inFree(screen(f, { x: 0, y: 0 }))
    }
  })

  it('leaves done chain points out of the box: a far done node frames the same as without it', () => {
    const chain = [{ x: 0, y: 300 }, { x: 400, y: -50 }]
    const without = chainFrame({ x: 100, y: 0 }, chain, view, 60, { ...opts, ...insets })
    const withDone = chainFrame({ x: 100, y: 0 }, [...chain, { x: -3000, y: 2000, done: true }], view, 60, { ...opts, ...insets })
    expect(withDone).toEqual(without)
    // not done, the same point backs the camera off
    const counted = chainFrame({ x: 100, y: 0 }, [...chain, { x: -3000, y: 2000, done: false }], view, 60, { ...opts, ...insets })
    expect(counted.position.z).toBeGreaterThan(without.position.z)
  })

  it('takes a spare point (a done deck) into the box when the whole box still fits, backing off a little at most', () => {
    // the focus alone sits at minZ, with room to spare: a near spare point joins the box and the frame moves to show it
    const alone = chainFrame({ x: 0, y: 0 }, [], view, 60, { ...opts, ...insets })
    const near = chainFrame({ x: 0, y: 0 }, [{ x: 0, y: -20, spare: true }], view, 60, { ...opts, ...insets })
    expect(near.position.z).toBe(alone.position.z)
    expect(near.lookAt.y).toBeLessThan(alone.lookAt.y)
    inFree(screen(near, { x: 0, y: -20 }))
    // a little farther: the camera backs off to show it, at most SPARE_BACKOFF times as far, and everything is in view
    const chain = [{ x: 0, y: 300 }, { x: 400, y: -50 }]
    const base = chainFrame({ x: 100, y: 0 }, chain, view, 60, { ...opts, ...insets })
    const some = chainFrame({ x: 100, y: 0 }, [...chain, { x: 0, y: -450, spare: true }], view, 60, { ...opts, ...insets })
    expect(some.position.z).toBeGreaterThan(base.position.z)
    expect(some.position.z).toBeLessThanOrEqual(base.position.z * SPARE_BACKOFF)
    for (const p of [{ x: 100, y: 0 }, ...chain, { x: 0, y: -450 }]) inFree(screen(some, p))
    // a far one would back it off a lot: it is left out, as a done point is
    const without = chainFrame({ x: 100, y: 0 }, chain, view, 60, { ...opts, ...insets })
    const far = chainFrame({ x: 100, y: 0 }, [...chain, { x: 0, y: -3000, spare: true }], view, 60, { ...opts, ...insets })
    expect(far).toEqual(without)
  })

  it("takes the selected step's own done deck (an `own` spare point) first: a far other done deck does not push it out", () => {
    const chain = [{ x: 0, y: 300 }, { x: 400, y: -50 }]
    const own = { x: 0, y: -450, spare: true, own: true }
    const far = { x: 0, y: -3000, spare: true }
    const withOwn = chainFrame({ x: 100, y: 0 }, [...chain, own], view, 60, { ...opts, ...insets })
    // with a far other deck too, the own deck still joins the box, and the far one is left out
    const both = chainFrame({ x: 100, y: 0 }, [...chain, own, far], view, 60, { ...opts, ...insets })
    expect(both).toEqual(withOwn)
    for (const p of [{ x: 100, y: 0 }, ...chain, own]) inFree(screen(both, p))
    // without `own`, the two spare points go together, and both are left out
    const plain = chainFrame({ x: 100, y: 0 }, [...chain, { ...own, own: undefined }, far], view, 60, { ...opts, ...insets })
    expect(plain).toEqual(chainFrame({ x: 100, y: 0 }, chain, view, 60, { ...opts, ...insets }))
    // the other decks join it when the whole box still fits within the same backing off
    const nearOther = chainFrame({ x: 100, y: 0 }, [...chain, own, { x: 300, y: -440, spare: true }], view, 60, { ...opts, ...insets })
    for (const p of [own, { x: 300, y: -440 }]) inFree(screen(nearOther, p))
  })

  it('frames the focus alone when every other chain point is done', () => {
    const alone = chainFrame({ x: 3, y: -4 }, [], view, 60, { ...opts, ...insets })
    const allDone = chainFrame({ x: 3, y: -4 }, [{ x: 900, y: 900, done: true }, { x: -900, y: -900, done: true }], view, 60, { ...opts, ...insets })
    expect(allDone).toEqual(alone)
    expect(allDone.position.z).toBe(100)
  })

  it('frames the focus alone at minZ, in the middle of the free area, when the chain is empty', () => {
    const f = chainFrame({ x: 3, y: -4 }, [], view, 60, opts)
    expect(f.position).toEqual({ x: 3, y: -4, z: 100 })
    expect(f.lookAt).toEqual({ x: 3, y: -4, z: 0 })
    const g = chainFrame({ x: 3, y: -4 }, [], view, 60, { ...opts, ...insets })
    const at = screen(g, { x: 3, y: -4 })
    expect(at.x).toBeCloseTo(freeCentre.x, 4)
    expect(at.y).toBeCloseTo(freeCentre.y, 4)
  })

  it('leaves the pad clear around the box', () => {
    const f = chainFrame({ x: 0, y: 0 }, [{ x: 0, y: 400 }], view, 60, { ...opts, pad: 0.1 })
    expect(screen(f, { x: 0, y: 400 }).y).toBeCloseTo(80, 4)
    expect(screen(f, { x: 0, y: 0 }).y).toBeCloseTo(720, 4)
  })

  it('uses the first fit\'s padding, the distance where cards stop growing as the closest, and the whole plan\'s fit as the farthest', () => {
    expect(CHAIN_FRAME.pad).toBe(FRAME.fitPad)
    expect(CHAIN_FRAME.minZ({ w: 800, h: 1000 }, 60)).toBeCloseTo(distanceFor(LABEL_SCALE.max, 60, 1000), 9)
    const view = { w: 800, h: 1000 }
    const big = [{ x: -3000, y: 3000 }, { x: 3000, y: -3000 }]
    // the slots' fit: the whole plan's frame may back off farther still for cards drawn past their slots
    expect(CHAIN_FRAME.maxZ(big, view, 60, { right: 416 }, false)).toBeCloseTo(frameFor(big, view, 60, { pad: FRAME.fitPad, maxZ: Infinity, ...frameInsets(view, { right: 416 }, false) }).position.z, 6)
    expect(CHAIN_FRAME.maxZ(big, view, 60, { right: 416 }, false)).toBeLessThanOrEqual(planFrame(big, view, 60, { right: 416 }, false).position.z)
    // farther than the readability cap when the plan needs it
    expect(CHAIN_FRAME.maxZ(big, view, 60, { right: 416 }, false)).toBeGreaterThan(1000 / (2 * Math.tan(Math.PI / 6) * FRAME.minPxPerUnit))
    // a plan smaller than that still lets the selection come as close as the nearest frame
    expect(CHAIN_FRAME.maxZ([{ x: -1, y: 1 }, { x: 1, y: -1 }], view, 60)).toBe(CHAIN_FRAME.minZ(view, 60))
  })
})

describe('previewPlan', () => {
  const nodes = () => [{ x: 0, y: -350 }, { x: 0, y: 350 }]
  const host = (moves: unknown[], landed: string[] = []) => ({
    nodes,
    fov: () => 60,
    view: () => ({ w: 1000, h: 1000 }),
    move: (position: unknown, lookAt: unknown, ms: number, land?: () => void) => {
      moves.push([position, lookAt, ms])
      land?.()
    },
    landed: () => landed.push('landed'),
  })

  it('jumps (0 ms) to the frame the load fit would glide to, and does not count as a landed frame', () => {
    const fit: unknown[] = []
    fitOnce(host(fit))()
    const moves: unknown[] = []
    const landed: string[] = []
    expect(previewPlan(host(moves, landed))).toBe(true)
    const [position, lookAt, ms] = moves[0] as [unknown, unknown, number]
    const [fitPosition, fitLookAt] = fit[0] as [unknown, unknown, number]
    expect(position).toEqual(fitPosition)
    expect(lookAt).toEqual(fitLookAt)
    expect(ms).toBe(0)
    expect(landed).toEqual([])
  })

  it('moves nothing with nothing to frame or no view to frame it in', () => {
    const moves: unknown[] = []
    expect(previewPlan({ ...host(moves), nodes: () => [] })).toBe(false)
    expect(previewPlan({ ...host(moves), view: () => ({ w: 0, h: 600 }) })).toBe(false)
    expect(moves).toEqual([])
  })
})

describe('previewSelection', () => {
  // A plan of three steps across, the middle one selected with its two neighbours.
  const nodes = () => [{ x: -900, y: 40 }, { x: 900, y: -40 }]
  const host = (moves: unknown[], landed: string[] = [], view = { w: 1280, h: 720 }) => ({
    nodes,
    fov: () => 60,
    view: () => view,
    move: (position: unknown, lookAt: unknown, ms: number, land?: () => void) => {
      moves.push([position, lookAt, ms])
      land?.()
    },
    landed: () => landed.push('landed'),
  })
  const sel = {
    focus: { x: 0, y: 0 },
    chain: [
      { x: -385, y: -40 },
      { x: -215, y: 40 },
      { x: -85, y: -40 },
      { x: 85, y: 40 },
      { x: 215, y: -40 },
      { x: 385, y: 40 },
    ],
  }

  it("is the selection's frame: chainFrame with the chain frame's pad, nearest and farthest and the strips", () => {
    const view = { w: 1280, h: 720 }
    const right = 416, bottom = 230
    const expected = chainFrame(sel.focus, sel.chain, view, 60, {
      pad: CHAIN_FRAME.pad,
      minZ: CHAIN_FRAME.minZ(view, 60),
      maxZ: CHAIN_FRAME.maxZ(nodes(), view, 60, { right, bottom }, true),
      ...frameInsets(view, { right, bottom }, true),
    })
    expect(selectionFrame(host([]), { ...sel, insets: { right, bottom }, legend: true })).toEqual(expected)
  })

  it("keeps the selected step as drawn clear of the chrome's bottom edge (`top`) when that is lower than FRAME.topInset, and only then", () => {
    const view = { w: 1280, h: 720 }
    const bottom = 230, top = 300
    const plain = selectionFrame(host([]), { ...sel, insets: { bottom } }) as Frame
    const lower = selectionFrame(host([]), { ...sel, insets: { bottom }, top }) as Frame
    // the selected step's circle on screen (y down), and its brackets' reach above it at that zoom
    const unitsPerPx = (2 * lower.position.z * Math.tan((60 * Math.PI) / 360)) / view.h
    const screenY = view.h / 2 - (sel.focus.y - lower.lookAt.y) / unitsPerPx
    const reach = selectedReach(1 / unitsPerPx)
    expect(screenY - reach.top).toBeGreaterThanOrEqual(top + FRAME.edgeMargin - 1e-6)
    expect(lower.lookAt.y).toBeGreaterThan(plain.lookAt.y)
    expect(lower.position.z).toBe(plain.position.z)
    expect(selectionFrame(host([]), { ...sel, insets: { bottom }, top: FRAME.topInset - 20 })).toEqual(plain)
  })

  it("jumps (0 ms) to the selection's frame, and does not count as a landed frame", () => {
    const moves: unknown[] = []
    const landed: string[] = []
    expect(previewSelection(host(moves, landed), { ...sel, insets: { bottom: 230 } })).toBe(true)
    const f = selectionFrame(host([]), { ...sel, insets: { bottom: 230 } }) as Frame
    expect(moves).toEqual([[f.position, f.lookAt, 0]])
    expect(landed).toEqual([])
  })

  it('moves nothing with no view to frame it in', () => {
    const moves: unknown[] = []
    expect(previewSelection(host(moves, [], { w: 0, h: 720 }), sel)).toBe(false)
    expect(selectionFrame(host([], [], { w: 1280, h: 0 }), sel)).toBe(null)
    expect(moves).toEqual([])
  })
})

describe('fitPlan', () => {
  const host = (moves: unknown[]) => ({
    nodes: () => [{ x: 0, y: -350 }, { x: 0, y: 350 }],
    fov: () => 60,
    view: () => ({ w: 1000, h: 1000 }),
    move: (position: unknown, lookAt: unknown, ms: number) => moves.push([position, lookAt, ms]),
  })

  it('frames the whole plan every time it is asked, the same way the first fit does', () => {
    const first: unknown[] = []
    fitOnce(host(first))()
    const again: unknown[] = []
    const h = host(again)
    expect(fitPlan(h)).toBe(true)
    expect(fitPlan(h)).toBe(true)
    expect(again).toEqual([first[0], first[0]])
  })

  it('keeps the side panel strip clear when asked to', () => {
    const moves: unknown[] = []
    fitPlan({ ...host(moves), nodes: () => [{ x: -400, y: 0 }, { x: 400, y: 0 }] }, { right: 416 })
    const [position, lookAt] = moves[0] as [{ z: number }, { x: number }]
    const unitsPerPx = (2 * position.z * Math.tan(Math.PI / 6)) / 1000
    expect(1000 / 2 + (400 - lookAt.x) / unitsPerPx).toBeLessThanOrEqual(1000 - 416 + 1e-6)
  })

  it('keeps a taller bottom card clear when given its strip', () => {
    // the plan's bottom edge on screen, in px from the top of the view
    const bottomPx = (bottom?: number) => {
      const moves: unknown[] = []
      fitPlan(host(moves), { right: 0, bottom }, true)
      const [position, lookAt] = moves[0] as [{ z: number }, { y: number }]
      const unitsPerPx = (2 * position.z * Math.tan(Math.PI / 6)) / 1000
      return 1000 / 2 + (lookAt.y - -350) / unitsPerPx
    }
    expect(bottomPx()).toBeLessThanOrEqual(1000 - FRAME.bottomInset + 1e-6)
    expect(bottomPx(400)).toBeLessThanOrEqual(1000 - 400 + 1e-6)
    expect(bottomPx(400)).toBeLessThan(bottomPx() - 100)
  })

  it('does nothing, and says so, while the view has no size (so a first fit is tried again)', () => {
    for (const view of [{ w: 0, h: 0 }, { w: 1000, h: 0 }, { w: 0, h: 1000 }]) {
      const moves: unknown[] = []
      expect(fitPlan({ ...host(moves), view: () => view })).toBe(false)
      expect(moves).toHaveLength(0)
    }
    let size = { w: 0, h: 0 }
    const moves: unknown[] = []
    const fit = fitOnce({ ...host(moves), view: () => size })
    fit()
    expect(moves).toHaveLength(0)
    size = { w: 1000, h: 1000 }
    fit()
    expect(moves).toHaveLength(1)
    expect(JSON.stringify(moves[0])).not.toContain('null')
  })

  it('does nothing without nodes', () => {
    const moves: unknown[] = []
    expect(fitPlan({ ...host(moves), nodes: () => [] })).toBe(false)
    expect(moves).toHaveLength(0)
  })

  it('tells the host once the camera has landed where the frame put it, not before, and not for a move cut short', () => {
    // the move hands back its landing: called when its glide ends, never when another move cuts it short
    const landings: (() => void)[] = []
    let landed = 0
    const h = { ...host([]), move: (_p: unknown, _l: unknown, _ms: number, land?: () => void) => void (land && landings.push(land)), landed: () => landed++ }
    expect(fitPlan(h)).toBe(true)
    expect(landings).toHaveLength(1)
    expect(landed, 'not while the frame glides').toBe(0)
    landings[0]()
    expect(landed, 'once it lands').toBe(1)
    // F, a resize, closing the selection and the load's own frame alike: every whole-plan frame lands so
    fitPlan(h, { right: 416 })
    fitOnce(h)()
    expect(landings).toHaveLength(3)
    expect(landed, 'a frame cut short by another move never lands').toBe(1)
    landings[2]()
    expect(landed).toBe(2)
  })
})

describe('shouldFrameSelection', () => {
  const last = { id: 'a', right: 416 }
  it('frames a new selection, or the same one when the panel opens or closes under it', () => {
    expect(shouldFrameSelection(last, { id: 'b', right: 416 }, false)).toBe(true)
    expect(shouldFrameSelection(last, { id: 'a', right: 0 }, false)).toBe(true)
    expect(shouldFrameSelection({ id: null, right: 0 }, { id: 'a', right: 0 }, false)).toBe(true)
  })
  it('does not frame nothing, the frame already made, or while the user drags', () => {
    expect(shouldFrameSelection(last, { id: null, right: 416 }, false)).toBe(false)
    expect(shouldFrameSelection(last, { id: 'a', right: 416 }, false)).toBe(false)
    expect(shouldFrameSelection(last, { id: 'b', right: 416 }, true)).toBe(false)
  })
  const was = { id: 'a', right: 416, bottom: 170, chain: 'b\nc', at: '0,0' }
  const covered = { userMoved: false, covered: true }
  const clear = { userMoved: false, covered: false }
  const moved = { userMoved: true, covered: true }
  it('frames the same selection again when the user folds or unfolds the card under it, as for the panel', () => {
    for (const ctx of [covered, clear, moved]) {
      expect(shouldFrameSelection({ ...was, folded: false }, { ...was, bottom: 76, folded: true }, false, ctx)).toBe(true)
      expect(shouldFrameSelection({ ...was, folded: true }, { ...was, bottom: 400, folded: false }, false, ctx)).toBe(true)
    }
    expect(shouldFrameSelection(was, { ...was, folded: false }, false, clear)).toBe(false) // never folded is open
    expect(shouldFrameSelection({ ...was, folded: false }, { ...was, folded: true }, true, covered)).toBe(false) // not while dragging
  })
  it('frames the same selection again when its chain gains or loses a step (N, L), whatever the user did', () => {
    for (const ctx of [covered, clear, moved]) expect(shouldFrameSelection(was, { ...was, chain: 'b\nc\nd' }, false, ctx)).toBe(true)
    expect(shouldFrameSelection(was, { ...was }, false, covered)).toBe(false)
    expect(shouldFrameSelection(was, { ...was, chain: 'b\nc\nd' }, true, covered)).toBe(false)
  })
  it('re-frames for a new card height or a layout shift only when the chain would be covered or out of view', () => {
    for (const change of [{ bottom: 320 }, { at: '200,0' }]) {
      expect(shouldFrameSelection(was, { ...was, ...change }, false, covered)).toBe(true)
      expect(shouldFrameSelection(was, { ...was, ...change }, false, clear)).toBe(false)
      expect(shouldFrameSelection(was, { ...was, ...change }, true, covered)).toBe(false)
    }
  })
  it('leaves a camera the user zoomed or panned alone for a new card height or a layout shift', () => {
    for (const change of [{ bottom: 320 }, { at: '200,0' }]) expect(shouldFrameSelection(was, { ...was, ...change }, false, moved)).toBe(false)
    // a new selection or the panel opening is framed even so
    expect(shouldFrameSelection(was, { ...was, id: 'b' }, false, moved)).toBe(true)
    expect(shouldFrameSelection(was, { ...was, right: 0 }, false, moved)).toBe(true)
  })
})

describe('insideArea', () => {
  const strips = { top: 72, bottom: 200, left: 0, right: 416 }
  const view = { w: 1280, h: 720 }
  it('is true when every point is inside the view less its strips', () => {
    expect(insideArea([{ x: 10, y: 80 }, { x: 860, y: 515 }], view, strips)).toBe(true)
  })
  it('is false when a point is under a strip or off the view', () => {
    expect(insideArea([{ x: 10, y: 80 }, { x: 860, y: 530 }], view, strips)).toBe(false)
    expect(insideArea([{ x: 870, y: 100 }], view, strips)).toBe(false)
    expect(insideArea([{ x: -5, y: 100 }], view, strips)).toBe(false)
    expect(insideArea([{ x: 5, y: 60 }], view, strips)).toBe(false)
  })
})

describe('bottomInsetFor', () => {
  it('keeps the bottom card and a gap above it clear, never less than the default strip', () => {
    expect(bottomInsetFor(null)).toBe(FRAME.bottomInset)
    expect(bottomInsetFor(60)).toBe(FRAME.bottomInset)
    expect(bottomInsetFor(300)).toBe(300 + FRAME.hudBottom + FRAME.hudGap)
  })
  it('counts a folded card as the thin strip it is: its own height and gaps, without the default strip\'s floor', () => {
    expect(bottomInsetFor(48, true)).toBe(48 + FRAME.hudBottom + FRAME.hudGap)
    expect(bottomInsetFor(48.4, true)).toBe(49 + FRAME.hudBottom + FRAME.hudGap)
    expect(bottomInsetFor(48, true)).toBeLessThan(FRAME.bottomInset)
    expect(bottomInsetFor(null, true)).toBe(FRAME.bottomInset) // no card: the default strip, folded or not
    expect(bottomInsetFor(48, false)).toBe(FRAME.bottomInset)
  })
  it('passes through frameInsets and the chain frame\'s cap', () => {
    const view = { w: 1280, h: 720 }
    expect(frameInsets(view, { right: 416, bottom: 330 }, false).bottom).toBe(330)
    const plan = [{ x: -1500, y: 600 }, { x: 1500, y: -600 }]
    // a taller card leaves less room: the whole plan's fit in that room is farther away
    expect(CHAIN_FRAME.maxZ(plan, view, 60, { right: 416, bottom: 330 }, false)).toBeGreaterThan(CHAIN_FRAME.maxZ(plan, view, 60, { right: 416 }, false))
    expect(CHAIN_FRAME.maxZ(plan, view, 60, { right: 416, bottom: 330 }, false)).toBeCloseTo(frameFor(plan, view, 60, { pad: FRAME.fitPad, maxZ: Infinity, ...frameInsets(view, { right: 416, bottom: 330 }, false) }).position.z, 6)
  })
})

describe('narrow views', () => {
  it('never lets the side panel take more than leaves 40% of the view (less the legend), nor go negative', () => {
    expect(frameInsets({ w: 400, h: 800 }, { right: 416 }).right).toBe(240)
    expect(frameInsets({ w: 1000, h: 800 }, { right: 416 }).right).toBe(360)
    expect(frameInsets({ w: 1440, h: 900 }, { right: 416 }).right).toBe(416)
    expect(frameInsets({ w: 300, h: 800 }, { right: 0 }).right).toBe(0)
  })
  it('merges the host strips with the frame floors: top at least topInset, left at least the legend strip, right shrinking', () => {
    // a host top below 72 is raised to 72; one above it wins
    expect(frameInsets({ w: 1280, h: 720 }, { top: 40 }).top).toBe(FRAME.topInset)
    expect(frameInsets({ w: 1280, h: 720 }, { top: 120 }).top).toBe(120)
    // on a wide view with the legend, a host left below 240 is raised to 240
    expect(frameInsets({ w: 1280, h: 720 }, { left: 100 }, true).left).toBe(FRAME.leftInset)
    // a host left past 60% of the width is kept whole, and the right strip shrinks to nothing
    expect(frameInsets({ w: 1000, h: 800 }, { left: 700, right: 416 }, true)).toMatchObject({ left: 700, right: 0 })
  })

  it('frames a chain at 400 px wide with the panel open: a finite position with the focus inside the view', () => {
    const view = { w: 400, h: 800 }
    const focus = { x: 50, y: -40 }
    const chain = [{ x: -400, y: 300 }, { x: 600, y: -500 }]
    const f = chainFrame(focus, chain, view, 60, { pad: CHAIN_FRAME.pad, minZ: CHAIN_FRAME.minZ(view, 60), maxZ: CHAIN_FRAME.maxZ(chain, view, 60, { right: 416 }), ...frameInsets(view, { right: 416 }) })
    for (const v of [f.position.x, f.position.y, f.position.z, f.lookAt.x, f.lookAt.y]) expect(Number.isFinite(v)).toBe(true)
    const unitsPerPx = (2 * f.position.z * Math.tan(Math.PI / 6)) / view.h
    const sx = view.w / 2 + (focus.x - f.lookAt.x) / unitsPerPx
    const sy = view.h / 2 - (focus.y - f.lookAt.y) / unitsPerPx
    expect(sx).toBeGreaterThanOrEqual(0)
    // inside the strip the panel leaves free, not under the panel
    expect(sx).toBeLessThanOrEqual(view.w - frameInsets(view, { right: 416 }).right)
    expect(sy).toBeGreaterThanOrEqual(0)
    expect(sy).toBeLessThanOrEqual(view.h)
  })

  it('stays finite even when the strips leave no room at all, and still backs off far enough to show the box', () => {
    const f = frameFor([{ x: -100, y: -100 }, { x: 100, y: 100 }], { w: 400, h: 200 }, 60, { pad: 0.06, maxZ: Infinity, top: 72, bottom: 170, left: 240, right: 416 })
    expect(Number.isFinite(f.position.z)).toBe(true)
    // the whole view's half-height at that distance covers the box's half-height (100)
    expect(f.position.z * Math.tan(Math.PI / 6)).toBeGreaterThanOrEqual(100)
  })

  it('keeps the left strip only while the legend is on screen', () => {
    expect(frameInsets({ w: 1280, h: 720 }, { right: 416 }, true).left).toBe(240)
    expect(frameInsets({ w: 1280, h: 720 }, { right: 416 }, false).left).toBe(0)
    expect(frameInsets({ w: 800, h: 740 }, { right: 416 }, false)).toEqual({ top: 72, bottom: 170, left: 0, right: 416 })
  })

  it('on a view narrower than the left strip needs, keeps the legend\'s corner clear from below while it shows', () => {
    // 800x740: the bottom strip reaches past the legend's top edge instead of a left strip
    expect(frameInsets({ w: 800, h: 740 }, { right: 0 }, true)).toEqual({ top: 72, bottom: FRAME.legendTop, left: 0, right: 0 })
    // a taller bottom card keeps its own strip
    expect(frameInsets({ w: 800, h: 740 }, { right: 0, bottom: 400 }, true).bottom).toBe(400)
    // a view too short for that keeps the left strip clear instead
    expect(frameInsets({ w: 800, h: 500 }, { right: 0 }, true)).toEqual({ top: 72, bottom: FRAME.bottomInset, left: FRAME.leftInset, right: 0 })
    // a host left strip alone (a step selected) keeps its strip at the left on a wide view and none on a narrow one
    expect(frameInsets({ w: 1280, h: 720 }, { right: 0, left: 240 }, false).left).toBe(FRAME.leftInset)
    expect(frameInsets({ w: 800, h: 740 }, { right: 0, bottom: 250 }, false)).toEqual({ top: 72, bottom: 250, left: 0, right: 0 })
    // below the width where the legend hides, nothing is kept for it
    expect(frameInsets({ w: 600, h: 740 }, { right: 0 }, true)).toEqual({ top: 72, bottom: FRAME.bottomInset, left: 0, right: 0 })
    // and a frame of a plan whose bottom-left step would sit under the legend keeps it above the legend
    const view = { w: 800, h: 740 }
    const plan = [{ x: -500, y: -300 }, { x: 500, y: 300 }]
    const f = planFrame(plan, view, 60)
    const unitsPerPx = (2 * f.position.z * Math.tan(Math.PI / 6)) / view.h
    const screenY = (y: number) => view.h / 2 - (y - f.lookAt.y) / unitsPerPx
    expect(screenY(-300)).toBeLessThanOrEqual(view.h - FRAME.legendTop + 1e-6)
  })

  it.each([
    { w: 800, h: 740 },
    { w: 1280, h: 720 },
  ])('frames a selection at $w x $h with the panel open and no legend into the whole width left of the panel, centred', view => {
    const insets = frameInsets(view, { right: 416 }, false)
    const half = view.w / 3 // wide enough that the frame is neither at its nearest nor at its farthest
    const chain = [{ x: -half, y: 80 }, { x: half, y: -80 }]
    const f = chainFrame({ x: 0, y: 0 }, chain, view, 60, { pad: CHAIN_FRAME.pad, minZ: CHAIN_FRAME.minZ(view, 60), maxZ: CHAIN_FRAME.maxZ([...chain, { x: -3000, y: 3000 }, { x: 3000, y: -3000 }], view, 60, { right: 416 }, false), ...insets })
    const unitsPerPx = (2 * f.position.z * Math.tan(Math.PI / 6)) / view.h
    const sx = (x: number) => view.w / 2 + (x - f.lookAt.x) / unitsPerPx
    const pad = CHAIN_FRAME.pad * view.w
    // centred between the left edge plus pad and the panel less pad
    expect((sx(-half) + sx(half)) / 2).toBeCloseTo((pad + view.w - 416 - pad) / 2, 0)
    // and uses that width: the box spans the free width (it is wider than tall here)
    expect(sx(half) - sx(-half)).toBeCloseTo(view.w - 416 - 2 * pad, 0)
  })
})

describe('doneForFrame', () => {
  const status = (id: string) => ({ a: 'done', b: 'todo', c: 'doing', d: 'blocked' })[id]
  it('a done chain node is left out of the frame, any other status counts', () => {
    expect(doneForFrame('a', 'b', status)).toBe(true)
    expect(doneForFrame('c', 'b', status)).toBe(false)
    expect(doneForFrame('d', 'b', status)).toBe(false)
  })
  it('the selected node always counts, even when done', () => {
    expect(doneForFrame('a', 'a', status)).toBe(false)
  })
  it('a deck counts unless all its members are done', () => {
    expect(doneForFrame('deck:x', 'b', status, [{ status: 'done' }, { status: 'done' }])).toBe(true)
    expect(doneForFrame('deck:x', 'b', status, [{ status: 'done' }, { status: 'todo' }])).toBe(false)
  })
})

describe('frames always contain what they frame', () => {
  const fov = 50
  const tan = Math.tan((fov * Math.PI) / 360)
  const project = (f: Frame, view: { w: number; h: number }, p: { x: number; y: number }) => {
    const unitsPerPx = (2 * f.position.z * tan) / view.h
    return { x: view.w / 2 + (p.x - f.lookAt.x) / unitsPerPx, y: view.h / 2 - (p.y - f.lookAt.y) / unitsPerPx }
  }
  const inside = (view: { w: number; h: number }, insets: { top: number; bottom: number; left: number; right: number }, at: { x: number; y: number }) => {
    expect(at.x).toBeGreaterThanOrEqual(insets.left - 1e-6)
    expect(at.x).toBeLessThanOrEqual(view.w - insets.right + 1e-6)
    expect(at.y).toBeGreaterThanOrEqual(insets.top - 1e-6)
    expect(at.y).toBeLessThanOrEqual(view.h - insets.bottom + 1e-6)
  }

  for (const view of [{ w: 1280, h: 720 }, { w: 800, h: 740 }]) {
    it(`a wide plan (32 slots in a row) fits whole inside the free area at ${view.w}x${view.h}`, () => {
      const corners = [{ x: -32 * 103, y: 22 }, { x: 32 * 103, y: -400 }]
      const f = planFrame(corners, view, fov)
      for (const p of corners) inside(view, frameInsets(view), project(f, view, p))
      const moves: { z: number }[] = []
      fitPlan({ nodes: () => corners, fov: () => fov, view: () => view, move: (position: { z: number }) => moves.push(position) })
      expect(moves[0].z).toBeCloseTo(f.position.z, 9)
    })

    it(`a tall chain (30 rows) fits inside the free area left of the panel at ${view.w}x${view.h}, never farther than the whole plan`, () => {
      const insets = frameInsets(view, { right: 416 }, false)
      const plan = [{ x: -1500, y: 22 }, { x: 1500, y: -30 * 122 }]
      const chain = Array.from({ length: 30 }, (_, i) => [{ x: -85, y: -i * 122 + 22 }, { x: 85, y: -i * 122 - 22 }]).flat()
      const maxZ = CHAIN_FRAME.maxZ(plan, view, fov, { right: 416 }, false)
      expect(maxZ).toBeLessThanOrEqual(planFrame(plan, view, fov, { right: 416 }, false).position.z)
      const f = chainFrame({ x: 0, y: 0 }, chain, view, fov, { pad: CHAIN_FRAME.pad, minZ: CHAIN_FRAME.minZ(view, fov), maxZ, ...insets })
      for (const p of chain) inside(view, insets, project(f, view, p))
      expect(f.position.z).toBeLessThanOrEqual(maxZ)
    })
  }
})

describe('selectionFrameStep', () => {
  const last = { id: 'a', right: 416 }
  it('frames a new selection once the graph is ready and nobody drags', () => {
    expect(selectionFrameStep(last, { id: 'b', right: 416 }, true, false)).toBe('frame')
    expect(selectionFrameStep(last, { id: 'a', right: 0 }, true, false)).toBe('frame')
  })
  it('waits, without marking it seen, for a selection made before the graph is ready', () => {
    expect(selectionFrameStep({ id: null, right: 416 }, { id: 'b', right: 416 }, false, false)).toBe('wait')
  })
  it('marks a selection made while the user drags as seen, so no later engine stop or panel change jumps to it', () => {
    expect(selectionFrameStep(last, { id: 'b', right: 416 }, true, true)).toBe('seen')
  })
  it('marks nothing selected, or the frame already made, as seen', () => {
    expect(selectionFrameStep(last, { id: null, right: 416 }, true, false)).toBe('seen')
    expect(selectionFrameStep(last, { id: null, right: 416 }, false, false)).toBe('seen')
    expect(selectionFrameStep(last, { id: 'a', right: 416 }, true, false)).toBe('seen')
  })
})

describe('a lone step is framed with its surroundings', () => {
  for (const view of [{ w: 1280, h: 720 }, { w: 800, h: 740 }]) {
    it(`a selection with no unfinished chain stops where cards stop growing at ${view.w}x${view.h}`, () => {
      const fov = 50
      const card = [{ x: -85, y: 22, done: false }, { x: 85, y: -22, done: false }]
      const f = chainFrame({ x: 0, y: 0 }, card, view, fov, { pad: CHAIN_FRAME.pad, minZ: CHAIN_FRAME.minZ(view, fov), maxZ: 1e6, ...frameInsets(view, { right: 416 }, false) })
      expect(pxPerUnit(f.position.z, fov, view.h)).toBeCloseTo(LABEL_SCALE.max, 6)
    })
  }
})

describe('planFitStep', () => {
  const at = (selectedId: string | null, drawn: string | null = 'a\nb') => ({ selectedId, drawn })

  it('fits the whole plan when the selection closes, whether or not the drawn nodes change', () => {
    expect(planFitStep(at('a'), at(null), false)).toBe(true) // decks off: the same nodes stay drawn
    expect(planFitStep(at('a', 'a\nb\nc'), at(null, 'a\nb'), false)).toBe(true) // decks on: branches fold back
  })

  it('fits when the drawn nodes change with nothing selected', () => {
    expect(planFitStep(at(null, 'a'), at(null, 'a\nb'), false)).toBe(true)
  })

  it('leaves the camera alone while the user drags', () => {
    expect(planFitStep(at('a'), at(null), true)).toBe(false)
    expect(planFitStep(at(null, 'a'), at(null, 'a\nb'), true)).toBe(false)
  })

  it('leaves a selection to its own frame, and does nothing when nothing changed or on the first layout', () => {
    expect(planFitStep(at(null), at('a'), false)).toBe(false)
    expect(planFitStep(at('a'), at('b', 'x'), false)).toBe(false)
    expect(planFitStep(at(null), at(null), false)).toBe(false)
    expect(planFitStep(at(null, null), at(null), false)).toBe(false)
  })
})

describe('planFitTracker', () => {
  const at = (selectedId: string | null, drawn: string | null = 'a\nb') => ({ selectedId, drawn })

  it('re-fits when a drag ends if the selection closed during it', () => {
    const t = planFitTracker(at(null, null))
    expect(t.see(at(null), false)).toBe(false) // first layout
    expect(t.see(at('a'), false)).toBe(false)
    expect(t.see(at(null), true)).toBe(false) // Escape mid-drag: the camera stays the user's for now
    expect(t.dragEnd()).toBe(true)
    expect(t.dragEnd()).toBe(false) // only once
  })

  it('re-fits when a drag ends if the drawn nodes changed during it', () => {
    const t = planFitTracker(at(null, 'a'))
    expect(t.see(at(null, 'a\nb'), true)).toBe(false)
    expect(t.dragEnd()).toBe(true)
  })

  it('does nothing at the end of a drag when nothing changed, or when a selection was made meanwhile', () => {
    const t = planFitTracker(at(null))
    expect(t.dragEnd()).toBe(false)
    expect(t.see(at('a'), false)).toBe(false)
    expect(t.see(at(null), true)).toBe(false)
    expect(t.see(at('b'), true)).toBe(false)
    expect(t.dragEnd()).toBe(false)
  })
})

describe('fitPlan with the legend', () => {
  it('keeps the legend strip clear only while the legend shows', () => {
    const moves: [{ x: number }, { x: number }, number][] = []
    const host = {
      nodes: () => [{ x: -1000, y: -100 }, { x: 1000, y: 100 }],
      fov: () => 60,
      view: () => ({ w: 1280, h: 720 }),
      move: (position: { x: number }, lookAt: { x: number }, ms: number) => moves.push([position, lookAt, ms]),
    }
    fitPlan(host, { right: 0 }, true)
    fitPlan(host, { right: 0 }, false)
    expect(moves[0][2]).toBe(FRAME.fitMs)
    // with the legend the box shifts right of its strip; without it the plan is centred
    expect(moves[0][1].x).toBeLessThan(moves[1][1].x)
    expect(moves[1][1].x).toBeCloseTo(0, 5)
  })
})

describe('userMoveTracker', () => {
  it('a press and release that moves nothing (a click, a right-click on an edge) is no user move', () => {
    const t = userMoveTracker()
    t.start()
    t.end()
    expect(t.moved()).toBe(false)
  })

  it('the camera changing while the user drags the pointer is a user move', () => {
    const t = userMoveTracker()
    t.down(100, 100)
    t.start()
    t.move(140, 120)
    t.change()
    t.end()
    expect(t.moved()).toBe(true)
  })

  it('a press during an automatic glide, released without dragging, is no user move though the camera changes meanwhile', () => {
    const t = userMoveTracker()
    t.change() // the glide is under way
    t.down(300, 200)
    t.start()
    t.move(301, 200) // a hand's tremor
    t.change()
    t.change()
    t.end()
    t.change()
    expect(t.moved()).toBe(false)
  })

  it('a real drag during an automatic glide, or after it, is a user move', () => {
    const during = userMoveTracker()
    during.change()
    during.down(300, 200)
    during.start()
    during.change() // the glide, before the pointer moves
    during.move(360, 200)
    during.change()
    during.end()
    expect(during.moved()).toBe(true)

    const after = userMoveTracker()
    after.change()
    after.down(300, 200)
    after.start()
    after.move(300, 260)
    after.change()
    after.end()
    expect(after.moved()).toBe(true)
  })

  it('a drag that changes the camera only after the pointer has gone back near where it was pressed still counts', () => {
    const t = userMoveTracker()
    t.down(100, 100)
    t.start()
    t.move(200, 100)
    t.move(101, 100)
    t.change()
    t.end()
    expect(t.moved()).toBe(true)
  })

  it('a pointer moved with no press, or before the next press, does not count toward it', () => {
    const t = userMoveTracker()
    t.move(500, 500)
    t.down(100, 100)
    t.start()
    t.change()
    t.end()
    expect(t.moved()).toBe(false)
    t.move(400, 400) // hovering after the release
    t.down(10, 10)
    t.start()
    t.change()
    t.end()
    expect(t.moved()).toBe(false)
  })
})

describe('flyTakesFrame', () => {
  it('a fly to the selected step not yet acted on takes the camera when it can fly: the chain frame is skipped', () => {
    expect(flyTakesFrame({ id: 'a', seq: 2 }, 1, 'a', true)).toBe(true)
  })

  it('a fly whose step is not drawn yet (nothing to fly to) leaves the camera to the chain frame', () => {
    expect(flyTakesFrame({ id: 'a', seq: 2 }, 1, 'a', false)).toBe(false)
  })

  it('no fly, a fly already acted on, or a fly to another step leaves the camera to the chain frame', () => {
    expect(flyTakesFrame(null, null, 'a', true)).toBe(false)
    expect(flyTakesFrame({ id: 'a', seq: 2 }, 2, 'a', true)).toBe(false)
    expect(flyTakesFrame({ id: 'b', seq: 2 }, 1, 'a', true)).toBe(false)
  })

  it('the camera changing with no gesture under way (an automatic frame gliding) is no user move', () => {
    const t = userMoveTracker()
    t.change()
    t.start()
    t.end()
    t.change() // the glide goes on after a click
    expect(t.moved()).toBe(false)
  })

  it('a wheel notch is a user move; clear forgets it', () => {
    const t = userMoveTracker()
    t.wheel()
    expect(t.moved()).toBe(true)
    t.clear()
    expect(t.moved()).toBe(false)
  })
})

describe('hidStep', () => {
  const set = (...ids: string[]) => new Set(ids)
  it('is true when a step in view before the resize is covered or off the window after it', () => {
    expect(hidStep(set('a', 'b'), set('a'))).toBe(true)
  })
  it('one step already off view, the resize hides two more: hid', () => {
    // d was off view before (so not in the set); b and c were in view and are not after
    expect(hidStep(set('a', 'b', 'c'), set('a'))).toBe(true)
  })
  it('one step already off view, the resize hides nothing new: not hid', () => {
    expect(hidStep(set('a', 'b', 'c'), set('a', 'b', 'c'))).toBe(false)
    // a step coming into view hides nothing
    expect(hidStep(set('a', 'b'), set('a', 'b', 'd'))).toBe(false)
  })
  it('nothing measured before (a new target) hides nothing', () => {
    expect(hidStep(null, set())).toBe(false)
  })
})

describe('shouldFrameResize', () => {
  it('re-frames for a new view size while the camera is where the last frame put it, whatever it hid', () => {
    for (const hid of [true, false]) expect(shouldFrameResize({ userMoved: false, hid }, false)).toBe(true)
  })
  it('after the user zoomed or panned, re-frames only when the resize hid a step that was in view', () => {
    expect(shouldFrameResize({ userMoved: true, hid: true }, false)).toBe(true)
    expect(shouldFrameResize({ userMoved: true, hid: false }, false)).toBe(false)
  })
  it('never while the user drags', () => {
    expect(shouldFrameResize({ userMoved: false, hid: true }, true)).toBe(false)
  })
})

describe('shouldFrameSelection with a new view size', () => {
  const was = { id: 'a', right: 416, bottom: 170, chain: 'b', at: '0,0', view: '1280x720' }
  it('re-frames the same selection for a new view size by the resize rule', () => {
    expect(shouldFrameSelection(was, { ...was, view: '800x740' }, false, { userMoved: false, covered: false })).toBe(true)
    expect(shouldFrameSelection(was, { ...was, view: '800x740' }, false, { userMoved: true, covered: true, hid: false })).toBe(false)
    expect(shouldFrameSelection(was, { ...was, view: '800x740' }, false, { userMoved: true, covered: true, hid: true })).toBe(true)
    expect(shouldFrameSelection(was, { ...was, view: '800x740' }, true, { userMoved: false, covered: true })).toBe(false)
  })
  it('a new view size and a new card height together are one decision: the resize rule', () => {
    expect(shouldFrameSelection(was, { ...was, view: '800x740', bottom: 260 }, false, { userMoved: false, covered: false })).toBe(true)
    expect(shouldFrameSelection(was, { ...was, view: '800x740', bottom: 260 }, false, { userMoved: true, covered: true, hid: false })).toBe(false)
  })
  it('the same view size is no change', () => {
    expect(shouldFrameSelection(was, { ...was }, false, { userMoved: false, covered: true })).toBe(false)
  })
  it('a new selection during a resize is framed whatever was measured for the old one', () => {
    expect(shouldFrameSelection(was, { ...was, id: 'z', view: '800x740' }, false, { userMoved: true, covered: false, hid: false })).toBe(true)
  })
})

describe('flyStep', () => {
  const fly = { id: 'b', seq: 3 }
  const at = (o: Partial<{ selectedId: string | null; resizing: boolean; viewEmpty: boolean }> = {}) => ({ selectedId: 'b', resizing: false, viewEmpty: false, ...o })
  it('flies a fly not yet acted on, to the selected step', () => {
    expect(flyStep(fly, 2, at())).toBe('fly')
    expect(flyStep(fly, null, at())).toBe('fly')
  })
  it('waits for a resize under way to settle, so the fly is aimed at the final size and owns the settle', () => {
    expect(flyStep(fly, 2, at({ resizing: true }))).toBe('wait')
  })
  it('waits while the view has no size, as the chain frame does, and flies once it has one', () => {
    expect(flyStep(fly, 2, at({ viewEmpty: true }))).toBe('wait')
    expect(flyStep(fly, 2, at({ viewEmpty: true, resizing: true }))).toBe('wait')
    expect(flyStep(fly, 2, at())).toBe('fly')
  })
  it('drops a fly whose step is no longer selected (Escape, another step picked while it waited), without moving', () => {
    expect(flyStep(fly, 2, at({ selectedId: null }))).toBe('drop')
    expect(flyStep(fly, 2, at({ selectedId: 'y' }))).toBe('drop')
    expect(flyStep(fly, 2, at({ selectedId: null, resizing: true }))).toBe('drop')
    expect(flyStep(fly, 2, at({ selectedId: 'y', viewEmpty: true }))).toBe('drop')
  })
  it('does nothing for no fly or one already flown, resize or not', () => {
    expect(flyStep(null, null, at())).toBe('none')
    expect(flyStep(fly, 3, at())).toBe('none')
    expect(flyStep(fly, 3, at({ resizing: true }))).toBe('none')
    expect(flyStep(fly, 3, at({ selectedId: null }))).toBe('none')
  })
  it('a fly waiting for the settle still owns the selection\'s frame then (not yet flown)', () => {
    expect(flyTakesFrame(fly, 2, 'b', true)).toBe(true)
  })
  it('a fly whose step is no longer selected leaves the new selection to its own frame', () => {
    expect(flyTakesFrame(fly, 2, 'y', true)).toBe(false)
  })
})

describe('sizeSettler', () => {
  afterEach(() => {
    vi.useRealTimers()
  })
  const make = () => {
    const calls: string[] = []
    const s = sizeSettler({ w: 1280, h: 720 }, { start: () => calls.push('start'), settle: v => calls.push(`settle ${v.w}x${v.h}`) })
    return { s, calls }
  }
  it('settles a burst of sizes once, at the last size, RESIZE_SETTLE_MS after the last change', () => {
    vi.useFakeTimers()
    const { s, calls } = make()
    s.see({ w: 1200, h: 720 })
    vi.advanceTimersByTime(RESIZE_SETTLE_MS - 10)
    s.see({ w: 1000, h: 730 })
    vi.advanceTimersByTime(RESIZE_SETTLE_MS - 10)
    s.see({ w: 800, h: 740 })
    expect(s.pending()).toBe(true)
    vi.advanceTimersByTime(RESIZE_SETTLE_MS - 1)
    expect(calls).toEqual(['start'])
    vi.advanceTimersByTime(1)
    expect(calls).toEqual(['start', 'settle 800x740'])
    expect(s.pending()).toBe(false)
  })
  it('calls start once per burst, before the first new size, and ignores a size that is no change', () => {
    vi.useFakeTimers()
    const { s, calls } = make()
    s.see({ w: 1280, h: 720 })
    vi.advanceTimersByTime(RESIZE_SETTLE_MS * 2)
    expect(calls).toEqual([])
    s.see({ w: 900, h: 720 })
    s.see({ w: 901, h: 720 })
    vi.advanceTimersByTime(RESIZE_SETTLE_MS)
    s.see({ w: 1500, h: 900 })
    vi.advanceTimersByTime(RESIZE_SETTLE_MS)
    expect(calls).toEqual(['start', 'settle 901x720', 'start', 'settle 1500x900'])
  })
  it('a burst that ends where it began still settles (what waited for it runs), at the same size', () => {
    vi.useFakeTimers()
    const { s, calls } = make()
    s.see({ w: 900, h: 720 })
    s.see({ w: 1280, h: 720 })
    vi.advanceTimersByTime(RESIZE_SETTLE_MS)
    expect(calls).toEqual(['start', 'settle 1280x720'])
    expect(s.pending()).toBe(false)
  })
  it('cancel drops a pending burst', () => {
    vi.useFakeTimers()
    const { s, calls } = make()
    s.see({ w: 900, h: 720 })
    s.cancel()
    vi.advanceTimersByTime(RESIZE_SETTLE_MS * 2)
    expect(calls).toEqual(['start'])
  })
})

describe('the host left strip under the legend width', () => {
  it('keeps its column clear as the left strip, with or without the legend', () => {
    expect(frameInsets({ w: 600, h: 740 }, { right: 0, bottom: 170, left: 296 }, true).left).toBe(296)
    expect(frameInsets({ w: 600, h: 740 }, { right: 0, bottom: 170, left: 296 }, false).left).toBe(296)
    expect(frameInsets({ w: 600, h: 740 }, { right: 0, bottom: 170 }, true).left).toBe(0)
    expect(frameInsets({ w: 300, h: 740 }, { right: 0, bottom: 170, left: 292 }, false).left).toBe(16 + 268 + 8)
  })
  it('leaves the legend rule alone on a wide view', () => {
    expect(frameInsets({ w: 1000, h: 740 }, { right: 0, bottom: 170 }, true).left).toBe(FRAME.leftInset)
    expect(frameInsets({ w: 1000, h: 740 }, { right: 0, bottom: 170 }, false).left).toBe(0)
  })
  it('re-frames a selection when it opens over it and only if that leaves the chain covered', () => {
    const last = { id: 'a', right: 0, left: 0, bottom: 170, chain: 'x' }
    const now = { ...last, left: 296 }
    expect(shouldFrameSelection(last, now, false, { userMoved: false, covered: true })).toBe(true)
    expect(shouldFrameSelection(last, now, false, { userMoved: false, covered: false })).toBe(false)
    expect(shouldFrameSelection(now, last, false, { userMoved: false, covered: true })).toBe(false) // closing never moves it
  })
})

describe('selectionPoints: a selection is framed with its neighbours, not its whole path', () => {
  const card = { w: 100, h: 40 }
  // a column t0 (goal) .. t5, laid out one row apart; nothing folded
  const col = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`t${i}`, { x: 0, y: i * 100 }]))
  const plain = (at: Record<string, { x: number; y: number }>, status: Record<string, string> = {}, decks: Record<string, { parentId: string; members: { status: string }[]; done?: true }> = {}, hidden: Record<string, string> = {}) => ({
    at: (id: string) => at[id],
    drawnId: (id: string) => hidden[id] ?? id,
    deck: (id: string) => decks[id],
    status: (id: string) => status[id] ?? 'todo',
  })
  const ys = (pts: { y: number }[]) => [...new Set(pts.map(p => p.y))].sort((a, b) => a - b)

  it('takes the card corners of the step, the steps it needs and the steps that need it, and nothing farther', () => {
    const pts = selectionPoints('t3', { upstream: ['t4'], downstream: ['t2'] }, plain(col), card)
    // rows 2, 3 and 4 only (y flipped, each card 40 tall): t0, t1 and t5 are not in the box
    expect(ys(pts)).toEqual([-420, -380, -320, -280, -220, -180])
    expect(pts.every(p => !p.done && !p.spare)).toBe(true)
  })

  it('marks a finished neighbour done, so it is left out of the box', () => {
    const pts = selectionPoints('t3', { upstream: ['t4'], downstream: ['t2'] }, plain(col, { t4: 'done' }), card)
    expect(pts.filter(p => p.done).map(p => p.y).sort((a, b) => a - b)).toEqual([-420, -380])
  })

  it("tries the selection's own done deck first, even when no neighbour stands at it", () => {
    const at = { ...col, 'deck:t3': { x: 200, y: 400 } }
    const decks = { 'deck:t3': { parentId: 't3', members: [{ status: 'done' }, { status: 'done' }], done: true as const } }
    const pts = selectionPoints('t3', { upstream: [], downstream: ['t2'] }, plain(at, {}, decks), card)
    const own = pts.filter(p => p.own)
    expect(own).toHaveLength(2)
    expect(own.every(p => p.spare && !p.done)).toBe(true)
  })

  it("a need folded into another step's done deck stands at that deck, as a spare point that is not the selection's own", () => {
    const at = { ...col, 'deck:t2': { x: 200, y: 300 } }
    const decks = { 'deck:t2': { parentId: 't2', members: [{ status: 'done' }], done: true as const } }
    const pts = selectionPoints('t3', { upstream: ['t4'], downstream: ['t2'] }, plain(at, { t4: 'done' }, decks, { t4: 'deck:t2' }), card)
    const spare = pts.filter(p => p.spare)
    expect(spare).toHaveLength(2)
    expect(spare.every(p => !p.own && (p.x === 150 || p.x === 250))).toBe(true)
  })

  it('counts each drawn card once, however many neighbours stand at it, and skips a step not drawn', () => {
    const at = { t3: { x: 0, y: 300 }, 'deck:t3': { x: 0, y: 400 } }
    const decks = { 'deck:t3': { parentId: 't3', members: [{ status: 'done' }, { status: 'done' }], done: true as const } }
    const pts = selectionPoints('t3', { upstream: ['a', 'b'], downstream: ['gone'] }, plain(at, { a: 'done', b: 'done' }, decks, { a: 'deck:t3', b: 'deck:t3' }), card)
    expect(pts).toHaveLength(4)
  })
})

describe('the whole-plan frame counts the cards as drawn past the card floor', () => {
  const fov = 50
  const { cardW, cardH } = LAYOUT
  // A frame's screen mapping: px per unit and where a plane point lands.
  const screen = (f: Frame, view: { w: number; h: number }) => {
    const ppu = pxPerUnit(f.position.z, fov, view.h)
    return { ppu, x: (x: number) => view.w / 2 + (x - f.lookAt.x) * ppu, y: (y: number) => view.h / 2 - (y - f.lookAt.y) * ppu }
  }
  // The slot box of a plan `slots` cards wide and `rows` rows tall, as Graph hands it over: card edges, y up.
  const box = (slots: number, rows: number) => [
    { x: (-slots * (cardW + 36)) / 2, y: cardH / 2 },
    { x: (slots * (cardW + 36)) / 2, y: -(rows * 122 - cardH / 2) },
  ]

  // Where the edge cards draw on screen in a frame: the leftmost card's left edge, the rightmost title's right end (its
  // text block at full width, boosted), the top card's top and the bottom card's bottom, in px from the view's left/top.
  const drawn = (f: Frame, view: { w: number; h: number }, plan: { x: number; y: number }[]) => {
    const s = screen(f, view)
    const k = labelScale(s.ppu)
    const [lo, hi] = plan
    return {
      ppu: s.ppu,
      left: s.x(lo.x + cardW / 2) - (cardW / 2) * k,
      right: s.x(hi.x - cardW / 2) + (LABEL_TEXT.left + LABEL_TEXT.width * titleBoost(k) - cardW / 2) * k,
      top: s.y(lo.y - cardH / 2) - (cardH / 2) * k,
      bottom: s.y(hi.y + cardH / 2) + (cardH / 2) * k,
    }
  }
  const slotsFrame = (plan: { x: number; y: number }[], view: { w: number; h: number }) => frameFor(plan, view, fov, { pad: FRAME.fitPad, maxZ: Infinity, ...frameInsets(view) })
  const M = FRAME.edgeMargin

  for (const view of [{ w: 800, h: 740 }, { w: 1280, h: 720 }]) {
    it(`keeps the edge cards and their titles, as drawn, at least ${FRAME.edgeMargin} px inside the free area at ${view.w}x${view.h}, and backs off no farther`, () => {
      for (const [slots, rows] of [[16, 3], [32, 4], [60, 2], [4, 40]]) {
        const plan = box(slots, rows)
        const d = drawn(planFrame(plan, view, fov), view, plan)
        expect(d.ppu, 'the premise: past the card floor').toBeLessThan(LABEL_SCALE.min)
        const insets = frameInsets(view)
        const room = [d.left - insets.left, view.w - insets.right - d.right, d.top - insets.top, view.h - insets.bottom - d.bottom]
        for (const r of room) expect(r).toBeGreaterThanOrEqual(M - 1e-6)
        // the frame is the slots' own unless that leaves an edge less than M inside; then the binding side is M inside
        const slots0 = slotsFrame(plan, view)
        if (planFrame(plan, view, fov).position.z !== slots0.position.z) expect(Math.min(...room)).toBeLessThan(M + 0.5)
      }
    })
  }

  // The e2e fixture (e2e/frameFloor.spec.ts): a goal over five rooms, each with nine needs that need nothing.
  const rooms = ['a', 'b', 'c', 'd', 'e']
  const fixture = layoutPlan([
    { id: 'goal', depends_on: rooms },
    ...rooms.map(a => ({ id: a, depends_on: Array.from({ length: 9 }, (_, i) => `${a}${i + 1}`) })),
    ...rooms.flatMap(a => Array.from({ length: 9 }, (_, i) => ({ id: `${a}${i + 1}`, depends_on: [] }))),
  ])
  const fixtureBox = [{ x: -fixture.width / 2, y: cardH / 2 }, { x: fixture.width / 2, y: -(fixture.height - cardH / 2) }]

  it('frames the e2e fixture at 1280x720 exactly as the slots alone do: its titles already end well inside the window', () => {
    const view = { w: 1280, h: 720 }
    const f = planFrame(fixtureBox, view, fov)
    expect(screen(f, view).ppu).toBeLessThan(LABEL_SCALE.min)
    expect(f).toEqual(slotsFrame(fixtureBox, view))
  })

  it('at 800x740 backs off until the right edge title ends M inside the window; the left cards, drawn past their slots within the pad, add nothing', () => {
    const view = { w: 800, h: 740 }
    const f = planFrame(fixtureBox, view, fov)
    const d = drawn(f, view, fixtureBox)
    expect(f.position.z).toBeGreaterThan(slotsFrame(fixtureBox, view).position.z)
    expect(d.right).toBeCloseTo(view.w - M, 3)
    // the left card draws past its slot, into the pad, and the frame is not widened for it: it sits less than a pad in
    expect(d.left).toBeGreaterThan(M)
    expect(d.left).toBeLessThan(FRAME.fitPad * view.w)
  })

  it('leaves a plan framed where the titles are drawn at their own size as the slots alone frame it', () => {
    const view = { w: 1280, h: 720 }
    const plan = box(3, 2)
    const f = planFrame(plan, view, fov)
    expect(screen(f, view).ppu).toBeGreaterThan(0.75)
    expect(f).toEqual(frameFor(plan, view, fov, { pad: FRAME.fitPad, maxZ: Infinity, ...frameInsets(view) }))
  })

  it("a selection's farthest frame stays the slots' fit", () => {
    const view = { w: 800, h: 740 }
    const plan = box(32, 4)
    const slots = frameFor(plan, view, fov, { pad: FRAME.fitPad, maxZ: Infinity, ...frameInsets(view, { right: 416 }, false) })
    expect(CHAIN_FRAME.maxZ(plan, view, fov, { right: 416 }, false)).toBeCloseTo(slots.position.z, 9)
    expect(planFrame(plan, view, fov, { right: 416 }, false).position.z).toBeGreaterThan(slots.position.z)
  })
})

describe('the whole-plan frame counts the steps drawn larger for a soon due date', () => {
  const fov = 50
  const { cardW, cardH, colGap } = LAYOUT
  const M = FRAME.edgeMargin
  const s = NEAR.near
  // The e2e fixture (e2e/frameDue.spec.ts): a goal over five rooms of nine needs each; the steps in `due` are due soon,
  // so they draw `s` times their size and the layout keeps room for that on their right (layoutInput).
  const rooms = ['a', 'b', 'c', 'd', 'e']
  const fixture = (due: Set<string>) => {
    const tail = slotTail(s, cardW, colGap)
    const layout = layoutPlan([
      { id: 'goal', depends_on: rooms },
      ...rooms.map(a => ({ id: a, depends_on: Array.from({ length: 9 }, (_, i) => `${a}${i + 1}`) })),
      ...rooms.flatMap(a => Array.from({ length: 9 }, (_, i) => ({ id: `${a}${i + 1}`, depends_on: [], tail: due.has(`${a}${i + 1}`) ? tail : undefined }))),
    ])
    // As Graph hands it over: the slot box's corners (y up), and the centre of each step drawn larger, with its scale.
    const pts = planPoints(layout, id => (due.has(id) ? s : 1))
    expect(pts.filter(p => !p.bend)).toEqual([
      { x: -layout.width / 2, y: cardH / 2 },
      { x: layout.width / 2, y: -(layout.height - cardH / 2) },
      ...[...layout.nodes.keys()].filter(id => due.has(id)).map(id => ({ x: layout.nodes.get(id)!.x, y: -layout.nodes.get(id)!.y, scale: s })),
    ])
    return { layout, pts }
  }
  // Where a step's title, drawn `scale` times its size, ends on screen: its circle stays where an undated one's would be
  // (viewer.css, .node-card's left), and its text block (boosted) runs right of it at the card's drawn size.
  const titleRight = (f: Frame, view: { w: number; h: number }, cx: number, scale: number) => {
    const ppu = pxPerUnit(f.position.z, fov, view.h)
    const k = labelScale(ppu)
    const dot = view.w / 2 + (cx - f.lookAt.x) * ppu - (cardW / 2 - DOT.cx) * k
    return dot + (LABEL_TEXT.left - DOT.cx + LABEL_TEXT.width * titleBoost(k)) * k * scale
  }
  // room C's right column is the plan's right edge
  const edge = ['c3', 'c6', 'c9']

  for (const view of [{ w: 800, h: 740 }, { w: 1280, h: 720 }]) {
    it(`keeps the titles of steps due soon at the plan's right edge ${M} px inside the window at ${view.w}x${view.h}`, () => {
      const { layout, pts } = fixture(new Set(edge))
      const f = planFrame(pts, view, fov)
      expect(pxPerUnit(f.position.z, fov, view.h), 'the premise: past the card floor').toBeLessThan(LABEL_SCALE.min)
      const ends = edge.map(id => titleRight(f, view, layout.nodes.get(id)!.x, s))
      // the binding title ends M inside the window: no farther in, so the frame backs off no more than it takes
      expect(Math.max(...ends)).toBeCloseTo(view.w - M, 3)
    })
  }

  it('frames a plan whose steps due soon are not at its edges as if they were undated, its arrows within the pad', () => {
    for (const view of [{ w: 800, h: 740 }, { w: 1280, h: 720 }]) {
      const { pts } = fixture(new Set(['c5']))
      // the premise: its block lanes reach past the cards, so the bend points are there to leave out
      expect(pts.some(p => p.bend)).toBe(true)
      // the slot box's corners alone: no step drawn larger, no arrow bend
      const corners = pts.filter(p => !p.bend && p.scale === undefined).map(p => ({ x: p.x, y: p.y }))
      expect(corners).toHaveLength(2)
      expect(planFrame(pts, view, fov)).toEqual(planFrame(corners, view, fov))
    }
  })

  it(`keeps a step due soon in the top row and one in the bottom row, as drawn, ${M} px inside the free area on a short window`, () => {
    // 1280x400: the pad less the margin is 8 px, less than what the goal and d7 draw past their slots up and down when
    // due soon, but more than what an undated card does, so the frame backs off only for the dates.
    const view = { w: 1280, h: 400 }
    const { layout, pts } = fixture(new Set(['goal', 'd7']))
    const f = planFrame(pts, view, fov)
    const ppu = pxPerUnit(f.position.z, fov, view.h)
    const k = labelScale(ppu)
    expect(ppu, 'the premise: past the card floor').toBeLessThan(LABEL_SCALE.min)
    const y = (id: string) => view.h / 2 + (layout.nodes.get(id)!.y + f.lookAt.y) * ppu
    const insets = frameInsets(view)
    const top = y('goal') - (cardH / 2) * k * s - insets.top
    const bottom = view.h - insets.bottom - (y('d7') + (cardH / 2) * k * s)
    expect(top).toBeGreaterThanOrEqual(M - 1e-6)
    expect(bottom).toBeGreaterThanOrEqual(M - 1e-6)
    // the binding side is M inside: the frame backs off no farther than the dates take
    expect(Math.min(top, bottom)).toBeCloseTo(M, 3)
  })
})

describe('the whole-plan frame counts each title by its longest drawn line', () => {
  const fov = 50
  const { cardW, colGap } = LAYOUT
  const M = FRAME.edgeMargin
  const s = NEAR.near
  const views = [{ w: 800, h: 740 }, { w: 1280, h: 720 }]
  // The frameDue fixture (e2e/frameDue.spec.ts): five rooms of nine needs; the steps in `due` are due soon.
  const rooms = ['a', 'b', 'c', 'd', 'e']
  const fixture = (due: Set<string>) =>
    layoutPlan([
      { id: 'goal', depends_on: rooms },
      ...rooms.map(a => ({ id: a, depends_on: Array.from({ length: 9 }, (_, i) => `${a}${i + 1}`) })),
      ...rooms.flatMap(a =>
        Array.from({ length: 9 }, (_, i) => ({ id: `${a}${i + 1}`, depends_on: [], tail: due.has(`${a}${i + 1}`) ? slotTail(s, cardW, colGap) : undefined })),
      ),
    ])
  const edge = ['c3', 'c6', 'c9']
  // Where a title ends on screen, its longest drawn line `line` card px (at boost 1) from where its text block starts; a
  // deck's words keep their card's size (no boost).
  const lineRight = (f: Frame, view: { w: number; h: number }, cx: number, scale: number, line: number, deck = false) => {
    const ppu = pxPerUnit(f.position.z, fov, view.h)
    const k = labelScale(ppu)
    const dot = view.w / 2 + (cx - f.lookAt.x) * ppu - (cardW / 2 - DOT.cx) * k
    return dot + (LABEL_TEXT.left - DOT.cx + Math.min(LABEL_TEXT.width, line) * (deck ? 1 : titleBoost(k))) * k * scale
  }
  const ppuOf = (f: Frame, view: { w: number; h: number }) => pxPerUnit(f.position.z, fov, view.h)

  for (const view of views) {
    it(`frames tighter when the dated edge titles' longest lines end short of their boxes, the binding one ${M} px inside, at ${view.w}x${view.h}`, () => {
      const layout = fixture(new Set(edge))
      const scaleOf = (id: string) => (edge.includes(id) ? s : 1)
      const line = 120
      const boxed = planFrame(planPoints(layout, scaleOf), view, fov)
      const f = planFrame(planPoints(layout, scaleOf, () => ({ line })), view, fov)
      expect(ppuOf(f, view), 'the premise: past the card floor').toBeLessThan(LABEL_SCALE.min)
      expect(ppuOf(f, view)).toBeGreaterThan(ppuOf(boxed, view))
      const ends = edge.map(id => lineRight(f, view, layout.nodes.get(id)!.x, s, line))
      expect(Math.max(...ends)).toBeCloseTo(view.w - M, 3)
    })
  }

  it('frames an undated plan tighter at 800x740 when its edge titles end short, never cutting the longest drawn line', () => {
    const view = { w: 800, h: 740 }
    const layout = fixture(new Set())
    const boxed = planFrame(planPoints(layout, () => 1), view, fov)
    const lines = new Map([...layout.nodes.keys()].map(id => [id, 100 + (id.charCodeAt(id.length - 1) % 7) * 6]))
    const f = planFrame(planPoints(layout, () => 1, id => ({ line: lines.get(id) })), view, fov)
    expect(ppuOf(f, view)).toBeGreaterThan(ppuOf(boxed, view))
    // every title, an inner column's too (past the floor its words reach past the edge card's slot), ends M inside
    const ends = [...layout.nodes.values()].map(n => lineRight(f, view, n.x, 1, lines.get(n.id)!))
    expect(Math.max(...ends)).toBeLessThanOrEqual(view.w - M + 1e-6)
    expect(Math.max(...ends)).toBeGreaterThan(view.w - M - 1)
  })

  it('falls back to the full text box for a title not measured, and never counts more than the box', () => {
    for (const view of views)
      for (const due of [new Set<string>(), new Set(edge)]) {
        const layout = fixture(due)
        const scaleOf = (id: string) => (due.has(id) ? s : 1)
        const boxed = planFrame(planPoints(layout, scaleOf), view, fov)
        expect(planFrame(planPoints(layout, scaleOf, () => undefined), view, fov)).toEqual(boxed)
        expect(planFrame(planPoints(layout, scaleOf, () => ({})), view, fov)).toEqual(boxed)
        expect(planFrame(planPoints(layout, scaleOf, () => ({ line: 400 })), view, fov)).toEqual(boxed)
      }
  })

  it('an edge title measured short beside one not measured still frames as the box: the unmeasured one counts in full', () => {
    const view = { w: 800, h: 740 }
    const layout = fixture(new Set(edge))
    const scaleOf = (id: string) => (edge.includes(id) ? s : 1)
    const boxed = planFrame(planPoints(layout, scaleOf), view, fov)
    expect(planFrame(planPoints(layout, scaleOf, id => (id === 'c9' ? undefined : { line: 60 })), view, fov)).toEqual(boxed)
  })

  it('counts a deck drawn larger for a date with its words at their card size, not boosted', () => {
    const view = { w: 800, h: 740 }
    const layout = fixture(new Set(edge))
    const scaleOf = (id: string) => (edge.includes(id) ? s : 1)
    const asStep = planFrame(planPoints(layout, scaleOf, () => undefined), view, fov)
    const asDeck = planFrame(planPoints(layout, scaleOf, id => (edge.includes(id) ? { deck: true } : { line: 60 })), view, fov)
    expect(ppuOf(asStep, view), 'the premise: past the card floor, where steps are boosted').toBeLessThan(LABEL_SCALE.min)
    expect(ppuOf(asDeck, view)).toBeGreaterThan(ppuOf(asStep, view))
    const ends = edge.map(id => lineRight(asDeck, view, layout.nodes.get(id)!.x, s, LABEL_TEXT.width, true))
    expect(Math.max(...ends)).toBeLessThanOrEqual(view.w - M + 1e-6)
  })

  it('planPoints hands over every step with its measure only when asked, the dated ones with their scale', () => {
    const layout = fixture(new Set(['c3']))
    const pts = planPoints(layout, id => (id === 'c3' ? s : 1), id => (id === 'c3' ? { line: 90, deck: true } : undefined))
    const titled = pts.filter(p => p.title)
    expect(titled).toHaveLength(layout.nodes.size)
    const c3 = layout.nodes.get('c3')!
    expect(titled.find(p => p.x === c3.x && p.y === -c3.y)).toEqual({ x: c3.x, y: -c3.y, scale: s, line: 90, deck: true, title: true })
    expect(planPoints(layout, () => 1).some(p => p.title)).toBe(false)
  })
})

describe('the whole-plan frame keeps every arrow bend inside the window', () => {
  const fov = 50
  const { cardW, cardH } = LAYOUT
  const M = FRAME.edgeMargin
  const views = [{ w: 800, h: 740 }, { w: 1280, h: 720 }]
  const steps = (deps: Record<string, string>) => Object.entries(deps).map(([id, d]) => ({ id, depends_on: d ? d.split(',') : [] }))
  // Two dozen steps whose long arrows' lanes run past the cards on both sides, farther than the pad, at 800x740 and at
  // 1280x720. e2e/frameBends.spec.ts draws the same steps; the app may leave out a line that crosses into another step's
  // branch (see deckView), so it lays out a little differently, its lanes still past the cards.
  const bendDeps: Record<string, string> = {
    s0: 's1,s15', s1: 's17,s19,s20,s23', s2: 's5,s11', s3: '', s4: 's6,s8', s5: 's9,s12,s18', s6: 's10,s12,s14', s7: 's12,s16,s21,s23',
    s8: 's15,s16', s9: '', s10: 's22', s11: 's16,s17,s23', s12: 's13,s15,s19', s13: '', s14: 's16', s15: 's17', s16: '', s17: '',
    s18: 's21', s19: 's22', s20: 's22', s21: '', s22: '', s23: '',
  }
  const bends = layoutPlan(steps(bendDeps))
  // Every point an arrow passes through between its ends, in the plane (y up): the lanes it runs down and where it bends.
  const bendPts = (l: Layout) => l.edges.flatMap(e => e.points.slice(1, -1).map(q => ({ x: q.x, y: -q.y })))
  const corners = (l: Layout) => [{ x: -l.width / 2, y: cardH / 2 }, { x: l.width / 2, y: -(l.height - cardH / 2) }]
  const onScreen = (f: Frame, view: { w: number; h: number }) => {
    const ppu = pxPerUnit(f.position.z, fov, view.h)
    return { ppu, k: labelScale(ppu), x: (x: number) => view.w / 2 + (x - f.lookAt.x) * ppu, y: (y: number) => view.h / 2 - (y - f.lookAt.y) * ppu }
  }

  for (const view of views) {
    it(`keeps every arrow bend at least ${M} px inside the free area at ${view.w}x${view.h}, the binding one ${M} px in`, () => {
      const xs = bendPts(bends).map(p => p.x)
      // the premise: the lanes run past the slot box on both sides
      expect(Math.min(...xs)).toBeLessThan(-bends.width / 2)
      expect(Math.max(...xs)).toBeGreaterThan(bends.width / 2)
      const s = onScreen(planFrame(planPoints(bends, () => 1), view, fov), view)
      const insets = frameInsets(view)
      const left = Math.min(...xs.map(s.x)) - insets.left
      const right = view.w - insets.right - Math.max(...xs.map(s.x))
      expect(left).toBeGreaterThanOrEqual(M - 1e-6)
      expect(right).toBeGreaterThanOrEqual(M - 1e-6)
      // no farther out than the bends take
      expect(Math.min(left, right)).toBeCloseTo(M, 3)
    })

    it(`still keeps every card and title of that plan at least ${M} px inside the free area at ${view.w}x${view.h}`, () => {
      const s = onScreen(planFrame(planPoints(bends, () => 1), view, fov), view)
      const insets = frameInsets(view)
      for (const n of bends.nodes.values()) {
        const cx = s.x(n.x), cy = s.y(-n.y)
        expect(cx - (cardW / 2) * s.k - insets.left, `${n.id} left`).toBeGreaterThanOrEqual(M - 1e-6)
        expect(view.w - insets.right - (cx + (LABEL_TEXT.left + LABEL_TEXT.width * titleBoost(s.k) - cardW / 2) * s.k), `${n.id} title`).toBeGreaterThanOrEqual(M - 1e-6)
        expect(cy - (cardH / 2) * s.k - insets.top, `${n.id} top`).toBeGreaterThanOrEqual(M - 1e-6)
        expect(view.h - insets.bottom - (cy + (cardH / 2) * s.k), `${n.id} bottom`).toBeGreaterThanOrEqual(M - 1e-6)
      }
    })
  }

  it('hands over no bend points for a plan whose arrows only join adjacent rows', () => {
    const short = layoutPlan(steps({ g: 'a,b', a: '', b: '' }))
    const pts = planPoints(short, () => 1)
    expect(pts.filter(p => p.bend)).toEqual([])
    expect(pts).toEqual(corners(short))
  })

  it('hands over the corners of the box every long arrow runs in', () => {
    const pts = planPoints(bends, () => 1).filter(p => p.bend)
    const all = bendPts(bends)
    expect(pts).toEqual([
      { x: Math.min(...all.map(p => p.x)), y: Math.max(...all.map(p => p.y)), bend: true },
      { x: Math.max(...all.map(p => p.x)), y: Math.min(...all.map(p => p.y)), bend: true },
    ])
  })

  it('frames a plan whose arrows bend inside its slot box exactly as before', () => {
    const inside = layoutPlan(steps({ g: 'a,b,c,x', a: 'a1', a1: 'a2', a2: '', b: 'b1', b1: 'b2', b2: '', c: 'c1', c1: 'c2', c2: '', h: 'h1', h1: 'h2', h2: 'x', x: '' }))
    const xs = bendPts(inside).map(p => p.x)
    expect(xs.length, 'the premise: it has a long arrow').toBeGreaterThan(0)
    expect(Math.min(...xs)).toBeGreaterThan(-inside.width / 2)
    expect(Math.max(...xs)).toBeLessThan(inside.width / 2)
    for (const view of views) expect(planFrame(planPoints(inside, () => 1), view, fov)).toEqual(planFrame(corners(inside), view, fov))
  })

  it('frames the frame-floor plan as before: its block lanes reach past the cards by less than the pad holds', () => {
    const rooms = ['a', 'b', 'c', 'd', 'e']
    const floor = layoutPlan([
      { id: 'goal', depends_on: rooms },
      ...rooms.map(a => ({ id: a, depends_on: Array.from({ length: 9 }, (_, i) => `${a}${i + 1}`) })),
      ...rooms.flatMap(a => Array.from({ length: 9 }, (_, i) => ({ id: `${a}${i + 1}`, depends_on: [] }))),
    ])
    expect(Math.min(...bendPts(floor).map(p => p.x)), 'the premise: a lane left of the cards').toBeLessThan(-floor.width / 2)
    for (const view of views) expect(planFrame(planPoints(floor, () => 1), view, fov)).toEqual(planFrame(corners(floor), view, fov))
  })

  it("a selection's farthest frame counts the plan's lanes, never past the whole plan's own fit", () => {
    for (const view of views) {
      const pts = planPoints(bends, () => 1)
      // farther than the cards alone take: this plan's lanes run past them, farther than the pad less the margin
      expect(CHAIN_FRAME.maxZ(pts, view, fov)).toBeGreaterThan(CHAIN_FRAME.maxZ(corners(bends), view, fov))
      expect(CHAIN_FRAME.maxZ(pts, view, fov)).toBeLessThanOrEqual(planFrame(pts, view, fov).position.z + 1e-6)
      expect(CHAIN_FRAME.maxZ(pts, view, fov, { right: 416 }, false)).toBeLessThanOrEqual(planFrame(pts, view, fov, { right: 416 }, false).position.z + 1e-6)
    }
    // lanes that poke past the cards by less than the pad less the margin leave it the cards' fit
    const inside = layoutPlan(steps({ g: 'a,b,c,x', a: 'a1', a1: 'a2', a2: '', b: 'b1', b1: 'b2', b2: '', c: 'c1', c1: 'c2', c2: '', h: 'h1', h1: 'h2', h2: 'x', x: '' }))
    for (const view of views) expect(CHAIN_FRAME.maxZ(planPoints(inside, () => 1), view, fov)).toBe(CHAIN_FRAME.maxZ(corners(inside), view, fov))
  })

  describe("a selection's frame keeps its own arrows' lanes inside the window", () => {
    // The steps a selection is framed with: the step, the steps it needs and the steps that need it (neighboursOf).
    const nearOf = (deps: Record<string, string>, id: string) => ({
      upstream: deps[id] ? deps[id].split(',') : [],
      downstream: Object.keys(deps).filter(k => (deps[k] ? deps[k].split(',') : []).includes(id)),
    })
    const drawn = (l: Layout, status: Record<string, string> = {}) => ({
      at: (id: string) => l.nodes.get(id),
      drawnId: (id: string) => id,
      deck: () => undefined,
      status: (id: string) => status[id] ?? 'todo',
    })
    const card = { w: cardW, h: cardH }
    // Framed as the app frames a selection with no side panel beside the graph (under 1100 px it lies over the graph)
    // and the legend shown.
    const frameOf = (l: Layout, id: string, view: { w: number; h: number }, pts: ReturnType<typeof selectionPoints>) => {
      const n = l.nodes.get(id)!
      return chainFrame({ x: n.x, y: -n.y }, pts, view, fov, {
        pad: CHAIN_FRAME.pad,
        minZ: CHAIN_FRAME.minZ(view, fov),
        maxZ: CHAIN_FRAME.maxZ(planPoints(l, () => 1), view, fov),
        ...frameInsets(view),
      })
    }
    // Every point the selection's own arrows (to and from its neighbours) pass through between their ends.
    const ownLanes = (l: Layout, id: string, near: { upstream: string[]; downstream: string[] }) => {
      const others = new Set([...near.upstream, ...near.downstream])
      return l.edges
        .filter(e => (e.source === id && others.has(e.target)) || (e.target === id && others.has(e.source)))
        .flatMap(e => e.points.slice(1, -1).map(q => ({ x: q.x, y: -q.y })))
    }
    // The least px any of `pts` is inside the free area (negative: past its edge).
    const gap = (f: Frame, view: { w: number; h: number }, pts: { x: number; y: number }[]) => {
      const s = onScreen(f, view)
      const free = frameInsets(view)
      return Math.min(...pts.flatMap(p => [s.x(p.x) - free.left, view.w - free.right - s.x(p.x), s.y(p.y) - free.top, view.h - free.bottom - s.y(p.y)]))
    }

    for (const view of views)
      it(`frames s21 at ${view.w}x${view.h} with its long arrow to s7 at least ${M} px inside the free area, its cards still padded`, () => {
        const near = nearOf(bendDeps, 's21')
        const lanes = ownLanes(bends, 's21', near)
        const cards = selectionPoints('s21', near, drawn(bends), card)
        // the premise: framed by its cards alone, its own long arrow runs past the free area
        expect(lanes.length).toBeGreaterThan(0)
        expect(gap(frameOf(bends, 's21', view, cards), view, lanes)).toBeLessThan(0)
        const f = frameOf(bends, 's21', view, selectionPoints('s21', near, drawn(bends), card, bends))
        expect(gap(f, view, lanes)).toBeGreaterThanOrEqual(M - 1e-6)
        expect(gap(f, view, cards)).toBeGreaterThanOrEqual(Math.min(FRAME.fitPad * view.w, FRAME.fitPad * view.h) - 1e-6)
      })

    it("hands over the corners of its own long arrows' lanes only, none for a finished neighbour's", () => {
      const near = nearOf(bendDeps, 's21')
      const lanes = ownLanes(bends, 's21', near)
      const pts = selectionPoints('s21', near, drawn(bends), card, bends).filter(p => p.bend)
      expect(pts).toEqual([
        { x: Math.min(...lanes.map(p => p.x)), y: Math.max(...lanes.map(p => p.y)), bend: true },
        { x: Math.max(...lanes.map(p => p.x)), y: Math.min(...lanes.map(p => p.y)), bend: true },
      ])
      // the plan's other long arrows span a larger box: they are not the selection's
      expect(planPoints(bends, () => 1).filter(p => p.bend)).not.toEqual(pts)
      // with its neighbours finished (left out of the frame), their arrows are left out too
      const done = Object.fromEntries([...near.upstream, ...near.downstream].map(k => [k, 'done']))
      expect(selectionPoints('s21', near, drawn(bends, done), card, bends).filter(p => p.bend)).toEqual([])
    })

    for (const view of views)
      it(`at ${view.w}x${view.h} moves the frame of any step of that plan only when its own lanes need it, and then no farther than ${M} px`, () => {
        let kept = 0, moved = 0
        for (const id of Object.keys(bendDeps)) {
          const near = nearOf(bendDeps, id)
          const lanes = ownLanes(bends, id, near)
          const before = frameOf(bends, id, view, selectionPoints(id, near, drawn(bends), card))
          const after = frameOf(bends, id, view, selectionPoints(id, near, drawn(bends), card, bends))
          if (lanes.length === 0 || gap(before, view, lanes) >= M) {
            expect(after, id).toEqual(before)
            if (lanes.length > 0) kept++
            continue
          }
          moved++
          expect(gap(after, view, lanes), id).toBeGreaterThanOrEqual(M - 1e-6)
          // the binding side is the margin in, or the cards' pad decides (a lane inside the cards' span)
          expect(Math.min(gap(after, view, lanes) - M, gap(after, view, selectionPoints(id, near, drawn(bends), card)) - FRAME.fitPad * Math.min(view.w, view.h)), id).toBeLessThan(1)
        }
        // the premise: some long arrows' lanes are left as they were, some move
        expect(kept).toBeGreaterThan(0)
        expect(moved).toBeGreaterThan(0)
      })

    it('frames a chain whose arrows only join adjacent rows exactly as before', () => {
      const deps = { g: 'a,b', a: 'c', b: '', c: '' }
      const short = layoutPlan(steps(deps))
      const near = nearOf(deps, 'a')
      const withLanes = selectionPoints('a', near, drawn(short), card, short)
      expect(withLanes).toEqual(selectionPoints('a', near, drawn(short), card))
      for (const view of views) expect(frameOf(short, 'a', view, withLanes)).toEqual(frameOf(short, 'a', view, selectionPoints('a', near, drawn(short), card)))
    })
  })
})

describe("the selection's frame keeps the selected step as drawn inside the free area", () => {
  // UX pass e (Group off, a 170-step plan): the frame put the selected step's slot at the pad's edge and its brackets
  // and plate, drawn past the slot, ran off the window: at 800x740 a title to x 827, at 390x844 one to x 427, and
  // brackets from x -8. Fictional chains in the same shape: the selected step at one end of its neighbours' row.
  const { cardW, cardH } = LAYOUT
  const fov = 50
  const corners = (x: number, y: number) => [
    { x: x - cardW / 2, y: y - cardH / 2 },
    { x: x + cardW / 2, y: y + cardH / 2 },
  ]
  // The selected step as the stylesheet draws it (viewer.css, .node-label[data-selected]): brackets the usual 44 px
  // square on its circle, its plate right of them, as wide as its longest words (150 card px) at their boost.
  // Drawn `scale` times its size with a circle of radius `r` (a near-due step: NEAR.near and 16 px).
  const drawnBox = (f: Frame, view: { w: number; h: number }, at: { x: number; y: number }, scale = 1, r: number = DOT.r) => {
    const ppu = pxPerUnit(f.position.z, fov, view.h)
    const k = labelScale(ppu)
    const z = k * scale
    const sx = view.w / 2 + (at.x - f.lookAt.x) * ppu
    const sy = view.h / 2 - (at.y - f.lookAt.y) * ppu
    const dot = sx - (cardW / 2 - DOT.cx) * k
    const style = { dotR: r, z, overdue: false }
    const mark = (markSide(Infinity, style) / 2) * z
    const boost = Math.max(1, MARK_CSS.minTitle / (MARK_CSS.title * z))
    const plateRight = dot + (plateLeft(Infinity, style) - DOT.cx + (LABEL_TEXT.width + MARK_CSS.padding) * boost) * z
    return { left: dot - mark, right: plateRight, top: sy - mark, bottom: sy + mark }
  }
  const frameOf = (view: { w: number; h: number }, focus: { x: number; y: number }, others: { x: number; y: number }[]) => {
    const chain = [focus, ...others].flatMap(p => corners(p.x, p.y))
    // the rest of a large plan around them, so its own fit (the farthest a selection is framed) is far out
    const plan = [...chain, { x: -4000, y: 3000 }, { x: 4000, y: -3000 }]
    const host = { nodes: () => plan, fov: () => fov, view: () => view, move: () => {} }
    return selectionFrame(host, { focus, chain, insets: { bottom: FRAME.bottomInset }, legend: true }) as Frame
  }
  const cases: [string, { w: number; h: number }, { x: number; y: number }[]][] = [
    ['800x740, the selected step right of its neighbours', { w: 800, h: 740 }, [{ x: -1050, y: 0 }]],
    ['390x844, the selected step right of its neighbours', { w: 390, h: 844 }, [{ x: -1000, y: 0 }]],
    ['390x844, the selected step left of its neighbours', { w: 390, h: 844 }, [{ x: 1600, y: 0 }]],
  ]
  for (const [name, view, others] of cases)
    it(name, () => {
      const focus = { x: 0, y: 0 }
      const f = frameOf(view, focus, others)
      const box = drawnBox(f, view, focus)
      const strips = frameInsets(view, { right: 0, bottom: FRAME.bottomInset }, true)
      const m = FRAME.edgeMargin
      expect(box.left).toBeGreaterThanOrEqual(strips.left + m - 1e-6)
      expect(box.right).toBeLessThanOrEqual(view.w - strips.right - m + 1e-6)
      expect(box.top).toBeGreaterThanOrEqual(strips.top + m - 1e-6)
      expect(box.bottom).toBeLessThanOrEqual(view.h - strips.bottom - m + 1e-6)
      // the neighbours' circles are still in the window
      const ppu = pxPerUnit(f.position.z, fov, view.h)
      for (const p of others) {
        const sx = view.w / 2 + (p.x - f.lookAt.x) * ppu
        expect(sx).toBeGreaterThan(0)
        expect(sx).toBeLessThan(view.w)
      }
    })

  it('where the whole plan is the chain, never backs off past its fit, and the selected step wins over a neighbour', () => {
    const view = { w: 390, h: 844 }
    const focus = { x: 0, y: 0 }
    const plan = [focus, { x: -1000, y: 0 }].flatMap(p => corners(p.x, p.y))
    const host = { nodes: () => plan, fov: () => fov, view: () => view, move: () => {} }
    const f = selectionFrame(host, { focus, chain: plan, insets: { bottom: FRAME.bottomInset }, legend: true }) as Frame
    expect(f.position.z).toBeCloseTo(CHAIN_FRAME.maxZ(plan, view, fov, { right: 0, bottom: FRAME.bottomInset }, true), 6)
    expect(drawnBox(f, view, focus).right).toBeLessThanOrEqual(view.w - FRAME.edgeMargin + 1e-6)
  })

  it('changes nothing for a selected step centred with room around it', () => {
    const view = { w: 1200, h: 900 }
    const focus = { x: 0, y: 0 }
    const chain = [focus, { x: 0, y: 200 }, { x: 0, y: -200 }].flatMap(p => corners(p.x, p.y))
    const plan = [...chain, { x: -4000, y: 3000 }, { x: 4000, y: -3000 }]
    const opts = { pad: CHAIN_FRAME.pad, minZ: CHAIN_FRAME.minZ(view, fov), maxZ: CHAIN_FRAME.maxZ(plan, view, fov), ...frameInsets(view) }
    const without = chainFrame(focus, chain, view, fov, opts)
    expect(chainFrame(focus, chain, view, fov, { ...opts, reach: ppu => selectedReach(ppu) })).toEqual(without)
  })

  it('keeps the selected step above a bottom card taller than the default strip', () => {
    // A short window (its pad 6% of 560 px, 33.6) with a 280 px bottom card, and the neighbour far above (y up): zoomed
    // out that far the brackets, 44 px square on screen, reach about 20 px below the card, past the pad less the margin.
    const view = { w: 800, h: 560 }
    const bottom = 280
    const focus = { x: 0, y: 0 }
    const others = [{ x: 0, y: 3000 }]
    const chain = [focus, ...others].flatMap(p => corners(p.x, p.y))
    const plan = [...chain, { x: -4000, y: 3000 }, { x: 4000, y: -3000 }]
    const host = { nodes: () => plan, fov: () => fov, view: () => view, move: () => {} }
    const f = selectionFrame(host, { focus, chain, insets: { bottom }, legend: true }) as Frame
    expect(frameInsets(view, { right: 0, bottom }, true).bottom).toBe(bottom)
    expect(bottom).toBeGreaterThan(FRAME.bottomInset)
    expect(drawnBox(f, view, focus).bottom).toBeLessThanOrEqual(view.h - bottom - FRAME.edgeMargin + 1e-6)
  })

  it('centres a selected step drawn wider than the free area less the margins', () => {
    // 200 px wide with no strips at the side: the step is drawn at least 196 px wide (k 0.45), more than 200 - 2*16
    const view = { w: 200, h: 800 }
    const focus = { x: 0, y: 0 }
    const chain = corners(0, 0)
    const plan = [...chain, { x: -4000, y: 3000 }, { x: 4000, y: -3000 }]
    const host = { nodes: () => plan, fov: () => fov, view: () => view, move: () => {} }
    const f = selectionFrame(host, { focus, chain, legend: false }) as Frame
    const strips = frameInsets(view, { right: 0 }, false)
    expect(strips.left + strips.right).toBe(0)
    const box = drawnBox(f, view, focus)
    expect(box.right - box.left).toBeGreaterThan(view.w - 2 * FRAME.edgeMargin)
    expect((box.left + box.right) / 2).toBeCloseTo(view.w / 2, 6)
  })

  // Zoomed in enough (k 0.65 or more at scale 1.3) that the brackets are 2r+20 card px, not 44 px on screen: a 16 px
  // circle draws them 6.5 to 10.4 px wider each side than an 11 px one.
  it('a near-due selected step (drawn 1.3 times, a 16 px circle) is kept as drawn, its larger brackets counted', () => {
    const view = { w: 800, h: 740 }
    const focus = { x: 0, y: 0 }
    const others = [{ x: -400, y: 0 }]
    const chain = [focus, ...others].flatMap(p => corners(p.x, p.y))
    const plan = [...chain, { x: 0, y: 0, scale: NEAR.near }, { x: -4000, y: 3000 }, { x: 4000, y: -3000 }]
    const host = { nodes: () => plan, fov: () => fov, view: () => view, move: () => {} }
    const f = selectionFrame(host, { focus, chain, insets: { bottom: FRAME.bottomInset }, legend: true, dot: { r: SIZE.near, overdue: false } }) as Frame
    const box = drawnBox(f, view, focus, NEAR.near, SIZE.near)
    const strips = frameInsets(view, { right: 0, bottom: FRAME.bottomInset }, true)
    expect(box.left).toBeGreaterThanOrEqual(strips.left + FRAME.edgeMargin - 1e-6)
    expect(box.right).toBeLessThanOrEqual(view.w - strips.right - FRAME.edgeMargin + 1e-6)
  })
})

describe('selectedReach', () => {
  // Hand-worked from viewer.css (.node-label[data-selected]): at k=1, scale 1.3 (z 1.3) and a 16 px circle the
  // brackets are max(44/1.3, 2*16+20) = 52 card px, 33.8 px each side on screen; the circle is 67 px left of the slot's
  // centre; the plate starts at 18+26+3/1.3+6 = 52.31 card px and ends 156 later, (52.31-18+156)*1.3-67 = 180.4 px right.
  // Undated at k=1: brackets max(44, 2*11+20) = 44 px, 22 each side; the circle 85-18 = 67 px left of the slot's
  // centre; the plate from 18+22+3+6 = 49 to 49+156 = 205 card px, 205-18-67 = 120 px right of it.
  it('at k=1 an undated step reaches 89 px left, 120 right and 22 up and down', () => {
    expect(selectedReach(1)).toEqual({ left: 89, right: 120, top: 22, bottom: 22 })
  })

  // At the card floor (k=0.45, z 0.45): brackets 44 px on screen (22 each side); the circle 67*0.45 = 30.15 px left;
  // the words' boost 12/(13*0.45) = 2.0513, so the plate ends 22 (brackets) + 3 (gap) + 72/13 (padding) + 144 (words
  // and right padding, 156*12/13) = 174.54 px right of the circle: 144.39 right of the slot's centre.
  it('at the card floor counts the boosted plate', () => {
    const r = selectedReach(0.45)
    expect(r.left).toBeCloseTo(52.15, 6)
    expect(r.right).toBeCloseTo(169 + 72 / 13 - 30.15, 6)
    expect(r.top).toBeCloseTo(22, 6)
  })

  // k=1.6 (the cap) at scale 1.3, z 2.08, a 16 px circle: brackets 52 card px, 54.08 px each side; the circle 107.2 px
  // left; the plate ends (18+26+3/2.08+6-18+156)*2.08 = 394.04 px right of the circle.
  it('at the largest card scale and a near due date', () => {
    const r = selectedReach(1.6, 1.3, { r: 16, overdue: false })
    expect(r.top).toBeCloseTo(54.08, 6)
    expect(r.left).toBeCloseTo(161.28, 6)
    expect(r.right).toBeCloseTo(286.84, 6)
  })

  // Overdue, its ring 9 px: the brackets are at least (16+9)*2 + 8/1.3 = 56.15 card px, 36.5 px each side at z 1.3,
  // and the plate moves 2.08 card px right with them.
  it('counts an overdue step by its wider ring', () => {
    const r = selectedReach(1, 1.3, { r: 16, overdue: true })
    expect(r.top).toBeCloseTo(36.5, 6)
    expect(r.left).toBeCloseTo(103.5, 6)
    expect(r.right).toBeCloseTo(183.1, 6)
  })

  it('counts a near-due step by its own 16 px circle', () => {
    const r = selectedReach(1, 1.3, { r: 16, overdue: false })
    expect(r.top).toBeCloseTo(33.8, 6)
    expect(r.bottom).toBeCloseTo(33.8, 6)
    expect(r.left).toBeCloseTo(100.8, 6)
    expect(r.right).toBeCloseTo(180.4, 6)
  })
})

describe('flyX', () => {
  const reach = { left: 90, right: 200, top: 22, bottom: 22 }
  const m = FRAME.edgeMargin

  it('puts the slot in the middle of the room beside the strip when the step as drawn fits there', () => {
    // room 296..800, middle 548: the drawing spans 458..748, inside 312..784
    expect(flyX(800, 296, reach)).toBe(548)
  })

  it('moves it left as little as it takes to keep the plate the margin inside the right edge', () => {
    // room 296..700, middle 498 would end the plate at 698: it ends at 684 instead
    expect(flyX(700, 296, reach)).toBe(700 - m - 200)
  })

  it('moves it right as little as it takes to keep the brackets the margin clear of the strip', () => {
    expect(flyX(1000, 296, { ...reach, left: 400, right: 10 })).toBe(296 + m + 400)
  })

  it('is null when the room is narrower than the step as drawn with the margin on both sides', () => {
    expect(flyX(390, 296, reach)).toBeNull()
    expect(flyX(296 + 2 * m + 290, 296, reach)).toBe(296 + m + 90)
  })
})

describe('flyY', () => {
  const reach = { left: 90, right: 200, top: 22, bottom: 22 }
  const m = FRAME.edgeMargin

  it('puts the slot in the middle of the room between the toolbar strip and the bottom card strip', () => {
    // room 72..(720 - 170) = 72..550, middle 311
    expect(flyY(720, 72, 170, reach)).toBe(311)
  })

  it('a taller card moves it up with the room: never the same point whatever the card is', () => {
    // the card's top at 306 (its strip 720 - 306 + 12 = 426): room 72..294, middle 183
    expect(flyY(720, 72, 426, reach)).toBe(183)
    expect(flyY(720, 72, 426, reach)).toBeLessThan(flyY(720, 72, 170, reach))
  })

  it('keeps the step as drawn the margin inside the room, moving it as little as it takes', () => {
    // room 72..152 (80 px) holds the brackets with the margin (2 * (22 + 16) = 76), just: the middle, 112
    expect(flyY(720, 72, 568, reach)).toBe(112)
    // brackets taller below than above: moved up as little as it takes
    expect(flyY(720, 72, 568, { ...reach, top: 10, bottom: 30 })).toBe(720 - 568 - m - 30)
  })

  it('when the room cannot hold it, it goes as high as it can: just under the toolbar strip, never under the card', () => {
    expect(flyY(720, 72, 640, reach)).toBe(72 + m + 22)
    // a card taller than the view still leaves it in the window, under the toolbar
    expect(flyY(720, 72, 900, reach)).toBe(72 + m + 22)
  })
})

describe('flyAt', () => {
  const reach = { left: 90, right: 200, top: 22, bottom: 22 }

  it('with no strip at the left, the middle of the view across, and above the card down', () => {
    expect(flyAt({ w: 1280, h: 720 }, { left: 0, top: 72, bottom: 426 }, reach)).toEqual({ x: 640, y: 183 })
  })

  it('beside an open list, where flyX puts it', () => {
    expect(flyAt({ w: 800, h: 740 }, { left: 296, top: 72, bottom: 170 }, reach)).toEqual({ x: 548, y: flyY(740, 72, 170, reach) })
  })

  it('beside an open list too narrow for the step as drawn, the middle of the room beside it, not of the view', () => {
    // flyX is null at 650 for a step this wide (room 296..650): the middle of that room, 473, not 325 under the list
    const wide = { ...reach, right: 400 }
    expect(flyX(650, 296, wide)).toBeNull()
    expect(flyAt({ w: 650, h: 740 }, { left: 296, top: 72, bottom: 170 }, wide).x).toBe(473)
  })
})

describe('frameInsets with host insets', () => {
  const wide = { w: 1280, h: 800 }
  it('keeps the frame defaults when the host has none', () => {
    expect(frameInsets(wide)).toEqual({ top: FRAME.topInset, right: 0, bottom: FRAME.bottomInset, left: FRAME.leftInset })
  })
  it('takes a taller toolbar and a wider left strip than the defaults', () => {
    const s = frameInsets(wide, { top: 120, left: 300, right: 400, bottom: 10 })
    expect(s).toEqual({ top: 120, right: 400, bottom: 10, left: 300 })
  })
  it('never lets the side strips take more than 60% of the width', () => {
    expect(frameInsets(wide, { right: 2000 }).right).toBe(1280 * 0.6 - FRAME.leftInset)
  })
  it('drops the legend strip when legend is false', () => {
    expect(frameInsets(wide, {}, false).left).toBe(0)
  })
})
