import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { STATE_NAME, STATE_SWATCH } from './Legend.js'
import PriorityMark from './PriorityMark.js'
import { freeArea, LIST_SIZE, placeDeckList, type Box, type DeckRow } from '../engine/deckList.js'
import { PRIORITY_NAME } from '../engine/priorityMark.js'
import type { NodeState } from '../engine/readiness.js'
import { FRAME } from '../engine/frame.js'

interface DeckListProps {
  /** The deck's id ("deck:x"); the list's element id is deckListId(deckId), which the deck's label points at. */
  deckId: string
  /** "23 steps" */
  title: string
  /** How many steps are in each state, when mixed. */
  mix: { state: NodeState; n: number }[]
  rows: DeckRow[]
  /** The deck's label on screen: the list stays beside it as the view moves. */
  anchor: () => HTMLElement | undefined
  /**
   * Where the list hands the graph its read of the deck, which the graph's frame runs ahead of its own writes (the
   * frame's --label-scale) and which hands back the list's place, written after them (Graph.tsx zoomFrame).
   */
  frameRef: RefObject<DeckListFrame | null>
  /** The host's chrome over the graph, in window px (insetBoxes): the list stays clear of it. */
  around: { toolbar?: Box; panel?: Box; hud?: Box }
  /** A step is being picked to link to: the list says so, and offers no branch to open. */
  linking?: boolean
  /** Whether the host shows its Legend in the bottom-left corner (default true): the list stays clear of it only then. */
  legend?: boolean
  onPick: (id: string) => void
  /** Select the step the deck hangs from, which draws its whole branch (a branch deck only). */
  onOpenBranch?: () => void
  /**
   * Close the list: `refocus` gives the focus back to the deck; `target` is what a press outside the list landed on
   * (`pointerId` the press), or where the focus went when it left the list for another control.
   */
  onClose: (refocus: boolean, target?: EventTarget | null, pointerId?: number) => void
  /** The list went away with the focus in it, closed by nothing above (its deck is no longer drawn): put the focus somewhere. */
  onFocusLost: () => void
}

/**
 * An open list's share of the graph's frame: it reads where the deck is drawn (nothing, when nothing it depends on
 * moved) and returns the writes that place the list there, or nothing to write.
 */
export type DeckListFrame = () => (() => void) | undefined

/** The element id of a deck's list. */
export const deckListId = (deckId: string) => `deck-list-${deckId.replace(/[^A-Za-z0-9_-]/g, '_')}`

const rect = (el: Element | null | undefined): Box | undefined => {
  if (!el) return undefined
  const r = el.getBoundingClientRect()
  return r.width > 0 || r.height > 0 ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : undefined
}

/**
 * The fixed Legend's box in the bottom-left corner (`left-4`, `bottom-16`, its top edge FRAME.legendTop above the
 * bottom, as the frame keeps it clear), or none on a view narrower than FRAME.legendShowW, where it is hidden.
 */
const legendBox = (view: { w: number; h: number }): Box[] =>
  view.w >= FRAME.legendShowW ? [{ left: 16, top: view.h - FRAME.legendTop, right: FRAME.leftInset, bottom: view.h - 64 }] : []

/** A state's colour as text: the legend's swatch, but done's swatch is too dark to read as text. */
const textColour = (s: NodeState) => (s === 'done' ? undefined : STATE_SWATCH[s])

/**
 * A deck's steps, listed in place beside it: every one, with its state and date; a row selects that step. It closes
 * with Escape, a press anywhere else, a second click on the deck, or the focus moving on to another control (the
 * search, say). It sits in the free part of the window (never under the host's toolbar or panel,
 * `around`, nor the Legend) and scrolls when it is longer than that; the wheel over it scrolls it and never zooms
 * the graph.
 */
export default function DeckList({ deckId, title, mix, rows, anchor, frameRef, around, linking = false, legend = true, onPick, onOpenBranch, onClose, onFocusLost }: DeckListProps) {
  const box = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const close = useRef(onClose)
  const lost = useRef(onFocusLost)
  const deckEl = useRef(anchor)
  const aroundRef = useRef(around)
  const legendRef = useRef(legend)
  useEffect(() => {
    close.current = onClose
    lost.current = onFocusLost
    deckEl.current = anchor
    aroundRef.current = around
    legendRef.current = legend
  })

  // Follow the deck (the view pans and zooms under it), kept inside the free area. Measuring is skipped on a frame where
  // nothing it depends on moved: the deck's own position (its transform) and the zoom, the window's size, and the size
  // of the list (watched by a ResizeObserver) and what it keeps clear of (`around`). The graph's frame runs the measuring first,
  // before it writes the frame's --label-scale, and the list's place after that write, so a moving frame lays nothing
  // out: the deck is read where the renderer has just put it, at the size it was last drawn (the next frame places the
  // list again for a new zoom).
  useLayoutEffect(() => {
    let dirty = true
    let last = ''
    let watchedDeck: Element | null = null
    let watchedParts: Element[] = []
    // The first row takes the focus once the list is shown (a hidden one cannot take it; a deck drawn anew is placed a
    // frame or two late), so the keyboard goes on from the deck into its list.
    let focused = false
    const watch = new ResizeObserver(() => {
      dirty = true
    })
    for (const el of [box.current, list.current]) if (el) watch.observe(el)
    const place: DeckListFrame = function deckListPlace() {
      const el = box.current
      const deck = deckEl.current()
      if (!el || !deck) return undefined
      // The deck label's own size too: its circle and text are watched, and its near scale is in the key, so a plan
      // change that resizes the label while the list is open places the list again without a pan.
      if (deck !== watchedDeck) {
        for (const part of watchedParts) watch.unobserve(part)
        watchedParts = [deck, deck.querySelector('.node-dot'), deck.querySelector('.node-label-text')].filter((p): p is Element => !!p)
        for (const part of watchedParts) watch.observe(part)
        watchedDeck = deck
        dirty = true
      }
      const key = `${deck.style.transform}|${deck.parentElement?.style.getPropertyValue('--label-scale')}|${deck.style.getPropertyValue('--near-scale')}|${window.innerWidth}x${window.innerHeight}|${JSON.stringify(aroundRef.current)}|${legendRef.current}`
      if (!dirty && key === last) return undefined
      const dot = rect(deck.querySelector('.node-dot'))
      const text = rect(deck.querySelector('.node-label-text'))
      if (!dot || !text) return undefined
      dirty = false
      last = key
      const view = { w: window.innerWidth, h: window.innerHeight }
      const free = freeArea(view, aroundRef.current)
      // As tall as all its rows: the rows' own height in place of the part of it shown now.
      const rowsEl = list.current
      const want = { w: LIST_SIZE.w, h: el.offsetHeight + (rowsEl ? rowsEl.scrollHeight - rowsEl.clientHeight : 0) }
      const p = placeDeckList({ dot, text }, want, free, legendRef.current ? legendBox(view) : [])
      return () => {
        el.style.left = `${p.left}px`
        el.style.top = `${p.top}px`
        el.style.width = `${p.width}px`
        el.style.maxHeight = `${p.maxHeight}px`
        el.style.visibility = 'visible'
        if (!focused) {
          focused = true
          list.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
        }
      }
    }
    // placed at once, before it is first drawn; then on each of the graph's frames
    place()?.()
    frameRef.current = place
    return () => {
      if (frameRef.current === place) frameRef.current = null
      watch.disconnect()
    }
  }, [frameRef])


  // Leaving with the focus inside, unasked (the deck is gone): the focus must not fall to the page. Only once the list
  // is really gone from the page (React may run this clean-up on a list that stays, in development).
  useLayoutEffect(() => {
    const el = box.current
    return () => {
      if (!el || !el.contains(document.activeElement)) return
      requestAnimationFrame(() => {
        if (!el.isConnected) lost.current()
      })
    }
  }, [])

  // Escape closes it, and nothing else hears that press (not the done-deck fold, not the selection); a press outside
  // closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      close.current(true)
    }
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null
      if (t && (box.current?.contains(t) || deckEl.current()?.contains(t))) return
      close.current(false, e.target, e.pointerId)
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onDown, true)
    }
  }, [])

  // The focus moving on to another control (the search box, a Tab past the last row) closes it; the window losing the
  // focus (another app) or a press on the deck itself does not.
  const onBlur = (e: React.FocusEvent) => {
    const to = e.relatedTarget
    if (!(to instanceof Element) || box.current?.contains(to) || deckEl.current()?.contains(to)) return
    close.current(false, to)
  }

  // Up and down move between the rows; the graph's own arrow keys stay out of it.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const to = e.key === 'ArrowDown' ? at + 1 : e.key === 'ArrowUp' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : null
    if (to === null) return
    e.preventDefault()
    e.stopPropagation()
    buttons[Math.max(0, Math.min(to, buttons.length - 1))]?.focus()
  }

  return (
    <div
      ref={box}
      id={deckListId(deckId)}
      data-testid="deck-list"
      data-hotkey-scope="list"
      data-deck-id={deckId}
      role="dialog"
      aria-label={`The ${title} in this deck`}
      className="deck-list glass"
      style={{ visibility: 'hidden' }}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    >
      <div className="deck-list-head">
        <span className="deck-list-title">{title}</span>
        <span className="deck-list-mix">
          {mix.map((c, i) => (
            <span key={c.state}>
              {i > 0 && ', '}
              <span data-state={c.state} style={{ color: textColour(c.state) }}>
                {c.n} {STATE_NAME[c.state].toLowerCase()}
              </span>
            </span>
          ))}
        </span>
        <button type="button" data-testid="deck-list-close" className="deck-list-close" aria-label="Close the list" title="Close (Esc)" onClick={() => onClose(true)}>
          ✕
        </button>
      </div>
      {linking && <p className="deck-list-hint">Pick the step to link to.</p>}
      <ul ref={list} className="deck-list-rows">
        {rows.map(r => (
          <li key={r.id}>
            <button
              type="button"
              data-testid="deck-list-row"
              data-member-id={r.id}
              data-state={r.state}
              title={r.title}
              aria-label={`${r.title}, ${r.priority !== 'normal' ? `${PRIORITY_NAME[r.priority].toLowerCase()}, ` : ''}${STATE_NAME[r.state].toLowerCase()}${r.due ? `, ${r.due.text}` : ''}`}
              onClick={() => onPick(r.id)}
            >
              <span aria-hidden className="deck-list-dot" style={{ background: STATE_SWATCH[r.state] }} />
              {/* the step's priority mark, in a column every row keeps so the titles line up; the row's name says it */}
              <span className="deck-list-prio">
                <PriorityMark priority={r.priority} decorative />
              </span>
              <span className="deck-list-name">{r.title}</span>
              <span className="deck-list-meta">
                {r.dateText && (
                  <span className={`deck-list-due${r.due?.inherited ? ' deck-list-due-inherited' : ''}${r.due?.overdue ? ' deck-list-due-overdue' : ''}`}>{r.dateText}</span>
                )}
                <span className="deck-list-state" style={{ color: textColour(r.state) }}>
                  {STATE_NAME[r.state].toLowerCase()}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {onOpenBranch && !linking && (
        <button type="button" data-testid="deck-list-open-branch" className="deck-list-open" onClick={onOpenBranch}>
          Draw the whole branch
        </button>
      )}
    </div>
  )
}
