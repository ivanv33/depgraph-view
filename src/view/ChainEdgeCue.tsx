import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { CUE_INSET, OVERDUE_RING, cardBox, cueSize, dropGone, edgeCues, extentOf, placeCues, type CardAt, type Cover, type CuePoint, type EdgeCue } from '../engine/edgeCue.js'
import { linkStyle } from '../engine/linkStyle.js'
import type { Box } from '../engine/deckList.js'

type Area = { left: number; top: number; right: number; bottom: number }
/**
 * Where the marked chain's circles and every drawn card are on screen now (graph px), read with no layout of the page,
 * and which card is the selected step's (`selected`), which no pill may lie on.
 */
export type CueScene = { key: string; points: CuePoint[]; cards: CardAt[]; selected?: string }

/** How long the view rests (no camera or node move) before the cards near the edges are measured, in ms. */
const REST_MS = 120
/** How far in from an edge of the free area a card is measured: past the deepest band a pill takes there. */
const NEAR = 160

/**
 * What a label draws, as boxes in the window: its circle, words, date and marks (not the 150 px text block they sit in,
 * which is wider than most titles), and on the selected step the plate behind its words. An overdue step's circle
 * takes its red ring too: OVERDUE_RING css px, drawn `k` screen px per card px as the whole card is (a CSS zoom, so
 * the circle's own CSS size cannot tell its scale).
 */
export function drawnParts(el: HTMLElement, k: number): Area[] {
  const selected = el.dataset.selected === 'true'
  const overdue = el.dataset.overdue === 'true'
  return [...el.querySelectorAll<HTMLElement>('.node-card *')]
    .filter(p => selected || !p.classList.contains('node-label-text'))
    .map(p => {
      const r = p.getBoundingClientRect()
      if (!overdue || !p.classList.contains('node-dot')) return r
      const pad = OVERDUE_RING * k
      return { left: r.left - pad, top: r.top - pad, right: r.right + pad, bottom: r.bottom + pad }
    })
}

const ARROW = { top: '↑', bottom: '↓', left: '←', right: '→' } as const
const WHERE = { top: 'above', bottom: 'below', left: 'to the left', right: 'to the right' } as const

/** The colour of the line that runs off at that edge: a need's, a dependent's, or the plain one when both run off. */
const colourOf = (kind: EdgeCue['kind']) => (kind === 'up' ? linkStyle('upstream', false).color : kind === 'down' ? linkStyle('downstream', false).color : linkStyle('hover', false).color)

/**
 * The cues at the edges of the free area (`area`, graph px) for marked chain steps past them (edgeCue.ts). They are
 * worked out on the graph's own frame tick (`tickRef`, called every animation frame), only when what `scene` reads has
 * changed (the camera, the window, a glide), from where the circles and cards are drawn (projected, not measured), so
 * they follow a glide frame by frame and force no layout; only this small layer re-renders. What each card draws
 * around its centre (its circle and words) is measured apart, once the view rests, for the cards near the edges. A
 * pill sits on its line unless a card's circle or words or the chrome is there: then it moves the least it can, along
 * its edge or just inside the host's panel lying on its place (placeCue). A marked step whose circle is hidden under
 * the host's toolbar or panel (`boxes`, from its insets) counts as past the edge too.
 */
export default function ChainEdgeCues({
  active,
  area,
  scene,
  tickRef,
  labels,
  boxes,
  panelState = '',
  words,
}: {
  active: boolean
  area: Area
  scene: RefObject<() => CueScene | null>
  tickRef: RefObject<(() => void) | null>
  labels: ReadonlyMap<string, HTMLElement>
  /** The host's chrome over the graph, in graph px (insetBoxes): kept clear, and a step under it counts as past the edge. */
  boxes: { toolbar?: Box; panel?: Box }
  /** Changes when the host's panel opens or closes: the cues are placed and the cards measured again. */
  panelState?: string
  /**
   * A count that changes whenever the cards' words may have changed with no view move (the graph's title fit ran: a
   * plan edit, a font swapped in, a title cut or shown): read on the frame tick, it asks for the cards to be measured
   * again once REST_MS passes with no further change.
   */
  words?: RefObject<number>
}) {
  const [cues, setCues] = useState<EdgeCue[]>([])
  // The host's toolbar and panel, where they lie over the graph, are kept clear too (given, not measured here).
  const { toolbar, panel } = boxes
  const inputs = useRef({ active, area, panel, toolbar })
  const lastScene = useRef('')
  const lastCues = useRef('')
  // What each card draws around its slot's centre, in card px (extentOf): measured once the view rests, for the cards
  // near the edges, so a pill keeps clear of the words actually there rather than of the whole slot. Until a card is
  // measured (and while a glide carries it, between rests) its last measure or the generous estimate stands.
  const extents = useRef(new Map<string, Area>())
  // where the cards stood, to the whole px, when a measure was last asked for: the camera eases to a stop by ever
  // smaller steps, so the exact scene key never rests, but this does
  const restKey = useRef('')
  const restTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    inputs.current = { active, area, panel, toolbar }
    lastScene.current = '' // read again on the next frame
    restKey.current = '' // and measured again once it rests: the area's edges, and so the cards near them, moved
  }, [active, area, panel, toolbar, panelState])
  useEffect(() => {
    // read when the view has rested REST_MS, never on the frame tick: the page is laid out once for these reads
    const measureCards = () => {
      const s = inputs.current.active ? scene.current?.() : null
      if (!s) return
      const { area } = inputs.current
      dropGone(extents.current, s.cards)
      for (const c of s.cards) {
        const b = cardBox(c, extents.current.get(c.id))
        if (b.right < area.left || b.left > area.right || b.bottom < area.top || b.top > area.bottom) continue
        if (b.left > area.left + NEAR && b.right < area.right - NEAR && b.top > area.top + NEAR && b.bottom < area.bottom - NEAR) continue
        const el = labels.get(c.id)
        const e = el ? extentOf(drawnParts(el, c.k), c) : null
        if (e) extents.current.set(c.id, e)
      }
      lastScene.current = '' // placed again on the next frame
    }
    const ask = () => {
      clearTimeout(restTimer.current)
      restTimer.current = setTimeout(measureCards, REST_MS)
    }
    let lastWords = words?.current
    tickRef.current = function edgeCueTick() {
      const { active, area, panel, toolbar } = inputs.current
      // words changed where nothing moved: measure again once they settle (a number read, no layout)
      if (words && words.current !== lastWords) {
        lastWords = words.current
        if (active) ask()
      }
      const s = active ? scene.current?.() : null
      const sceneKey = s ? s.key : ''
      if (sceneKey === lastScene.current) return
      lastScene.current = sceneKey
      if (s) {
        const rest = s.cards.map(c => `${Math.round(c.x)},${Math.round(c.y)},${Math.round(c.k * 100)}`).join('|')
        if (rest !== restKey.current) {
          restKey.current = rest
          ask()
        }
      }
      // a marked step whose circle is hidden under the chrome over the free area counts as past its edge (edgeCues)
      const covers: Cover[] = [toolbar, panel].filter(b => b !== undefined)
      // the pill keeps clear of the cards as drawn, and is seen: moved along its edge or just inside a cover (placeCue);
      // never on the selected step nor on another pill (placeCues)
      const boxes = s ? s.cards.map(c => cardBox(c, extents.current.get(c.id))) : []
      const selected = s ? s.cards.findIndex(c => c.id === s.selected) : -1
      const next = s
        ? placeCues(edgeCues(s.points, area, covers), area, boxes, covers, selected < 0 ? [] : [boxes[selected]])
            .map(c => ({ ...c, at: Math.round(c.at), ...(c.inset === undefined ? {} : { inset: Math.round(c.inset) }) }))
        : []
      const key = JSON.stringify(next)
      if (key === lastCues.current) return
      lastCues.current = key
      setCues(next)
    }
    return () => {
      tickRef.current = null
      clearTimeout(restTimer.current)
    }
  }, [scene, tickRef, labels, words])
  // Placed from the graph's top left corner: this zero-size box sits there, first in the graph.
  return <div className="relative h-0 w-0">{active && cues.map(c => <Pill key={c.side} cue={c} area={area} />)}</div>
}

/**
 * A small pill at the edge of the free area where marked chain steps lie past it: an arrow pointing their way and how
 * many ("↑ 14 more"), in the colour of the marked line that runs off there. It takes no pointer.
 */
function Pill({ cue, area }: { cue: EdgeCue; area: Area }) {
  const colour = colourOf(cue.kind)
  const { w, h } = cueSize(cue.count)
  const inset = cue.inset ?? CUE_INSET
  const place: CSSProperties =
    cue.side === 'top'
      ? { left: cue.at - w / 2, top: area.top + inset }
      : cue.side === 'bottom'
        ? { left: cue.at - w / 2, top: area.bottom - inset - h }
        : cue.side === 'left'
          ? { left: area.left + inset, top: cue.at - h / 2 }
          : { left: area.right - inset - w, top: cue.at - h / 2 }
  return (
    <div
      data-testid="edge-cue"
      data-side={cue.side}
      data-count={cue.count}
      data-kind={cue.kind}
      role="note"
      aria-label={`${cue.count} more marked ${cue.count === 1 ? 'step' : 'steps'} ${WHERE[cue.side]}`}
      className="pointer-events-none absolute z-[5] box-border flex items-center justify-center whitespace-nowrap rounded-full font-mono text-[11px] leading-4"
      style={{ ...place, width: w, height: h, color: colour, background: 'rgba(5, 6, 10, 0.78)', border: `1px solid ${colour}55` }}
    >
      {ARROW[cue.side]} {cue.count} more
    </div>
  )
}
