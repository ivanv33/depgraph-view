import type { Priority, Status } from './schema.js'

import { NEAR_MAX, SIZE, hazeOf, type DueView } from './due.js'
import { MARK_MIN_PX, PRIORITY_MARK, PRIORITY_NAME, createPriorityMark } from './priorityMark.js'
import type { NodeState } from './readiness.js'

/**
 * The round node, in px at scale 1. globals.css repeats these (.node-dot); keep them in step.
 * `cx` is the circle's centre from the slot's left edge, `r` its default radius (the real one follows
 * the due date, see SIZE in due.ts), `reach` how far above or below the slot centre an edge meets it
 * (the same for every size; the biggest dot, 16, fits inside).
 */
export const DOT = { cx: 18, r: SIZE.normal, reach: 18 } as const

export interface LabelView {
  title: string
  status: Status
  state: NodeState
  chain: 'up' | 'down' | ''
  selected: boolean
  dim: boolean
  priority: Priority
  /** The node carries a hold: drawn muted and dashed with a "held" tag. */
  held?: boolean
  /** The node's due date as drawn: distance as haze, a line of text, a ring when overdue. */
  due?: DueView
  /**
   * Set on a deck: the members it stands for. `ids` and `titles` are the first few (same order), `more` how many
   * are not listed, `count` all of them; `mix` how many are in each state when they are not all in one (see
   * deckLabel), `readyInside` whether one can be started now though the deck is not painted ready; `priorities` each
   * listed member's stored priority (its row carries its mark; normal where it is left out).
   */
  deck?: { ids: string[]; titles: string[]; priorities?: Priority[]; /** Which shown members are done: their marks dim. */ done?: boolean[]; more: number; count: number; mix?: { state: NodeState; n: number }[]; readyInside?: boolean }
  /**
   * Set on a step with needs that no drawn line stands for (Group on: they are in another step's deck, or drawn under
   * another step): how many, and their titles in plan order. The label draws "+N" under its circle and says it whole in
   * its tooltip, so the step never looks like one that needs nothing.
   */
  elsewhere?: { count: number; titles: string[] }
}

/** How many of the needs drawn elsewhere a tooltip names before it counts the rest. */
const ELSEWHERE_NAMED = 3
/** How many characters of each named title the tooltip keeps (the last one an ellipsis when cut). */
const ELSEWHERE_TITLE_MAX = 60

/** Cut by characters (code points), so an emoji at the cut is never split into half a surrogate pair. */
const cutTitle = (t: string) => {
  const chars = Array.from(t)
  return chars.length > ELSEWHERE_TITLE_MAX ? `${chars.slice(0, ELSEWHERE_TITLE_MAX - 1).join('')}…` : t
}

/** The tooltip line for needs drawn elsewhere: "2 more needs, drawn elsewhere: A, B". */
function elsewhereText(e: NonNullable<LabelView['elsewhere']>): string {
  const named = e.titles.slice(0, ELSEWHERE_NAMED).map(cutTitle).join(', ')
  const rest = e.count - Math.min(e.titles.length, ELSEWHERE_NAMED)
  return `${e.count} more ${e.count === 1 ? 'need' : 'needs'}, drawn elsewhere: ${named}${rest > 0 ? ` and ${rest} more` : ''}`
}

/**
 * A card's text block in px at scale 1, from globals.css (.node-label-text; keep in step): it starts 40px in from the
 * slot's left edge, is 150px wide, and the title is 13px. The priority mark sits inside it, before the title's words, so
 * the words wrap beside the mark and the block never widens: TEXT_RIGHT is as far right as any title reaches, mark or no mark.
 */
export const LABEL_TEXT = { left: 40, width: 150, font: 13 } as const
export const TEXT_RIGHT = LABEL_TEXT.left + LABEL_TEXT.width

/** The mark's height and the gap after it, in em of the title (globals.css, .node-prio; keep in step). Its width follows the glyph. */
export const MARK_EM = { h: 0.8, gap: 0.35 } as const

/**
 * How much of the title's first line the priority mark and its gap take, in px of the card at scale 1, when the card is
 * drawn `zoom` times its size (the label scale times the due-date scale): em-sized, but never under MARK_MIN_PX on screen.
 * Nothing for normal. For anything that needs the title box's width (it includes the mark).
 */
export function markRoom(priority: Priority, zoom: number, font: number = LABEL_TEXT.font): number {
  if (priority === 'normal') return 0
  const w = Math.max(font * MARK_EM.h * (PRIORITY_MARK.w / PRIORITY_MARK.h), MARK_MIN_PX.w / zoom)
  return w + font * MARK_EM.gap
}

/**
 * Circles in a deck's fan, the node dot included, and how far each sits right of and below the one before (px at
 * scale 1). The only copy: renderLabel hands the offsets to the stylesheet as --deck-dx / --deck-dy.
 */
export const DECK_FAN = { max: 5, dx: 6, dy: 2 } as const

/**
 * A deck's text block in px at scale 1, from globals.css (keep in step): the title line (13px x 1.2), the state line
 * (10px x 1.25, reserved whether or not the states are mixed), the due line (10px x 1.2, reserved whether or not there
 * is a date), the list's top margin, one line per listed member (10px x 1.25 plus 2px padding; titles are cut to one
 * line) and the "+N more" pill.
 */
const DECK_TEXT = { title: 15.6, mix: 12.5, due: 12, gap: 2, item: 14.5, more: 19 }

/**
 * How tall a deck with `listed` member titles (and a "+N more" line when `more`) draws, in layout units: its text
 * block at the largest due-date scale (NEAR_MAX), so a date never moves the layout. The layout keeps the rows around it clear.
 */
export function deckHeight(listed: number, more: boolean): number {
  const text = DECK_TEXT.title + DECK_TEXT.mix + DECK_TEXT.due + DECK_TEXT.gap + listed * DECK_TEXT.item + (more ? DECK_TEXT.more : 0)
  return Math.max(44, Math.ceil(text * NEAR_MAX))
}

/**
 * How wide a deck's layout slot is, in layout units, given the card width and the gap between slots: wide enough that
 * neither its own text nor a neighbour's reaches the other's circle at the largest due-date scale (NEAR_MAX). A card's
 * text (priority mark included) runs from 40px to 190px (TEXT_RIGHT) and its circle stays put as the date scales it, so at NEAR_MAX a card reaches
 * `DOT.cx + (190 - DOT.cx) * NEAR_MAX` from its slot's left edge, past its slot and the gap; a circle starts
 * `DOT.cx - SIZE.near * NEAR_MAX` (less the outline around it) in from its slot's left. The deck takes that much room on
 * both sides, so the deck clears the step on its left and the step on its right.
 */
export function deckWidth(cardW: number, colGap: number): number {
  return cardW + 2 * slotTail(NEAR_MAX, cardW, colGap)
}

/**
 * How much room, in layout units, a card drawn `scale` times its size (a date near) needs past the right of its slot,
 * so its text ends before the circle of the step on its right, however large that one is drawn (see deckWidth). Nothing
 * at scale 1 or below.
 */
export function slotTail(scale: number, cardW: number, colGap: number): number {
  const reach = DOT.cx + (TEXT_RIGHT - DOT.cx) * scale
  const dotLeft = DOT.cx - SIZE.near * NEAR_MAX - 4
  return Math.max(0, Math.ceil(reach - cardW - colGap - dotLeft))
}

/**
 * How many of a deck's `count` members to list by name (at most `max`) when its words draw `cardScale` times their
 * size in the layout (above 1 zoomed out: the title boost, and past the label clamp the card's own scale; deckScale in
 * titleFitDom.ts): as many as keep the list inside the room its row reserves at scale 1; the "+N more" pill takes the rest.
 * The row keeps that room for the deck drawn at its largest date scale (NEAR_MAX, deckHeight); one drawn `dateScale`
 * times its size for its date (1 undated; left out, taken at NEAR_MAX) leaves the rest of it to its words.
 */
export function deckListed(count: number, max: number, cardScale: number, dateScale: number = NEAR_MAX): number {
  const room = deckHeight(Math.min(count, max), count > max)
  const drawn = cardScale * (dateScale / NEAR_MAX)
  for (let k = Math.min(count, max); k > 0; k--) if (deckHeight(k, k < count) * drawn <= room + 1e-9) return k
  return 0
}

export interface LabelNode extends LabelView {
  id: string
}

/**
 * How a label was picked: plainly, with Cmd/Meta ("link"), with Ctrl / the context menu ("edit") or with Shift alone
 * ("shift": the graph's Shift+click link, shiftLink.ts).
 */
export type PickMode = 'link' | 'edit' | 'shift'
export type OnPick = (id: string, mode?: PickMode) => void

/**
 * How a click (or, with `menu`, a context-menu event) picks a label: Cmd/Meta links, Ctrl or the context menu edits,
 * Shift alone is the Shift+click link (Cmd+Shift still links, Ctrl+Shift still edits).
 */
export function pickModeOf(e: { metaKey: boolean; ctrlKey: boolean; shiftKey?: boolean }, menu = false): PickMode | undefined {
  if (menu) return 'edit'
  if (e.metaKey) return 'link'
  if (e.ctrlKey) return 'edit'
  if (e.shiftKey) return 'shift'
  return undefined
}

/**
 * Whether the screen point (`x`, `y`) lies on the selected label's title or due line. Those take no pointer (so a
 * neighbour's circle under them keeps the click), so a click there reaches the canvas as a background click; the graph
 * asks this to treat it as a click on the selected step instead.
 */
export function onSelectedText(labels: Map<string, HTMLElement>, selectedId: string | null, x: number, y: number): boolean {
  const el = selectedId === null ? undefined : labels.get(selectedId)
  if (!el) return false
  // The words line by line (a range over the part's text): a wrapped title's box also holds the empty end of its
  // shorter line, which is not the step's words.
  return [...el.querySelectorAll('.node-label-title, .node-label-due')].some(part => {
    const range = part.ownerDocument.createRange()
    range.selectNodeContents(part)
    return [...range.getClientRects()].some(r => r.width > 0 && r.height > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)
  })
}

export function createLabelElement(id: string, onPick: OnPick): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'node-label'
  el.setAttribute('data-testid', 'node-label')
  el.setAttribute('data-node-id', id)
  el.setAttribute('role', 'button')
  el.tabIndex = 0
  const title = document.createElement('span')
  title.className = 'node-label-title'
  // The priority mark, then the words: the haze fades the words only, so the mark keeps its strength on a far date.
  const prio = document.createElement('span')
  prio.className = 'node-prio'
  const words = document.createElement('span')
  words.className = 'node-label-words'
  title.append(prio, words)
  const idLine = document.createElement('span')
  idLine.className = 'node-label-id'
  idLine.textContent = id
  // CSS2DRenderer owns the outer element's transform; the inner card is the box that scales with the zoom.
  const card = document.createElement('div')
  card.className = 'node-card'
  const dot = document.createElement('span')
  dot.className = 'node-dot'
  const held = document.createElement('span')
  held.className = 'node-label-held'
  held.textContent = 'held'
  const due = document.createElement('span')
  due.className = 'node-label-due'
  // The text may run past the card into the column gap; it is centred on the dot whatever its height.
  const text = document.createElement('span')
  text.className = 'node-label-text'
  text.append(title, due, idLine)
  // The selection mark: corner brackets around the circle that keep a fixed size on screen at any zoom (globals.css
  // shows it only on the selected step). Drawn, never read: the selection is data-selected on the label.
  const mark = document.createElement('span')
  mark.className = 'node-mark'
  mark.setAttribute('aria-hidden', 'true')
  // How many needs are drawn elsewhere (renderLabel fills it; the label's name says it in words).
  const elsewhere = document.createElement('span')
  elsewhere.className = 'node-label-elsewhere'
  elsewhere.setAttribute('aria-hidden', 'true')
  card.append(dot, text, held, mark, elsewhere)
  el.append(card)
  // The graph container starts a click on pointerdown; stopping it here keeps a label click from also
  // registering as a background click (which would deselect).
  el.addEventListener('pointerdown', e => e.stopPropagation())
  // A Shift+press would extend the page's text selection across the titles it passes: Shift+click links instead.
  el.addEventListener('mousedown', e => {
    if (e.shiftKey) e.preventDefault()
  })
  // A deck lists its members; a click on one picks that member plainly, whatever else is held.
  const memberAt = (e: Event) => (e.target as Element).closest?.('li[data-member-id]')?.getAttribute('data-member-id') ?? null
  el.addEventListener('click', e => {
    e.stopPropagation()
    const member = memberAt(e)
    const mode = pickModeOf(e)
    if (member) onPick(member)
    else if (mode) onPick(id, mode)
    else onPick(id)
  })
  // On macOS Ctrl+click arrives as a context-menu event, not a click.
  el.addEventListener('contextmenu', e => {
    e.preventDefault()
    e.stopPropagation()
    const member = memberAt(e)
    if (member) onPick(member)
    else onPick(id, pickModeOf(e, true))
  })
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onPick(id)
    }
  })
  return el
}

export function renderLabel(el: HTMLElement, view: LabelView): void {
  const title = view.title || el.getAttribute('data-node-id') || ''
  // A deck's name says what is inside it: "23 steps · 2 ready, 21 waiting".
  const mix = view.deck?.mix ?? []
  const name = mix.length ? `${title} · ${mixText(mix)}` : title
  const away = view.elsewhere && view.elsewhere.count > 0 ? view.elsewhere : undefined
  const awayName = away ? `, ${away.count} more ${away.count === 1 ? 'need' : 'needs'} drawn elsewhere` : ''
  el.setAttribute('aria-label', (view.priority === 'normal' ? name : `${name}, ${PRIORITY_NAME[view.priority].toLowerCase()}`) + awayName)
  // The tooltip says the date as the label does (see dueLabel), whole where the line is cut short.
  const tip = view.due ? `${name} (due ${view.due.text}${view.due.inherited ? `, from ${view.due.from}` : ''})` : name
  el.title = away ? `${tip}\n${elsewhereText(away)}` : tip
  // Needs drawn elsewhere: "+N" under the circle (globals.css), so the step does not look like one that needs nothing.
  if (away) el.dataset.elsewhere = String(away.count)
  else delete el.dataset.elsewhere
  const cue = el.querySelector('.node-label-elsewhere')
  if (cue) cue.textContent = away ? `+${away.count}` : ''
  // A date taken from a step that needs this one reads "by <date>" in italics (globals.css).
  if (view.due?.inherited) el.dataset.dueInherited = 'true'
  else delete el.dataset.dueInherited
  el.dataset.status = view.status
  el.dataset.state = view.state
  el.dataset.chain = view.chain
  el.dataset.selected = String(view.selected)
  el.dataset.dim = String(view.dim)
  el.dataset.priority = view.priority
  renderDeck(el, view.deck)
  if (view.held) el.dataset.hold = 'true'
  else delete el.dataset.hold
  const words = el.querySelector('.node-label-words')
  if (words) words.textContent = title
  const prio = el.querySelector<HTMLElement>('.node-prio')
  if (prio) putMark(prio, view.priority)
  const due = el.querySelector('.node-label-due')
  if (due) due.textContent = view.due?.text ?? ''
  if (view.due?.overdue) el.dataset.overdue = 'true'
  else delete el.dataset.overdue
  el.style.setProperty('--dot-r', `${view.due?.radius ?? SIZE.normal}px`)
  // Due soon draws larger, far off smaller, by a fixed ratio (the card reads --near-scale); data-near says which (for
  // tests and tools: no style reads it).
  const scale = view.due?.scale ?? 1
  if (scale === 1) {
    delete el.dataset.near
    el.style.removeProperty('--near-scale')
  } else {
    el.dataset.near = String(scale > 1)
    el.style.setProperty('--near-scale', String(scale))
  }
  if (view.due) el.style.setProperty('--haze', String(hazeOf(view.due, view.selected || view.chain !== '')))
  else el.style.removeProperty('--haze')
}

/** A deck's state mix as words: "2 ready, 21 waiting". */
export const mixText = (mix: { state: NodeState; n: number }[]): string => mix.map(c => `${c.n} ${c.state}`).join(', ')

/** Puts the mark for `priority` as the only child of `slot` (none for normal), leaving it alone when it already shows that one. */
function putMark(slot: Element, priority: Priority): void {
  const have = slot.querySelector('svg.priority-mark')
  if ((have?.getAttribute('data-priority') ?? 'normal') === priority) return
  const svg = createPriorityMark(slot.ownerDocument, priority)
  if (svg) slot.replaceChildren(svg)
  else slot.replaceChildren()
}

/**
 * A deck is the dot with copies fanned out behind it, a line saying how many of its steps are in each state, and a
 * list of member titles beside it; a plain node has none of them.
 */
function renderDeck(el: HTMLElement, deck: LabelView['deck']): void {
  const card = el.querySelector('.node-card')
  const text = el.querySelector('.node-label-text')
  if (!card || !text) return
  const copies = deck ? Math.min(deck.count, DECK_FAN.max) - 1 : 0
  const have = card.querySelectorAll('.node-deck-dot')
  for (let i = have.length; i > copies; i--) have[i - 1].remove()
  for (let i = have.length; i < copies; i++) {
    const copy = document.createElement('span')
    copy.className = 'node-deck-dot'
    copy.style.setProperty('--deck-i', String(i + 1))
    ;(card.querySelectorAll('.node-deck-dot')[i - 1] ?? card.querySelector('.node-dot'))?.after(copy)
  }
  let list = text.querySelector<HTMLElement>('.node-deck-list')
  let mixLine = text.querySelector<HTMLElement>('.node-deck-mix')
  if (!deck) {
    list?.remove()
    mixLine?.remove()
    delete el.dataset.deck
    delete el.dataset.deckSize
    delete el.dataset.deckReady
    for (const v of ['--deck-n', '--deck-dx', '--deck-dy']) el.style.removeProperty(v)
    return
  }
  el.dataset.deck = 'true'
  el.dataset.deckSize = String(deck.count)
  // A step inside can be started now though most of the deck is in another state: a small ready marker on the fan.
  if (deck.readyInside) el.dataset.deckReady = 'true'
  else delete el.dataset.deckReady
  if (!mixLine) {
    mixLine = document.createElement('span')
    mixLine.className = 'node-deck-mix'
    text.querySelector('.node-label-title')?.after(mixLine)
  }
  const mix = deck.mix ?? []
  const mixKey = JSON.stringify(mix)
  if (mixLine.dataset.key !== mixKey) {
    mixLine.dataset.key = mixKey
    mixLine.replaceChildren(
      ...mix.flatMap((c, i) => {
        const part = document.createElement('span')
        part.dataset.state = c.state
        part.textContent = `${c.n} ${c.state}`
        return i ? [', ', part] : [part]
      }),
    )
  }
  el.style.setProperty('--deck-n', String(copies + 1))
  el.style.setProperty('--deck-dx', `${DECK_FAN.dx}px`)
  el.style.setProperty('--deck-dy', `${DECK_FAN.dy}px`)
  if (!list) {
    list = document.createElement('ul')
    list.className = 'node-deck-list'
    text.querySelector('.node-label-id')?.before(list)
  }
  const key = JSON.stringify([deck.ids, deck.titles, deck.priorities ?? [], deck.done ?? [], deck.more])
  if (list.dataset.key === key) return
  list.dataset.key = key
  list.replaceChildren(
    ...deck.titles.map((title, i) => {
      const li = document.createElement('li')
      li.setAttribute('data-member-id', deck.ids[i])
      if (deck.done?.[i]) li.dataset.done = 'true'
      // the member's own priority mark before its title, as on a step's label
      const mark = createPriorityMark(document, deck.priorities?.[i] ?? 'normal')
      if (mark) li.append(mark)
      li.append(title)
      li.title = title // cut to one line in the list
      return li
    }),
  )
  if (deck.more > 0) {
    const more = document.createElement('li')
    more.className = 'node-deck-more'
    more.textContent = `+${deck.more} more`
    // Not a member: a click here falls through to the deck itself, which lists all its steps.
    more.title = `List all ${deck.count} steps`
    list.append(more)
  }
}

export function labelFor(labels: Map<string, HTMLDivElement>, id: string, onPick: OnPick): HTMLDivElement {
  let el = labels.get(id)
  if (!el) {
    el = createLabelElement(id, onPick)
    labels.set(id, el)
  }
  return el
}

export function syncLabels(labels: Map<string, HTMLDivElement>, nodes: LabelNode[], onPick: OnPick): void {
  const ids = new Set(nodes.map(n => n.id))
  for (const [id, el] of labels) {
    if (!ids.has(id)) {
      el.remove()
      labels.delete(id)
    }
  }
  for (const n of nodes) renderLabel(labelFor(labels, n.id, onPick), n)
}

/**
 * Stacks the labels left to right by their layout position (`x`, then `y`): a label draws over every label to its
 * left. A step's words run right of its circle, so the circle of any step always draws (and takes the pointer) over
 * the words of a neighbour that reach it, however far zooming out makes cards outgrow their slots. The graph turns the
 * renderer's own stacking (by distance to the camera) off and calls this on every new layout. It also hands each label
 * its `walls` (layout units right of its card's centre where a block's lanes run past it) as data-walls, its `wallDot`
 * (layout units from its card's centre to that of a step an arrow climbs past it into; with `wallDotRun`, that climb's
 * span, layout units below its card's centre, as "dx:top:bottom") as data-wall-dot, and its `wallRuns` (lanes running
 * past it or ending a row or two away: each one's x and run span, layout units from its card's centre) as
 * data-wall-runs ("dx:top:bottom", comma separated), for titleFit.
 */
export function stackLabels(
  labels: Map<string, HTMLElement>,
  positions: Iterable<{ id: string; x: number; y: number; walls?: readonly number[]; wallDot?: number; wallDotRun?: { top: number; bottom: number }; wallRuns?: readonly { dx: number; top: number; bottom: number }[] }>,
): void {
  const order = [...positions].sort((a, b) => a.x - b.x || a.y - b.y)
  order.forEach((p, i) => {
    const el = labels.get(p.id)
    if (!el) return
    el.style.zIndex = String(i + 1)
    if (!p.walls?.length) delete el.dataset.walls
    else el.dataset.walls = p.walls.join(',')
    if (p.wallDot === undefined) delete el.dataset.wallDot
    else el.dataset.wallDot = p.wallDotRun ? `${p.wallDot}:${p.wallDotRun.top}:${p.wallDotRun.bottom}` : String(p.wallDot)
    if (!p.wallRuns?.length) delete el.dataset.wallRuns
    else el.dataset.wallRuns = p.wallRuns.map(r => `${r.dx}:${r.top}:${r.bottom}`).join(',')
  })
}

export const SHAKE_MS = 600

const shakeTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>()

export function shakeLabel(el: HTMLElement, ms = SHAKE_MS): void {
  clearTimeout(shakeTimers.get(el))
  delete el.dataset.shake
  el.getBoundingClientRect() // force a reflow so the CSS animation restarts
  el.dataset.shake = 'true'
  shakeTimers.set(
    el,
    setTimeout(() => {
      delete el.dataset.shake
      shakeTimers.delete(el)
    }, ms),
  )
}
