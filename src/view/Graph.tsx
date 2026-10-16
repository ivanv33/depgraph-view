import { isStill } from '../engine/stillness.js'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import ForceGraph3D, { type ForceGraphMethods } from 'react-force-graph-3d'
import { keepScale, labelScale, panFor, pressStops, pxPerUnit } from '../engine/camera.js'
import {
  doneForFrame,
  fitOnce,
  fitPlan,
  FRAME,
  frameInsets,
  planFitTracker,
  planPoints,
  previewPlan,
  previewSelection,
  selectionFrame,
  selectionFrameStep,
  shouldFrameResize,
  sizeSettler,
  hidStep,
  insideArea,
  selectionPoints,
  type FrameHost,
  type SelectionFrameKey,
  type SelectionTarget,
  userMoveTracker,
  type Insets,
} from '../engine/frame.js'
import { panToReveal } from '../engine/reveal.js'
import { burstFrame, prefersReducedMotion, takeNewlyDone } from '../engine/effects.js'
import { placeNodes, structureKey, toGraphData, type GraphLink, type GraphNode } from '../engine/graphData.js'
import { backgroundAction } from '../engine/backgroundClick.js'
import { DOT, labelFor, onSelectedText, stackLabels, syncLabels, type LabelNode } from '../engine/nodeLabel.js'
import type { Plan, Status } from '../engine/schema.js'
import { chainOf, neighboursOf } from '../engine/chain.js'
import ChainEdgeCues, { type CueScene } from './ChainEdgeCue.js'
import { cueAreaBottom, type CuePoint } from '../engine/edgeCue.js'
import { edgeOpacity, linkRole, linkStyle } from '../engine/linkStyle.js'
import { deckLabel, deckParent, deckView } from '../engine/grouping.js'
import { layoutInput } from '../engine/drawnInput.js'
import { focusSoon as focusAfterDraw } from './focusSoon.js'
import { TWEEN_MS, originOf, tween, tweenEdge } from '../engine/tween.js'
import { dueViewOf, hazeOf, SIZE, type DueView } from '../engine/due.js'
import { useDeckViews } from './hooks/useDeckViews.js'
import { isTypingTarget } from './typing.js'
import DeckList, { deckListId, type DeckListFrame } from './DeckList.js'
import { rowsOf } from '../engine/deckList.js'
import { useNewPress } from './hooks/useNewPress.js'
import { useCameraGlide } from './hooks/useCameraGlide.js'
import { nodeStates } from '../engine/readiness.js'
import { LAYOUT, layoutPlan, type Pt } from '../engine/layered.js'
import { edgeObject, reshapeEdge, type EdgeDraw } from '../engine/edgeObject.js'
import { runFrame } from '../engine/frameOrder.js'
import { aimPlateHoles, boostStep, deckScale, fitBrackets, labelRanks, runTitleFit, titleBoost, titleLine, topOf, viewMoved, watchFonts, type GoalArrow, type Top } from '../engine/titleFitDom.js'
import { refreshOverPlate } from '../engine/overPlate.js'
import type { Box } from '../engine/titleFit.js'
import { glideMeter, type GlideSummary } from '../engine/glideMeter.js'
import { edgeMaterials } from '../engine/edgeMaterials.js'
import { insetBoxes } from './insetBoxes.js'

export interface GraphProps {
  plan: Plan
  selected: string | null
  onSelect: (id: string | null) => void
  /** Draw only the path to the selection and its subtree; every other branch is a deck. */
  grouped: boolean
  /** The local date (YYYY-MM-DD) due dates are read against. */
  today: string
  /** Host chrome over the graph in CSS px; nothing inside Graph queries the host DOM. */
  insets: Insets
  /** Bumped to frame the whole plan (the toolbar's fit button); the selection stays. */
  fitAll: number
  /** Called with the meter's history each time a transition's recording ends. */
  onGlides?: (history: readonly GlideSummary[]) => void
  /** Where focus goes when no label can take it (the page passes its group toggle). */
  focusFallback?: () => HTMLElement | null
}

/** The time of the animation frame being drawn (every part of one frame shares it), for the glide meter. */
const frameAt = (): number => (document.timeline?.currentTime as number | null | undefined) ?? performance.now()
const idOf = (end: unknown) => (typeof end === 'string' ? end : (end as GraphNode).id)
const edgeKey = (source: string, target: string) => `${source}\u0000${target}`
/** How often, at most, titles are fitted again while the view is still moving (once more when it stops), ms. */
const TITLE_FIT_MS = 250
/** No done deck opened. */
const NO_IDS: ReadonlySet<string> = new Set()

/**
 * One glide frame of a drawn edge (`obj`, the graph library's object for it): moved to `points` in place while it is
 * still drawn by `draw` (reshapeEdge), else its parts replaced by a fresh build's (the old ones disposed).
 */
function glideEdge(
  obj: THREE.Object3D,
  points: Pt[] | undefined,
  draw: (source: string, target: string) => { draw: EdgeDraw } | null,
  build: () => THREE.Object3D | null,
  source: string,
  target: string,
): void {
  const look = points && obj.userData.drawnBy === draw ? draw(source, target) : null
  if (look && points && reshapeEdge(obj, points, look.draw)) return
  const next = build()
  if (!next) return
  obj.userData.drawnBy = next.userData.drawnBy
  for (const old of [...obj.children]) {
    obj.remove(old)
    old.traverse(o => {
      const m = o as THREE.Mesh
      m.geometry?.dispose()
      ;(m.material as THREE.Material | undefined)?.dispose()
    })
  }
  obj.add(...next.children)
}

export default function Graph({ plan, selected: selectedId, onSelect, grouped: grouping, today, insets: given, fitAll, onGlides, focusFallback }: GraphProps) {
  // The host's insets, one object while their numbers hold (a host may pass a fresh object every render).
  const { top, right, bottom, left } = given
  const insets = useMemo<Insets>(() => ({ top, right, bottom, left }), [top, right, bottom, left])
  const [cache] = useState(() => new Map<string, GraphNode>())
  const [labels] = useState(() => new Map<string, HTMLDivElement>())
  const [seenStatus] = useState(() => new Map<string, Status>())
  // Times each frame of a transition (glideMeter.ts); every finished recording goes to data-glide on the root.
  const [meter] = useState(() => glideMeter())
  // The lines' shared materials (edgeMaterials.ts), disposed when the graph goes.
  const [edgeMats] = useState(() => edgeMaterials())
  useEffect(() => () => edgeMats.release(), [edgeMats])
  // its recordings so far, oldest first, handed to the host each time one ends (onGlides)
  const glidesRef = useRef(onGlides)
  useEffect(() => {
    glidesRef.current = onGlides
  })
  // Labels are stacked left to right (stackLabels), not by distance to the camera.
  const [extraRenderers] = useState(() => {
    const css = new CSS2DRenderer()
    // the label layer's share of a frame, for the glide meter
    const render = css.render.bind(css)
    css.render = (scene, camera) => {
      const t0 = performance.now()
      render(scene, camera)
      meter.add('labels', performance.now() - t0, frameAt())
    }
    css.sortObjects = false
    // The layer clips the labels to the window but must never scroll: under its own overflow:hidden the browser scrolls
    // it to show a focused label that lies outside (Tab, or a click whose frame moves the step out), and every label
    // is then drawn off its circle, some over the HUD and the panel. A clip is no scroll container.
    css.domElement.style.overflow = 'clip'
    return [css]
  })
  const fgRef = useRef<ForceGraphMethods<GraphNode, GraphLink> | undefined>(undefined)
  // Every camera move the graph starts (a frame, a fit, a fly) is counted on its wrapper as data-camera-moves, so a
  // test can tell one glide from several.
  const rootRef = useRef<HTMLDivElement>(null)
  // A glide is driven here, one camera step a frame (glideAt), not by the graph library's own, which turns the camera
  // faster than it moves it. A new move starts from wherever the camera is, so it never jumps to the last one's end.
  const cameraGlide = useCameraGlide(at => {
    const t0 = performance.now()
    fgRef.current?.cameraPosition(at.position, at.lookAt, 0)
    meter.add('camera', performance.now() - t0, frameAt())
  })
  // `land`, when given, is called once the camera arrives (the glide's last step), never for a glide cut short.
  const moveCamera = (position: { x: number; y: number; z: number }, lookAt: { x: number; y: number; z: number }, ms: number, land?: () => void) => {
    const el = rootRef.current
    if (el) el.dataset.cameraMoves = String(Number(el.dataset.cameraMoves ?? 0) + 1)
    const fg = fgRef.current
    if (!fg) return
    cameraGlide.stop()
    if (!(ms > 0)) {
      fg.cameraPosition(position, lookAt, 0)
      return land?.()
    }
    const cam = fg.camera().position
    const target = (fg.controls() as unknown as { target: THREE.Vector3 }).target
    const from = { position: { x: cam.x, y: cam.y, z: cam.z }, lookAt: { x: target.x, y: target.y, z: target.z } }
    meter.begin('camera')
    cameraGlide.glide(from, { position, lookAt }, ms, land)
  }
  const moveCameraRef = useRef(moveCamera)
  // The window's size from the first render (this graph only renders in the browser): the engine may first stop, and
  // the load's preview frame the plan, before the mount effect below has adopted it.
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  // What the title rule (titleFit.ts) ranks: the labels as last drawn, the focused step; set when either changes.
  const fitNodes = useRef<LabelNode[]>([])
  const fitTop = useRef<Top>(topOf([]))
  // The arrows drawn into the plan's goals from their own needs, which the top rows' words keep clear of.
  const fitArrows = useRef<readonly GoalArrow[]>([])
  const fitFocus = useRef<string | null>(null)
  const fitDirty = useRef(true)
  // Rendered card size relative to its layout slot: 1 while the zoom is inside the label clamp.
  const [cardScale, setCardScale] = useState(1)
  // How many times their layout size a deck's words draw (deckScale): the card's scale and the boost, in 0.02 steps
  // rounded up (so a list never outgrows its row's room by the rounding). Set only when it changes how many names a
  // deck lists (deckKeyAtRef, from useDeckViews), so a zoom or resize re-renders the graph no more than it did before.
  const [deckWords, setDeckWords] = useState(1)
  const deckWordsNow = useRef(1)
  const deckWordsShown = useRef(1)
  const deckKeyAtRef = useRef<(scale: number) => string>(() => '')
  const showDeckWords = useCallback(() => {
    const now = deckWordsNow.current
    if (now === deckWordsShown.current || deckKeyAtRef.current(now) === deckKeyAtRef.current(deckWordsShown.current)) return
    deckWordsShown.current = now
    setDeckWords(now)
  }, [])
  const pick = useRef(onSelect)

  const fallbackRef = useRef(focusFallback)
  useEffect(() => {
    pick.current = onSelect
    fallbackRef.current = focusFallback
  })
  // Done decks opened by a click, under the selection they were opened for: any other selection folds them again.
  const [openedDone, setOpenedDone] = useState<{ sel: string | null; ids: ReadonlySet<string> }>({ sel: null, ids: NO_IDS })
  // A selection that moves on (Escape, another step) drops them, so coming back to the step finds them folded.
  if (openedDone.sel !== selectedId && openedDone.ids.size > 0) setOpenedDone({ sel: selectedId, ids: NO_IDS })
  const opened = openedDone.sel === selectedId ? openedDone.ids : NO_IDS
  // The done decks drawn now, and the selection they belong to, for a click on one.
  const doneDecks = useRef<{ sel: string | null; ids: Set<string> }>({ sel: null, ids: new Set() })
  // The branch deck whose steps are listed in place (DeckList), under the selection it was opened for.
  const [listed, setListed] = useState<{ id: string; sel: string | null } | null>(null)
  if (listed && listed.sel !== selectedId) setListed(null)
  const listedRef = useRef(listed)
  useEffect(() => {
    listedRef.current = listed
  })
  // The press (its pointer id) that closed the list from outside it, on empty canvas: the click it ends only closes
  // the list, it does not deselect. Any later press forgets it, so a later click on empty space deselects as ever.
  const listClosedOnCanvas = useRef<number | null>(null)
  useEffect(() => {
    // Registered before any list's own outside-press listener, so it runs first on every press.
    const forget = () => {
      listClosedOnCanvas.current = null
    }
    window.addEventListener('pointerdown', forget, true)
    return () => window.removeEventListener('pointerdown', forget, true)
  }, [])
  // The click count of the latest mouse press (`MouseEvent.detail`: 2 for the second press of a double-click). The graph
  // reports a background click from the pointerup, whose own `detail` is always 0, so the press's is kept here.
  const pressDetail = useRef(0)
  useEffect(() => {
    const keep = (e: MouseEvent) => {
      pressDetail.current = e.detail
    }
    window.addEventListener('mousedown', keep, true)
    return () => window.removeEventListener('mousedown', keep, true)
  }, [])
  // Whether the list's going away has been seen to (a pick, a close): if not, and the focus was in it, it is put back
  // on the graph (focusLost).
  const listExit = useRef(false)
  // A branch deck lists its steps in place on a click (a second click closes the list): picking one there selects
  // it, and the selection and the drawing stay as they are until then. A done deck hangs from a step already drawn: a
  // click opens it where it is, its steps drawn one by one, and the selection stays.
  const onPick = useCallback((id: string) => {
    const parent = deckParent(id)
    if (parent && doneDecks.current.ids.has(id)) {
      const sel = doneDecks.current.sel
      setOpenedDone(prev => ({ sel, ids: new Set([...(prev.sel === sel ? prev.ids : []), id]) }))
    } else if (parent) {
      const sel = doneDecks.current.sel
      const now = listedRef.current
      if (now?.id === id && now.sel === sel) {
        // a second click closes it, the focus back on the deck
        listExit.current = true
        setListed(null)
        labels.get(id)?.focus({ preventScroll: true })
      } else {
        listExit.current = false
        setListed({ id, sel })
      }
    } else pick.current(id)
  }, [labels])
  // Focus a step's label once it is drawn (a newly selected step is drawn a frame or two later): the first of `ids`
  // drawn, else the host's fallback (focusFallback), so the focus never falls to the page; never over a focus the user
  // chose meanwhile (see focusSoon.ts), and not after the graph is gone.
  const focusRetries = useRef(new Set<() => void>())
  useEffect(() => {
    const pending = focusRetries.current
    return () => {
      // a cancelled retry takes itself out of the set: walk a copy
      for (const cancel of [...pending]) cancel()
    }
  }, [])
  const focusSoon = useCallback(
    (ids: (string | null | undefined)[]) => {
      // Each retry is kept only while it runs: it leaves the set when it ends, however it ends.
      const pending = focusRetries.current
      const cancel = focusAfterDraw(
        () => ids.map(id => (id ? labels.get(id) : undefined)).find(l => l?.isConnected),
        () => fallbackRef.current?.() ?? null,
        30,
        () => pending.delete(cancel),
      )
      pending.add(cancel)
    },
    [labels],
  )
  const closeList = useCallback(
    (refocus: boolean, target?: EventTarget | null, pointerId?: number) => {
      const id = listedRef.current?.id
      listExit.current = true
      setListed(null)
      if (refocus && id) labels.get(id)?.focus({ preventScroll: true })
      if (pointerId !== undefined && target instanceof Element && rootRef.current?.contains(target) && !target.closest('.node-label'))
        listClosedOnCanvas.current = pointerId
    },
    [labels],
  )
  // Escape folds the done decks opened under this selection again (the selection stays); a second Escape closes the
  // selection as before. Not while typing, or working in the side panel or the bottom card.
  const openedAny = opened.size > 0
  useEffect(() => {
    if (!openedAny) return
    const onKey = (e: KeyboardEvent) => {
      // An open list takes this Escape (it closes the list, one level at a time): it is not this one's.
      if (e.key !== 'Escape' || e.defaultPrevented || listedRef.current || isTypingTarget(e.target)) return
      if (e.target instanceof Element && e.target.closest('[data-testid="node-panel"], [data-testid="node-hud"]')) return
      e.preventDefault()
      e.stopPropagation()
      setOpenedDone({ sel: selectedId, ids: NO_IDS })
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [openedAny, selectedId])

  // The graph fills the window, so the window's inner size is the view's real size: a browser pane changing width or a
  // page zoom reaches it as a resize too. The canvas follows every new size at once; framing waits for the size to hold
  // (`settled`, its `seq` bumped by each settled burst): dragging a window edge is one resize, framed once at its end.
  const [settled, setSettled] = useState({ size: size, seq: 0 })
  const resizing = useRef<ReturnType<typeof sizeSettler> | null>(null)
  // The last window size this graph has seen, and how many bursts have settled (ahead of `settled` until it renders).
  const seenSize = useRef<{ w: number; h: number } | null>(null)
  const settles = useRef(0)
  // The steps of what is framed that were in view just before the resize began (measured in the old view), and the
  // selection they were measured for: a selection made during the burst is a new target, framed whatever they were.
  const inViewBefore = useRef<{ sel: string | null; ids: ReadonlySet<string> } | null>(null)
  const measureRef = useRef<() => { sel: string | null; all: number; inView: ReadonlySet<string> } | null>(() => null)
  // Whether the resize that just settled hid a step of what is framed now that was in view before it (hidStep).
  const resizeHid = () => {
    const now = measureRef.current()
    const before = inViewBefore.current
    if (now === null) return true
    return hidStep(before !== null && before.sel === now.sel ? before.ids : null, now.inView)
  }
  useEffect(() => {
    const first = { w: window.innerWidth, h: window.innerHeight }
    seenSize.current = first
    // The first size is no resize: the first fit (on the engine's stop) frames for it.
    // The count of settled bursts starts over with `settled.seq` (this effect runs again on a Fast Refresh), or the two
    // would never match again and no selection would be framed.
    const adopt = () => {
      settles.current = 0
      setSize(first)
      setSettled({ size: first, seq: 0 })
    }
    adopt()
    const settler = sizeSettler(first, {
      start: () => {
        const m = measureRef.current()
        inViewBefore.current = m && { sel: m.sel, ids: m.inView }
      },
      settle: v => {
        settles.current++
        setSettled(prev => ({ size: v, seq: prev.seq + 1 }))
      },
    })
    resizing.current = settler
    const update = () => {
      const next = { w: window.innerWidth, h: window.innerHeight }
      seenSize.current = next
      // Before the canvas takes the new size, so the burst's start still measures the old view.
      settler.see(next)
      setSize(next)
    }
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('resize', update)
      settler.cancel()
    }
  }, [])
  const viewKey = `${settled.size.w}x${settled.size.h}`

  const sizeRef = useRef(size)
  useEffect(() => {
    sizeRef.current = size
  }, [size])
  // The canvas takes each new height at once, and the camera's field of view is vertical: left where it is, the camera
  // would scale the plan with the height. It moves along its line of sight with the height instead (keepScale), before
  // the next frame is drawn, so a taller or shorter window keeps the plan's size on screen as a wider or narrower one
  // does; a resize that frames again glides from there once it settles.
  const scaleHeight = useRef(size.h)
  useLayoutEffect(() => {
    const before = scaleHeight.current
    scaleHeight.current = size.h
    const fg = fgRef.current
    if (!fg || before === size.h) return
    const camera = fg.camera()
    const target = (fg.controls() as unknown as { target: THREE.Vector3 }).target
    const at = keepScale(camera.position, target, before, size.h)
    camera.position.set(at.x, at.y, at.z)
  }, [size.h])
  // The free graph area on screen, as the frames keep it (the window less the legend's strip and the host's insets): a
  // selected step's plate moved off its usual place stays inside it (plateFit.ts).
  const plateArea = useRef<() => Box | undefined>(() => undefined)
  useEffect(() => {
    plateArea.current = () => {
      const root = rootRef.current?.getBoundingClientRect()
      if (!root) return undefined
      const strips = frameInsets(sizeRef.current, insets)
      return { left: root.left + strips.left, top: root.top + strips.top, right: root.left + sizeRef.current.w - strips.right, bottom: root.top + sizeRef.current.h - strips.bottom }
    }
  }, [insets])

  // The edge cues' tick (ChainEdgeCue.tsx), called on every animation frame by the graph's frame (zoomFrame below).
  const cueTick = useRef<(() => void) | null>(null)
  // An open deck list's read of where its deck is drawn (DeckList.tsx), run first in the graph's frame; it hands back
  // its place, written with the frame's other writes.
  const listFrame = useRef<DeckListFrame | null>(null)
  // How many times the title fit has run: the cards' words may have changed (an edit, a font, a title cut or shown)
  // with no view move, so the edge cues measure them again (ChainEdgeCue.tsx).
  const fitRuns = useRef(0)
  // Whether the title fit has measured the words once (a still run): the first whole-plan frame waits for it, so on load
  // it counts each title by its longest drawn line (titleLine) as every later frame does, not by its text block.
  const titlesMeasured = useRef(false)
  const afterMeasure = useRef<() => void>(() => {})
  // Cards scale with the zoom like a map: on every frame, turn the camera distance into pixels per unit and hand the
  // clamped scale to the label layer as --label-scale (the cards read it through `zoom`). Written by the graph's frame
  // (zoomFrame below) after the brackets' pass has read the page, so that pass reads it as last laid out and lays
  // nothing out, and before a fit run, which measures and so lays the page out anyway, at this frame's size. A second
  // call on the same frame finds the same camera and writes nothing.
  const scaleTick = useRef<(() => void) | null>(null)
  useEffect(() => {
    let lastScale = -1
    let lastCard = 1
    const root = extraRenderers[0].domElement
    scaleTick.current = function labelScaleTick() {
      const camera = fgRef.current?.camera() as THREE.PerspectiveCamera | undefined
      if (!camera || camera.position.z <= 0) return
      const ppu = pxPerUnit(camera.position.z, camera.fov, sizeRef.current.h)
      const scale = labelScale(ppu)
      if (Math.abs(scale - lastScale) > 1e-3) {
        root.style.setProperty('--label-scale', scale.toFixed(4))
        lastScale = scale
      }
      const card = Math.round((scale / ppu) * 50) / 50
      if (card !== lastCard) {
        lastCard = card
        setCardScale(card)
      }
      deckWordsNow.current = Math.ceil(deckScale(ppu) * 50 - 1e-6) / 50
      showDeckWords()
    }
    return () => {
      scaleTick.current = null
    }
  }, [extraRenderers, showDeckWords])

  // The plan lives on the z = 0 plane and is viewed straight on: no orbiting, only pan (any drag) and zoom (wheel).
  // While the user drags, the camera is theirs: framing waits.
  const dragging = useRef(false)
  // Set when the user zooms or pans (a wheel notch counts; a press that moves nothing does not), cleared by every
  // automatic frame, F and Shift+F: until then the bottom card growing or the layout shifting under the selection
  // leaves the camera where the user put it.
  const [userMoved] = useState(userMoveTracker)
  const fitAfterDrag = useRef<() => void>(() => {})
  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    const controls = fg.controls() as unknown as {
      noRotate: boolean
      mouseButtons: { LEFT: THREE.MOUSE; MIDDLE: THREE.MOUSE; RIGHT: THREE.MOUSE }
      touches: { ONE: THREE.TOUCH; TWO: THREE.TOUCH }
      update: () => void
      addEventListener: (type: 'start' | 'end' | 'change', listener: () => void) => void
      removeEventListener: (type: 'start' | 'end' | 'change', listener: () => void) => void
    }
    // TrackballControls: no button turns the camera, and neither does holding its rotate key (A) while dragging.
    controls.noRotate = true
    controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
    controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN }
    // A drag moves the plan with the pointer, so the point grabbed stays under it, and stops when the pointer does.
    // The controls' own pan scales the pointer's travel by the canvas size they measured when they were made (the
    // canvas's default 300 x 150, before the graph sized it; so up and down went twice as far as across), and with
    // their damping (kept for the wheel) it re-applied what was left of the move on every frame, about five times in
    // all and on after the release. Their pan state still records the pointer; this turns it into an exact move.
    const pan = controls as unknown as {
      _panStart: THREE.Vector2
      _panEnd: THREE.Vector2
      screen: { width: number; height: number }
      target: THREE.Vector3
      object: THREE.PerspectiveCamera
      _panCamera?: () => void
    }
    pan._panCamera = () => {
      const dx = (pan._panEnd.x - pan._panStart.x) * pan.screen.width
      const dy = (pan._panEnd.y - pan._panStart.y) * pan.screen.height
      pan._panStart.copy(pan._panEnd)
      if (!dx && !dy) return
      // A drag that moves the view takes the camera over from a glide still running (a frame, Fit), which would
      // otherwise put the camera back on its own path every frame and carry on after the release.
      cameraGlide.stop()
      const cam = pan.object
      const by = panFor(dx, dy, cam.position.distanceTo(pan.target), cam.fov, sizeRef.current.h)
      cam.position.x += by.x
      cam.position.y += by.y
      pan.target.x += by.x
      pan.target.y += by.y
    }
    controls.update()
    // The camera as last drawn. The graph draws each frame right after the controls' update, and a glide's step for
    // that frame may come after the drawing (the camera is then a step ahead of the screen): a press puts the camera
    // back where it was drawn, so the view does not take one more step under the press.
    const drawn = { position: pan.object.position.clone(), target: pan.target.clone() }
    const update = controls.update
    controls.update = (...args: unknown[]) => {
      ;(update as (...a: unknown[]) => void).apply(controls, args)
      drawn.position.copy(pan.object.position)
      drawn.target.copy(pan.target)
    }
    const start = () => {
      dragging.current = true
      userMoved.start()
    }
    const end = () => {
      dragging.current = false
      userMoved.end()
      fitAfterDrag.current()
    }
    const change = () => userMoved.change()
    // The controls zoom on the next frame, after their own start and end: the wheel itself counts.
    const wheel = () => userMoved.wheel()
    // The wheel's zoom eases: each frame the controls apply a share of what is left between these two (y only).
    const zoom = controls as unknown as { _zoomStart: THREE.Vector2; _zoomEnd: THREE.Vector2 }
    const canvas = fg.renderer().domElement
    // A press counts as a drag only once the pointer travels (the controls capture it, so its moves reach the canvas):
    // a glide running under a click or a right-click changes the camera too.
    // The press itself makes the camera the user's (pressStops): a glide still running is cut where it is and the
    // wheel's easing ends where it is, so the point grabbed stays under the pointer from the press on, not only from
    // the first move. A press that does not move still clicks as ever.
    const down = (e: PointerEvent) => {
      const stop = pressStops({ onCanvas: e.target === canvas, gliding: cameraGlide.active(), zoomEasing: zoom._zoomStart.y !== zoom._zoomEnd.y })
      if (stop.glide) {
        cameraGlide.stop()
        fg.cameraPosition(drawn.position.clone(), drawn.target.clone(), 0)
      }
      if (stop.zoom) zoom._zoomStart.copy(zoom._zoomEnd)
      userMoved.down(e.clientX, e.clientY)
    }
    const move = (e: PointerEvent) => userMoved.move(e.clientX, e.clientY)
    controls.addEventListener('start', start)
    controls.addEventListener('end', end)
    controls.addEventListener('change', change)
    canvas.addEventListener('wheel', wheel)
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    return () => {
      delete pan._panCamera
      controls.update = update
      controls.removeEventListener('start', start)
      controls.removeEventListener('end', end)
      controls.removeEventListener('change', change)
      canvas.removeEventListener('wheel', wheel)
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
    }
  }, [userMoved, cameraGlide])

  // The WebGL drawing's share of a frame, for the glide meter.
  useEffect(() => {
    const renderer = fgRef.current?.renderer()
    if (!renderer) return
    const render = renderer.render
    renderer.render = (scene, camera) => {
      const t0 = performance.now()
      render.call(renderer, scene, camera)
      meter.add('render', performance.now() - t0, frameAt())
    }
    return () => {
      renderer.render = render
    }
  }, [meter])

  // The camera controls listen on the canvas; the labels sit over it in their own layer, so a wheel over a circle or
  // a title would never reach them. Hand it on: the wheel zooms the same over a step as over empty canvas.
  useEffect(() => {
    const layer = extraRenderers[0].domElement
    const onWheel = (e: WheelEvent) => {
      const canvas = fgRef.current?.renderer().domElement
      if (!canvas) return
      e.preventDefault()
      const { deltaX, deltaY, deltaZ, deltaMode, clientX, clientY, screenX, screenY, ctrlKey, shiftKey, altKey, metaKey } = e
      canvas.dispatchEvent(
        new WheelEvent('wheel', { deltaX, deltaY, deltaZ, deltaMode, clientX, clientY, screenX, screenY, ctrlKey, shiftKey, altKey, metaKey, bubbles: true, cancelable: true }),
      )
    }
    layer.addEventListener('wheel', onWheel, { passive: false })
    return () => layer.removeEventListener('wheel', onWheel)
  }, [extraRenderers])

  // Deterministic layered layout, goal on top; only the set of nodes and dependencies moves anything.
  // With decks on, only the path to the selection and its subtree are drawn; the rest folds into decks.
  // With a selection, its finished needs fold into done decks too, except those opened by a click.
  const view = useMemo(() => deckView(plan, selectedId, grouping, opened), [plan, selectedId, grouping, opened])
  useEffect(() => {
    doneDecks.current = { sel: selectedId, ids: new Set([...view.decks.values()].filter(d => d.done).map(d => d.id)) }
  }, [view, selectedId])
  // Every drawn card with its size, as the arrow keys lay it out too (layoutInput).
  const drawn = useMemo(() => layoutInput(plan, view, today), [plan, view, today])
  const structure = structureKey(drawn) + drawn.map(n => `${n.h ?? ''}/${n.w ?? ''}/${n.tail ?? ''}`).join(',')
  // (counted and timed for the glide meter: once per change)
  // Timed for the glide meter from inside render: a render React throws away would still count a layout (none does
  // today; in dev StrictMode's second render is why a change counts 2).
  const layout = useMemo(() => meter.layout(() => layoutPlan(drawn)), [structure]) // eslint-disable-line react-hooks/exhaustive-deps
  const edgeByKey = useMemo(() => new Map(layout.edges.map(e => [edgeKey(e.source, e.target), e])), [layout])

  // The first time there is a plan, frame its bounding box; after that the camera is the user's, except
  // that a structure change re-frames (below).
  const fitter = useRef<() => void>(() => {})
  // Once a whole-plan frame the app makes (the load's, F, a resize, closing the selection, a change in what is drawn)
  // has landed, the next measuring title fit decides afresh (runTitleFit's `fresh`): the titles were fitted at the
  // camera before that frame, and what they showed there is no slack to keep at the zoom the frame lands at.
  const fitFresh = useRef(false)
  const layoutRef = useRef(layout)
  useEffect(() => {
    layoutRef.current = layout
  }, [layout])
  // Each drawn node's due-date scale (`scales`, below), for the whole-plan frame.
  const scalesRef = useRef<ReadonlyMap<string, number>>(new Map())
  // Each drawn node's due date (`dues`, below): the selection's frame counts the selected circle as its label draws it.
  const duesRef = useRef<ReadonlyMap<string, DueView | null>>(new Map())
  const [host] = useState<FrameHost>(() => ({
    // The slot box, and each step with its due-date scale and what the title fit last measured of its words (its
    // longest drawn line, titleLine; a deck's words are not boosted): the frame counts each as drawn. Data the fit kept,
    // no layout read here.
    nodes: () =>
      planPoints(
        layoutRef.current,
        id => scalesRef.current.get(id) ?? 1,
        id => {
          const el = labels.get(id)
          return !el ? undefined : el.dataset.deck === 'true' ? { deck: true } : { line: titleLine(el) }
        },
      ),
    fov: () => (fgRef.current?.camera() as THREE.PerspectiveCamera | undefined)?.fov ?? 75,
    view: () => sizeRef.current,
    move: (position, lookAt, ms, land) => moveCameraRef.current(position, lookAt, ms, land),
    landed: () => {
      fitFresh.current = true
      fitDirty.current = true
    },
  }))
  // The first fit waits while a node is selected: the selection's frame (retried below) owns the camera.
  const selectedRef = useRef(selectedId)
  useEffect(() => {
    selectedRef.current = selectedId
  }, [selectedId])
  useEffect(() => {
    // It also waits until the titles were measured once, a few frames after the labels first draw, and does not move a
    // camera the user has moved before then: it is theirs (a drag or a wheel before the first measure).
    const load = fitOnce(host, () => selectedRef.current !== null || !titlesMeasured.current || userMoved.moved())
    fitter.current = () => void load()
    afterMeasure.current = () => fitter.current()
  }, [host, userMoved])
  const frameSelection = useRef<() => void>(() => {})
  const engineStopped = useRef(false)
  const onEngineStop = useCallback(() => {
    engineStopped.current = true
    // Until the titles' first measure the plan is shown at its estimated frame (previewPlan: a jump, before the steps
    // first draw), so it is never drawn at the graph library's default camera; the load's frame, measured, refines it.
    // With a step selected (one in the URL) the selection's own first frame does the same (frameSelection below).
    if (!titlesMeasured.current && selectedRef.current === null && !userMoved.moved()) previewPlan(host)
    fitter.current()
    frameSelection.current()
  }, [host, userMoved])

  // Status/title changes do not rebuild graphData; patch the cached nodes in place instead.
  useMemo(() => {
    for (const n of plan.nodes) {
      const cached = cache.get(n.id)
      if (cached) {
        cached.status = n.status
        cached.title = n.title
      }
    }
  }, [plan, cache])

  const chain = useMemo(() => chainOf(plan, selectedId), [plan, selectedId])
  // What a selection is framed with: the steps it needs and the steps that need it, one hop each way (the whole chain
  // stays marked and undimmed, but the path to the goal is not forced into the frame).
  const near = useMemo(() => neighboursOf(plan, selectedId), [plan, selectedId])
  const states = useMemo(() => nodeStates(plan), [plan])
  // The branch deck listed in place, if it is still drawn (Group on, the same selection), and what the list shows.
  const listDeck = listed && listed.sel === selectedId ? view.decks.get(listed.id) : undefined
  const listLook = useMemo(() => (listDeck ? deckLabel(listDeck, today, states, plan) : null), [listDeck, today, states, plan])
  const listRows = useMemo(() => (listDeck ? rowsOf(listDeck.members, states, plan, today) : []), [listDeck, states, plan, today])
  const listId = listDeck?.id
  // Its deck no longer drawn (Group off, a plan edit, the deck gone): the list closes for good, so the deck coming back
  // (Group on again) does not reopen it.
  if (listed && listed.sel === selectedId && !listDeck) setListed(null)
  const listAnchor = useCallback(() => (listId ? labels.get(listId) : undefined), [listId, labels])


  // A new selection (or the panel opening or closing under it) frames the node with its neighbours, from
  // the layout this selection produces; the glide to that layout and the camera move run together. The frame
  // counts as made only once the camera has moved, so a selection there before the graph was ready (mounting
  // with one) is framed when the engine first stops.
  const framed = useRef<SelectionFrameKey>({ id: null, right: insets.right })
  // The steps it is framed with, its neighbours (a need added with N, a step linked with L or a neighbour removed
  // re-frames the selection), and where the selected step is laid out (a new layout moving it re-frames only if that
  // leaves those steps out of view).
  const focusAt = selectedId === null ? undefined : layout.nodes.get(view.hidden.get(selectedId)?.[0] ?? selectedId)
  const chainKey = [...near.upstream, ...near.downstream].sort().join('\n')
  const focusKey = focusAt ? `${focusAt.x},${focusAt.y}` : ''
  useEffect(() => {
    const { cardW, cardH } = LAYOUT
    const statusOf = (id: string) => plan.nodes.find(n => n.id === id)?.status
    // Which steps of what is framed are in view (not under a strip, not off the window), from where the camera is now
    // and in the view as it is now; null with no camera yet. What counts is what the user reads: with a selection each
    // unfinished chain step's circle and the slot its words run along, against the card's real top edge (the frame's
    // gap above the card may be crossed); with nothing selected every drawn step's circle.
    measureRef.current = () => {
      const camera = fgRef.current?.camera()
      if (camera === undefined) return null
      const viewSize = sizeRef.current
      const strips = frameInsets(viewSize, insets)
      const area = selectedId === null ? strips : { ...strips, bottom: strips.bottom - FRAME.hudGap }
      const ids = selectedId === null ? [...layout.nodes.keys()] : [selectedId, ...near.upstream, ...near.downstream]
      let all = 0
      const inView = new Set<string>()
      for (const id of ids) {
        const drawnId = selectedId === null ? id : (view.hidden.get(id)?.[0] ?? id)
        const p = layout.nodes.get(drawnId)
        if (!p || (selectedId !== null && doneForFrame(id, selectedId, statusOf, view.decks.get(drawnId)?.members))) continue
        all++
        const left = p.x - cardW / 2 + DOT.cx - DOT.r
        const right = selectedId === null ? left + 2 * DOT.r : p.x + cardW / 2
        const onScreen = [
          { x: left, y: -p.y - DOT.r },
          { x: right, y: -p.y + DOT.r },
        ].map(q => {
          const v = new THREE.Vector3(q.x, q.y, 0).project(camera)
          return { x: ((v.x + 1) / 2) * viewSize.w, y: ((1 - v.y) / 2) * viewSize.h }
        })
        if (insideArea(onScreen, viewSize, area)) inView.add(id)
      }
      return { sel: selectedId, all, inView }
    }
    const covered = () => {
      const m = measureRef.current()
      return m === null || m.inView.size < m.all
    }
    // The selection as its frame takes it now, with the host's insets; null when its step is not drawn.
    // Card corners of the step and its neighbours, the selected card's too, so no card is cut at the edge. Finished
    // steps (a deck only when all its members are) are left out of the box: they stay drawn and may fall outside the
    // view. A neighbour folded into a deck stands at its deck. A done deck is one compact card for finished work: its
    // card is shown when that backs the camera off only a little (chainFrame's spare points), the selected step's own
    // done deck first, so a deeper done deck never pushes it out of the view. The lanes and bends of its own long
    // arrows to the neighbours framed count too, kept the frame's edge margin inside the free area.
    const selection = (): SelectionTarget | null => {
      if (selectedId === null) return null
      const focusId = view.hidden.get(selectedId)?.[0] ?? selectedId
      const focus = layout.nodes.get(focusId)
      if (!focus) return null
      const chain = selectionPoints(
        selectedId,
        near,
        {
          at: id => layout.nodes.get(id),
          drawnId: id => view.hidden.get(id)?.[0] ?? id,
          deck: id => view.decks.get(id),
          status: statusOf,
        },
        { w: cardW, h: cardH },
        layout,
      )
      // Its circle as its label draws it (nodeLabel.ts sets --dot-r from the same DueView, SIZE.normal undated).
      const due = duesRef.current.get(focusId)
      const dot = { r: due?.radius ?? SIZE.normal, overdue: due?.overdue ?? false }
      return { focus: { x: focus.x, y: -focus.y }, chain, insets, dot, top: Math.max(FRAME.topInset, insets.top) }
    }
    frameSelection.current = () => {
      const now = { id: selectedId, right: insets.right, left: insets.left, bottom: insets.bottom, chain: chainKey, at: focusKey, view: viewKey }
      const fg = fgRef.current
      const viewSize = sizeRef.current
      // Before the engine first stops the window size and the camera are not settled yet: wait for it; while a resize
      // is still going, wait for its end (it frames then, once, with the bottom card as it re-wrapped). A selection
      // made while the user drags is not framed, and counts as seen so the camera does not jump to it later. A window
      // is resizing too while its size is not the last one this graph saw (the page can react to a resize, the panel
      // collapsing on a narrow window, before this graph's own listener runs), or a settled burst has not rendered yet.
      const seen = seenSize.current
      const unsettled = (seen !== null && (window.innerWidth !== seen.w || window.innerHeight !== seen.h)) || settles.current !== settled.seq
      const ready = engineStopped.current && !resizing.current?.pending() && !unsettled
      const step = selectionFrameStep(framed.current, now, ready, dragging.current, {
        userMoved: userMoved.moved(),
        get covered() {
          return covered()
        },
        get hid() {
          return resizeHid()
        },
      })
      if (step === 'seen') framed.current = now
      if (step !== 'frame' || selectedId === null) return
      // No view to frame in yet (its size is 0): the frame would have no position. Left unmade, it is tried again.
      if (!(viewSize.w > 0 && viewSize.h > 0)) return
      const sel = selection()
      const frame = fg && sel && selectionFrame(host, sel)
      if (!frame) return
      // The selection's first frame on load (a step in the URL, framed once the engine first stops, before the titles'
      // first measure): the camera is still at the graph library's default, so it first jumps to the frame
      // (previewSelection, as previewPlan does with nothing selected) and the plan is never drawn from there.
      if (framed.current.id === null && !titlesMeasured.current && !userMoved.moved()) previewSelection(host, sel)
      const { position, lookAt } = frame
      moveCamera(position, lookAt, FRAME.fitMs)
      framed.current = now
      userMoved.clear()
    }
  })
  useEffect(() => frameSelection.current(), [selectedId, insets.top, insets.right, insets.bottom, insets.left, chainKey, focusKey, settled.seq])

  // Closing the selection, and with nothing selected a change in which nodes are drawn (decks on or off, nodes added
  // or removed), re-fits the whole plan the way the first load does.
  const drawnIds = view.nodes.map(n => n.id).sort().join('\n')
  // A change seen while the user drags is fitted when the drag ends.
  const [fitTracker] = useState(() => planFitTracker({ selectedId, drawn: null }))
  // So is one seen during a resize: it is fitted once, at the new size, when the resize settles. One seen before the
  // titles' first measure (the plan's first drawn steps) is the load's frame, which waits for that measure (fitOnce).
  useEffect(() => {
    const later = dragging.current || !!resizing.current?.pending()
    if (fitTracker.see({ selectedId, drawn: drawnIds }, later) && titlesMeasured.current && fitPlan(host, insets)) userMoved.clear()
  }, [drawnIds, selectedId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    fitAfterDrag.current = () => {
      if (resizing.current?.pending()) return
      if (fitTracker.dragEnd() && fitPlan(host, insets)) userMoved.clear()
    }
  })
  // With nothing selected, a settled new view size fits the whole plan into it again, as the first load does (unless
  // the user has moved the camera and the resize left the plan as much in view as it was). A selection's own frame
  // handles a resize under it (frameSelection).
  const planFitView = useRef(viewKey)
  useEffect(() => {
    const before = planFitView.current
    planFitView.current = viewKey
    // before the titles' first measure the load's frame is still to come, at the size then (fitOnce)
    if (!engineStopped.current || !titlesMeasured.current || dragging.current) return
    // A whole-plan fit that waited for the resize (the selection closed, or the drawn steps changed) is the one frame.
    if (fitTracker.dragEnd()) {
      if (fitPlan(host, insets)) userMoved.clear()
      return
    }
    if (selectedId !== null || viewKey === before) return
    if (shouldFrameResize({ userMoved: userMoved.moved(), hid: resizeHid() }, false) && fitPlan(host, insets)) userMoved.clear()
  }, [settled]) // eslint-disable-line react-hooks/exhaustive-deps
  // Fit: the whole plan, whatever is selected (the selection and its panel stay). Only a press made while this
  // graph is mounted counts: a plan switch remounts it under the old count.
  useNewPress(fitAll, () => {
    userMoved.clear()
    fitPlan(host, insets)
  })
  // Each deck is drawn as one node whose look comes from its members; a zoom step that lists as many keeps the same map.
  const deckViews = useDeckViews(plan, view, today, states, selectedId, deckWords, deckKeyAtRef)
  // Decks drawn afresh (Group on, a new selection) list as many names as the zoom they arrive at leaves room for.
  useEffect(showDeckWords, [showDeckWords, deckViews])
  // How much larger than its slot each drawn node draws by its due date (a deck by its nearest member's); 1 undated.
  // Each drawn node's due date as its label draws it (a deck's by its nearest member's): its scale, its circle.
  const dues = useMemo(() => {
    const byId = new Map(plan.nodes.map(n => [n.id, n]))
    const dueOf = (id: string) => (view.decks.has(id) ? deckViews.get(id)?.due : byId.has(id) ? dueViewOf(plan, byId.get(id)!, today) : null)
    return new Map(view.nodes.map(n => [n.id, dueOf(n.id) ?? null]))
  }, [plan, view, deckViews, today])
  const scales = useMemo(() => new Map([...dues].map(([id, due]) => [id, due?.scale ?? 1])), [dues])
  // Before any effect: the effects above that fit the whole plan, or frame the selection, read them in the same commit.
  useLayoutEffect(() => {
    scalesRef.current = scales
    duesRef.current = dues
  }, [scales, dues])

  const data = useMemo(() => {
    const d = toGraphData({ nodes: drawn }, cache)
    placeNodes(d.nodes, layout.nodes)
    return d
  }, [layout]) // eslint-disable-line react-hooks/exhaustive-deps

  // Each node's haze: its due strength, or 1 when undated, done, selected or on the chain.
  const hazes = useMemo(() => {
    const map = new Map<string, number>()
    for (const n of plan.nodes) {
      const focused = n.id === selectedId || chain.upstream.has(n.id) || chain.downstream.has(n.id)
      map.set(n.id, hazeOf(dueViewOf(plan, n, today), focused))
    }
    for (const [id, v] of deckViews) map.set(id, hazeOf(v.due ?? null, false))
    return map
  }, [plan, today, selectedId, chain, deckViews])

  useEffect(() => {
    const titleOf = new Map(plan.nodes.map(n => [n.id, n.title || n.id]))
    // Needs no drawn line stands for (in another step's deck): the label says how many, so the step is not taken for a leaf.
    const away = (id: string) => {
      const ids = view.elsewhere.get(id)
      return ids ? { count: ids.length, titles: ids.map(d => titleOf.get(d) ?? d) } : undefined
    }
    const real: LabelNode[] = plan.nodes
      .filter(n => !view.hidden.has(n.id))
      .map(n => ({
        elsewhere: away(n.id),
        id: n.id,
        title: n.title,
        status: n.status,
        state: states.get(n.id) ?? 'waiting',
        chain: chain.upstream.has(n.id) ? 'up' : chain.downstream.has(n.id) ? 'down' : '',
        selected: n.id === selectedId,
        held: !!n.hold,
        priority: n.priority ?? 'normal',
        due: dueViewOf(plan, n, today) ?? undefined,
        dim: !!selectedId && n.id !== selectedId && !chain.upstream.has(n.id) && !chain.downstream.has(n.id),
      }))
    const all = [...real, ...deckViews.values()]
    syncLabels(labels, all, onPick)
    fitNodes.current = all
    fitTop.current = topOf(plan.nodes)
    fitDirty.current = true
  }, [labels, plan, view, deckViews, selectedId, chain, states, today, onPick])
  // Each arrow into a goal as drawn when nothing is picked out (its plain style: a done need's is thinner).
  useEffect(() => {
    const goals = topOf(plan.nodes).goals
    fitArrows.current = layout.edges
      .filter(e => goals.has(e.target))
      .map(e => {
        const style = linkStyle('none', (deckViews.get(e.source)?.state ?? states.get(e.source)) === 'done', e.redundant)
        return { from: e.source, points: e.points, arrow: style.arrow, width: style.width, scales: { start: scales.get(e.source) ?? 1, end: scales.get(e.target) ?? 1 } }
      })
    fitDirty.current = true
  }, [plan, layout, deckViews, states, scales])
  // A branch deck says it opens a list, and whether its list is open now.
  useEffect(() => {
    for (const [id, el] of labels) {
      if (!deckParent(id) || view.decks.get(id)?.done) {
        el.removeAttribute('aria-haspopup')
        el.removeAttribute('aria-expanded')
        continue
      }
      el.setAttribute('aria-haspopup', 'dialog')
      el.setAttribute('aria-expanded', String(id === listId))
      if (id === listId) el.setAttribute('aria-controls', deckListId(id))
      else el.removeAttribute('aria-controls')
    }
    // a deck whose list is open keeps its words (titleFit)
    fitDirty.current = true
  }, [labels, view, deckViews, listId])
  // A circle takes the pointer over a neighbour's words: labels further right stack higher.
  useEffect(() => {
    stackLabels(labels, layout.nodes.values())
  }, [labels, layout])

  // A step that loses the selection (Escape, a background click) gives up the focus a click gave it, so its
  // focus ring does not stay on behind. Tabbing onto a step afterwards focuses it again, ring and all.
  useEffect(() => {
    const el = document.activeElement
    if (el instanceof HTMLElement && el.matches('[data-testid="node-label"]') && el.dataset.nodeId !== selectedId) el.blur()
  }, [selectedId])

  useEffect(() => {
    const ids = takeNewlyDone(seenStatus, plan.nodes)
    const fg = fgRef.current
    if (!fg || ids.length === 0 || prefersReducedMotion()) return
    const scene = fg.scene()
    const camera = fg.camera()
    const rings = ids.flatMap(id => {
      const node = cache.get(id)
      if (!node) return []
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(28, 31, 64),
        new THREE.MeshBasicMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
      )
      ring.position.set(node.x ?? 0, node.y ?? 0, node.z ?? 0)
      ring.quaternion.copy(camera.quaternion)
      scene.add(ring)
      return [ring]
    })
    const start = performance.now()
    // No cleanup: the burst is one-shot and removes itself. Under StrictMode the effect re-runs,
    // and a cleanup would cancel the ring on the first run while the second run sees no change.
    const tick = (t: number) => {
      const f = burstFrame(t - start)
      for (const r of rings) {
        r.scale.setScalar(f.scale)
        r.material.opacity = f.opacity
      }
      if (!f.done) {
        requestAnimationFrame(tick)
        return
      }
      for (const r of rings) {
        scene.remove(r)
        r.geometry.dispose()
        r.material.dispose()
      }
    }
    requestAnimationFrame(tick)
  }, [plan, seenStatus, cache])

  // A click on empty canvas, or on a dependency line (which counts as empty canvas).
  const onEmptyCanvasClick = (e: MouseEvent) => {
    // The press that closed a deck's list only closes it.
    // (a click without a pointer id is taken as that press's: any later press has cleared it already)
    const closer = listClosedOnCanvas.current
    if (closer !== null && ((e as Partial<PointerEvent>).pointerId ?? closer) === closer) {
      listClosedOnCanvas.current = null
      return
    }
    const onText = selectedId !== null && onSelectedText(labels, selectedId, e.clientX, e.clientY)
    const action = backgroundAction({ shift: e.shiftKey, arming: false, linking: false, onText, detail: Math.max(e.detail, pressDetail.current) })
    if (action === 'ignore') return
    // anything else but a click on the selected step's text deselects ('add' included: the viewer adds nothing)
    if (action !== 'selected' || selectedId === null) onSelect(null)
    // a click on the selected step's text is one on that step (never a deck)
    else onPick(selectedId)
  }

  // How one edge is drawn now, its laid-out waypoints with it. A new function only when what an edge looks like
  // changes: the graph library builds every line again whenever it gets a new one (linkThreeObject below), so a render
  // that changes none of this (a camera move, the bottom card's height) builds none.
  const edgeDraw = useCallback(
    (source: string, target: string): { points: Pt[]; draw: EdgeDraw } | null => {
      const edge = edgeByKey.get(edgeKey(source, target))
      if (!edge) return null
      const role = linkRole(source, target, selectedId, chain, hoveredId)
      const style = linkStyle(role, (deckViews.get(source)?.state ?? states.get(source)) === 'done', edge.redundant)
      // Highlighted edges sit in front of plain ones, implied ones behind.
      const z = role === 'none' || role === 'other' ? (edge.redundant ? -2 : 0) : 1
      const ends = { start: scales.get(source) ?? 1, end: scales.get(target) ?? 1 }
      return { points: edge.points, draw: { style, cardScale, view: size, z, scales: ends, opacity: edgeOpacity(hazes.get(source) ?? 1, hazes.get(target) ?? 1, role) } }
    },
    [edgeByKey, selectedId, chain, hoveredId, deckViews, states, scales, cardScale, size, hazes],
  )
  const edgeDrawRef = useRef(edgeDraw)
  useEffect(() => {
    edgeDrawRef.current = edgeDraw
  })
  // One edge as drawn now; `points` overrides the laid-out waypoints (a glide in flight). It notes the edgeDraw it was
  // drawn by, so a glide's frame moves it in place while that still holds (reshapeEdge).
  const buildEdge = useCallback(
    (source: string, target: string, points?: Pt[]): THREE.Object3D | null => {
      const look = edgeDraw(source, target)
      if (!look) return null
      meter.count('edgeObjects')
      const obj = edgeObject(points ?? look.points, look.draw, edgeMats)
      obj.userData.drawnBy = edgeDraw
      return obj
    },
    [edgeDraw, meter, edgeMats],
  )
  const buildEdgeRef = useRef(buildEdge)
  useEffect(() => {
    buildEdgeRef.current = buildEdge
  })

  // Where each drawn node and edge is on screen right now, so the next layout can glide from there.
  const shownNodes = useRef(new Map<string, Pt>())
  const shownEdges = useRef(new Map<string, Pt[]>())
  const tweening = useRef(false)
  const lastPlanKey = useRef<string | null>(null)
  const lastHidden = useRef(view.hidden)
  const glide = useRef(0)
  // A new layout over the same plan (a different selection, the flag) glides to its slots over TWEEN_MS;
  // a new plan structure, the first layout and reduced motion snap.
  useEffect(() => {
    cancelAnimationFrame(glide.current)
    const planKey = structureKey(plan.nodes)
    const fresh = lastPlanKey.current !== planKey || prefersReducedMotion()
    const before = shownNodes.current
    const beforeEdges = shownEdges.current
    const beforeHidden = lastHidden.current
    lastPlanKey.current = planKey
    lastHidden.current = view.hidden

    const dependents = new Map<string, string[]>()
    for (const n of plan.nodes) for (const d of n.depends_on) dependents.set(d, [...(dependents.get(d) ?? []), n.id])
    const to = new Map<string, Pt>([...layout.nodes].map(([id, p]) => [id, { x: p.x, y: p.y }]))
    const from = new Map<string, Pt>([...to].map(([id, p]) => [id, fresh ? p : originOf(id, before, beforeHidden, d => dependents.get(d) ?? []) ?? p]))
    shownNodes.current = new Map(to)
    shownEdges.current = new Map(layout.edges.map(e => [edgeKey(e.source, e.target), e.points]))
    tweening.current = false
    const moves = !fresh && [...to].some(([id, p]) => from.get(id)!.x !== p.x || from.get(id)!.y !== p.y)
    // a new layout drawn at once over one drawn before (a step added or removed) is a transition too, for the meter
    if (fresh && before.size > 0) meter.begin('snap')
    else if (!moves) meter.forgetLayouts()
    if (!moves) return

    // `drawn`: called from an animation frame. The first step is applied at once, in this effect, before any frame
    // draws it: its ms go into the next frame drawn (meter.carry), so a recording counts only the frames drawn.
    const apply = (t: number, drawn: boolean) => {
      const at = frameAt()
      const time = (part: 'tween' | 'edges', ms: number) => (drawn ? meter.add(part, ms, at) : meter.carry(part, ms))
      const t0 = performance.now()
      const now = new Map<string, Pt>()
      for (const [id, p] of to) {
        const at = tween(from.get(id)!, p, t)
        now.set(id, at)
        const node = cache.get(id)
        if (!node) continue
        node.x = node.fx = at.x
        node.y = node.fy = -at.y
        ;(node as unknown as { __threeObj?: THREE.Object3D }).__threeObj?.position.set(at.x, -at.y, 0)
      }
      shownNodes.current = now
      const t1 = performance.now()
      time('tween', t1 - t0)
      const edges = new Map<string, Pt[]>()
      for (const e of layout.edges) {
        const key = edgeKey(e.source, e.target)
        const ends = { sourceFrom: from.get(e.source)!, sourceTo: to.get(e.source)!, targetFrom: from.get(e.target)!, targetTo: to.get(e.target)! }
        edges.set(key, tweenEdge(e.points, beforeEdges.get(key), ends, t))
      }
      shownEdges.current = edges
      // Each edge is moved in place while it is drawn as it was built (no new object, nothing new for the GPU); one
      // whose look changed meanwhile (a hover, a new selection) or whose shape gained or lost a point is built afresh.
      const draw = edgeDrawRef.current
      for (const l of data.links) {
        const source = idOf(l.source)
        const target = idOf(l.target)
        const obj = (l as unknown as { __lineObj?: THREE.Object3D }).__lineObj
        const points = edges.get(edgeKey(source, target))
        if (obj) glideEdge(obj, points, draw, () => buildEdgeRef.current(source, target, points), source, target)
      }
      time('edges', performance.now() - t1)
    }
    meter.begin('layout')
    tweening.current = true
    apply(0, false)
    const start = performance.now()
    const step = (nowMs: number) => {
      const t = Math.min(1, (nowMs - start) / TWEEN_MS)
      apply(t, true)
      if (t < 1) glide.current = requestAnimationFrame(step)
      else tweening.current = false
    }
    glide.current = requestAnimationFrame(step)
    // Only a new layout starts a glide. `data` and `view` (and `plan`) are read as they are at that moment: `data` is
    // rebuilt from this same layout and `view` produced it, so both belong to it; a status or title edit changes `plan`
    // without moving anything, and re-running on it would restart the glide.
  }, [layout]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => cancelAnimationFrame(glide.current), [])

  // Titles that would be drawn over each other are cut to one line or hidden (titleFit.ts), decided again on the
  // second still frame after anything moves or changes (measuring what changed), and at most every TITLE_FIT_MS while
  // the user moves the view (from what was measured, nothing drawn afresh). During a glide only once per change (a new
  // selection), from saved shapes; never in the frame new labels arrive: they draw first, the fit follows.
  useEffect(() => {
    let raf = 0
    const last = { x: NaN, y: NaN, z: NaN, w: 0, h: 0 }
    let still = 0
    let pending = true
    let lastRun = -Infinity
    let lastStep = NaN
    let connected = -1
    const layer = extraRenderers[0].domElement
    // A web font swapping in changes how every title draws: measure them again (a font the titles do not draw with,
    // such as the dev overlay's, changes none).
    const stopFonts = watchFonts(
      () => (fitDirty.current = true),
      undefined,
      () => getComputedStyle(layer).fontFamily,
    )
    const setBoost = (boost: number) => {
      layer.style.setProperty('--title-boost', boost.toFixed(4))
      lastStep = boostStep(boost)
    }
    const run = (now: number, boost: number, measure: boolean, ppu: number) => {
      setBoost(boost)
      fitRuns.current++
      const fresh = measure && fitFresh.current
      if (fresh) fitFresh.current = false
      const ms = runTitleFit(labels, labelRanks(fitNodes.current, fitFocus.current, fitTop.current), boost, measure, ppu, plateArea.current(), fresh, fitArrows.current)
      // the plate or the shown words may have moved: a hovered neighbour is drawn over the plate only while they cross
      refreshOverPlate(labels.values())
      lastRun = now
      if (rootRef.current) rootRef.current.dataset.titleFitMs = ms.toFixed(2)
      // the first measure is one that saw a label drawn (or a plan with no steps), not one run before any arrived
      if (measure && !titlesMeasured.current && (layoutRef.current.nodes.size === 0 || [...labels.values()].some(el => el.isConnected))) {
        titlesMeasured.current = true
        // the first fit, out of the graph's frame (it moves the camera, reading only data the fit kept)
        queueMicrotask(() => afterMeasure.current())
      }
    }
    // The fit's share of a frame, reading before it writes. The brackets' pass on a glide's frame reads the page as
    // last laid out, so the frame's --label-scale and the words' boost are written after it (scaleTick, setBoost); a fit
    // run measures, laying the page out anyway, so the scale is written before it and it measures at this frame's size.
    const fitTick = (now: number) => {
      const camera = fgRef.current?.camera() as THREE.PerspectiveCamera | undefined
      if (!camera || camera.position.z <= 0) return
      const ppu = pxPerUnit(camera.position.z, camera.fov, sizeRef.current.h)
      const boost = titleBoost(labelScale(ppu))
      // The words' size moves in boost steps between fit runs, so the labels are not restyled every frame.
      const restyle = () => {
        if (boostStep(boost) !== lastStep) setBoost(boost)
      }
      // Labels the renderer has just put on the page are fitted once they have drawn.
      let n = 0
      for (const el of labels.values()) if (el.isConnected) n++
      const arrived = n !== connected
      if (arrived) fitDirty.current = true
      connected = n
      const p = camera.position
      const { w, h } = sizeRef.current
      const gliding = tweening.current
      // a camera creeping by under half a px (a zoom easing out) counts as still, so the fit measures again soon
      const moving = gliding || viewMoved(last, { x: p.x, y: p.y, z: p.z, w, h }, camera.fov)
      if (moving) Object.assign(last, { x: p.x, y: p.y, z: p.z, w, h })
      const dirty = fitDirty.current
      still = moving || dirty ? 0 : still + 1
      if (moving || dirty) pending = true
      fitDirty.current = false
      // for the e2e specs (e2e/helpers.ts waitForStill): written on the root from here, a ref write with no render
      const root = rootRef.current
      if (root) {
        // a plan with steps is not still before its first title is on the page (the load fit waits on one)
        const labelsPending = n === 0 && layoutRef.current.nodes.size > 0
        const rest = String(
          isStill({ gliding: gliding || cameraGlide.active(), dragging: dragging.current, resizing: !!resizing.current?.pending(), labelsPending, still }),
        )
        if (root.dataset.still !== rest) root.dataset.still = rest
      }
      if (!pending) return restyle()
      if (still >= 2) {
        scaleTick.current?.()
        run(now, boost, true, ppu)
        pending = false
      } else if (moving && (gliding ? dirty && !arrived : now - lastRun >= TITLE_FIT_MS)) {
        scaleTick.current?.()
        run(now, boost, false, ppu)
      }
      // During a glide only a change (a new selection, its chain) is fitted, once and from saved shapes, so the old
      // fit does not stand around the new plate; nothing is measured afresh until the glide ends, and never in the
      // frame new labels arrive. The selected brackets and plate alone follow the circles every frame of it.
      else if (gliding) {
        fitBrackets(labels, plateArea.current())
        restyle()
      } else restyle()
    }
    // The graph's frame, on every animation frame, after the renderer has moved the labels to where the camera puts
    // them: the reads first (an open deck list measuring its deck, then the fit's share), then the writes (the list's
    // place, the frame's --label-scale for the camera the renderer drew with, the edge cues, which read nothing laid
    // out), then the selected plate's holes aimed at this frame's circles at that scale (aimPlateHoles, which reads
    // nothing laid out either). The writes run even if a read throws, so the cards keep following the zoom.
    // Each part is timed for the glide meter (the fit's share apart from the rest), and the frame that finds nothing
    // moving any more ends its recording, written to data-glide.
    const tick = function zoomFrame(now: number) {
      raf = requestAnimationFrame(tick)
      const at = frameAt()
      const t0 = performance.now()
      let fitMs = 0
      let placeList: (() => void) | undefined
      try {
        runFrame(
          [
            () => (placeList = listFrame.current?.()),
            () => {
              const f0 = performance.now()
              try {
                fitTick(now)
              } finally {
                fitMs = performance.now() - f0
              }
            },
          ],
          [() => placeList?.(), () => scaleTick.current?.(), () => cueTick.current?.(), () => aimPlateHoles(labels)],
        )
      } finally {
        meter.add('titleFit', fitMs, at)
        meter.add('overlay', performance.now() - t0 - fitMs, at)
        const done = meter.settle(tweening.current || cameraGlide.active(), at)
        if (done) {
          if (rootRef.current) rootRef.current.dataset.glide = JSON.stringify(done)
          glidesRef.current?.(meter.history())
        }
      }
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      stopFonts()
    }
  }, [extraRenderers, labels, cameraGlide, meter])

  // The step with the keyboard focus ranks above the rest for its title (titleFit.ts).
  const onFocusChange = (e: React.FocusEvent, focused: boolean) => {
    fitFocus.current = focused ? ((e.target as Element).closest?.('.node-label')?.getAttribute('data-node-id') ?? null) : null
    fitDirty.current = true
    // a title shown by the focus is drawn over the selected plate where it crosses it, as on hover
    refreshOverPlate(labels.values())
    if (focused) revealFocused(e.target as Element)
  }
  // A label the keyboard focuses (:focus-visible: Tab; a click's focus leaves the camera to the selection's frame) that
  // lies even in part outside the free area the frames keep (off the window, or under the legend or the host's chrome)
  // is brought in by a pan at the same zoom, the shortest that puts it whole in
  // that area the frames' pad clear of the edge it crossed (reveal.ts), over a frame's glide time. A camera glide under
  // way (a frame, a fit, a fly, a pan like this one) is let finish and nothing more moves; so is a drag.
  const revealFocused = (el: Element) => {
    if (!el.matches?.('.node-label:focus-visible') || cameraGlide.active() || dragging.current) return
    const fg = fgRef.current
    const root = rootRef.current?.getBoundingClientRect()
    const camera = fg?.camera() as THREE.PerspectiveCamera | undefined
    if (!fg || !root || !camera || !(camera.position.z > 0)) return
    const { w, h } = sizeRef.current
    const strips = frameInsets(sizeRef.current, insets)
    const area = { left: root.left + strips.left, top: root.top + strips.top, right: root.left + w - strips.right, bottom: root.top + h - strips.bottom }
    const target = (fg.controls() as unknown as { target: THREE.Vector3 }).target
    const at = {
      position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      lookAt: { x: target.x, y: target.y, z: target.z },
    }
    const to = panToReveal(el.getBoundingClientRect(), area, { x: FRAME.fitPad * w, y: FRAME.fitPad * h }, at, pxPerUnit(camera.position.z - target.z, camera.fov, h))
    if (to) moveCamera(to.position, to.lookAt, FRAME.fitMs)
  }

  // The label whose circle the pointer is on shows its words whole if they are cut or hidden (data-hovered, globals.css).
  const revealed = useRef<HTMLElement | null>(null)
  const reveal = (el: HTMLElement | null) => {
    if (revealed.current === el) return
    if (revealed.current) delete revealed.current.dataset.hovered
    if (el) el.dataset.hovered = 'true'
    revealed.current = el
    refreshOverPlate(labels.values())
  }
  const onPointerOver = (e: React.PointerEvent) => {
    const card = (e.target as Element).closest?.('.node-label')
    setHoveredId(card?.getAttribute('data-node-id') ?? null)
    reveal(((e.target as Element).closest?.('.node-dot, .node-deck-dot')?.closest('.node-label') as HTMLElement | null) ?? null)
  }

  // Marked chain steps past the edges of the free area (the frame holds one hop each way): a quiet cue at each edge
  // they lie past says how many (ChainEdgeCue.tsx). The free area is the one a selection is framed in, from the host's
  // insets (no layout read); the scene is where the chain's circles and every card are drawn now,
  // projected from the camera, read on the frame tick.
  const cueStrips = frameInsets(size, insets)
  const cueArea = useMemo(
    // above the bottom card, unless that card is about as tall as the window: then down to its bottom edge, the card a
    // cover over the area (cueAreaBottom)
    () => ({
      left: cueStrips.left,
      top: cueStrips.top,
      right: size.w - cueStrips.right,
      bottom: cueAreaBottom(cueStrips.top, size.h - (cueStrips.bottom - FRAME.hudGap), size.h - FRAME.hudBottom),
    }),
    [cueStrips.left, cueStrips.top, cueStrips.right, cueStrips.bottom, size.w, size.h],
  )
  // The host's toolbar and panel as boxes (insetBoxes), which the edge cues and a deck's list keep clear of.
  const chrome = useMemo(() => insetBoxes(size, insets), [size, insets])
  // What the graph library draws for a node and for a link. It builds every node's or every link's object again
  // whenever it is handed a new function for them, so each is a new function only when what it draws changes: a node's
  // card never (its label is kept in `labels` and redrawn by syncLabels), a link's when buildEdge is. So a node still
  // drawn keeps the label element it was built with; a new element for it would not be attached until it leaves and
  // comes back, which cannot happen today: syncLabels drops an element only when its node leaves the drawn set, the same
  // change in which the library takes the node off.
  const nodeObject = useCallback(
    (n: GraphNode) => {
      meter.count('nodeObjects')
      // The node is its card: an HTML label centred on the node position. No mesh.
      const group = new THREE.Group()
      const label = new CSS2DObject(labelFor(labels, n.id, onPick))
      label.center.set(0.5, 0.5)
      group.add(label)
      // Three only tells the removed object (this group), not the label inside it, so a card whose node left
      // the graph (folded into a deck) would stay in the DOM: the renderer puts it back after syncLabels dropped it.
      group.addEventListener('removed', () => {
        if (labels.get(n.id) !== label.element) label.element.remove()
      })
      return group
    },
    [labels, onPick, meter],
  )
  const linkObject = useCallback(
    (l: GraphLink) => {
      const source = idOf(l.source)
      const target = idOf(l.target)
      // While a glide is running a rebuilt edge starts from where it is drawn now, not from its final shape.
      return buildEdge(source, target, tweening.current ? shownEdges.current.get(edgeKey(source, target)) : undefined) ?? new THREE.Group()
    },
    [buildEdge],
  )
  const cueScene = useRef<() => CueScene | null>(() => null)
  useEffect(() => {
    const marked = [...[...chain.upstream].map(id => ({ id, kind: 'up' as const })), ...[...chain.downstream].map(id => ({ id, kind: 'down' as const }))]
    cueScene.current = () => {
      const camera = fgRef.current?.camera() as THREE.PerspectiveCamera | undefined
      const { w, h } = sizeRef.current
      if (selectedId === null || !camera || !(camera.position.z > 0) || !(w > 0 && h > 0)) return null
      const toScreen = (x: number, y: number) => {
        const v = new THREE.Vector3(x, y, 0).project(camera)
        return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h }
      }
      // every drawn node's position, so a glide (the camera still, the nodes moving) is seen too
      let key = `${selectedId},${camera.position.x},${camera.position.y},${camera.position.z},${w},${h}`
      const points: CuePoint[] = []
      for (const m of marked) {
        const n = cache.get(view.hidden.get(m.id)?.[0] ?? m.id)
        if (n?.x === undefined || n.y === undefined) continue
        points.push({ ...toScreen(n.x - LAYOUT.cardW / 2 + DOT.cx, n.y), kind: m.kind })
      }
      // Each card: its slot's centre on screen (its node) and labelScale(ppu) screen px per card px times its due-date
      // size; the cue layer knows what each draws around that centre (measured at rest, else estimated).
      const s = labelScale(pxPerUnit(camera.position.z, camera.fov, h))
      const cards = []
      for (const d of view.nodes) {
        const n = cache.get(d.id)
        if (n?.x === undefined || n.y === undefined) continue
        key += `|${n.x},${n.y}`
        cards.push({ id: d.id, ...toScreen(n.x, n.y), k: s * (scales.get(d.id) ?? 1) })
      }
      return { key, points, cards, selected: selectedId }
    }
  })
  return (
    <div
      ref={rootRef}
      data-testid="graph"
      data-still="false"
      className="isolate"
      style={{ cursor: 'default' }}
      onPointerOver={onPointerOver}
      onPointerLeave={() => {
        setHoveredId(null)
        reveal(null)
      }}
      onFocus={e => onFocusChange(e, true)}
      onBlur={e => onFocusChange(e, false)}
    >
      <ChainEdgeCues active={selectedId !== null} area={cueArea} scene={cueScene} tickRef={cueTick} labels={labels} boxes={chrome} panelState={String(insets.right)} words={fitRuns} />
      <ForceGraph3D<GraphNode, GraphLink>
        ref={fgRef}
        width={size.w}
        height={size.h}
        graphData={data}
        backgroundColor="#05060a"
        numDimensions={2}
        cooldownTicks={0}
        enableNodeDrag={false}
        showNavInfo={false}
        onEngineStop={onEngineStop}
        extraRenderers={extraRenderers}
        nodeThreeObject={nodeObject}
        nodeThreeObjectExtend={false}
        linkThreeObject={linkObject}
        linkPositionUpdate={() => true}
        // The selected step's title and due line take no pointer (a neighbour's circle under them keeps the click), so a
        // click on them lands here: it is a click on that step, picked as its label would be, not a background click.
        onBackgroundClick={onEmptyCanvasClick}
        // A dependency line is empty canvas for a click: the library sends one on a line to this prop, not the one above.
        onLinkClick={(_l: GraphLink, e: MouseEvent) => onEmptyCanvasClick(e)}
      />
      {listDeck && listLook && (
        <DeckList
          key={listDeck.id}
          deckId={listDeck.id}
          title={listLook.title}
          mix={listLook.mix}
          rows={listRows}
          anchor={listAnchor}
          frameRef={listFrame}
          linking={false}
          around={chrome}
          onPick={id => {
            // The focus goes on to the step picked, once it is drawn.
            listExit.current = true
            focusSoon([id])
            pick.current(id)
          }}
          onOpenBranch={() => {
            listExit.current = true
            focusSoon([listDeck.parentId])
            pick.current(listDeck.parentId)
          }}
          onClose={closeList}
          onFocusLost={() => {
            if (!listExit.current) focusSoon([listDeck.parentId, selectedId])
          }}
        />
      )}
    </div>
  )
}
