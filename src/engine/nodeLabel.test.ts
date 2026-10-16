// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DECK_FAN, DOT, LABEL_TEXT, MARK_EM, SHAKE_MS, TEXT_RIGHT, createLabelElement, deckHeight, deckListed, deckWidth, labelFor, markRoom, onSelectedText, pickModeOf, slotTail, renderLabel, shakeLabel, stackLabels, syncLabels } from './nodeLabel.js'
import { NEAR_MAX, SIZE } from './due.js'
import { LABEL_SCALE } from './camera.js'
import { MARK_MIN_PX, PRIORITY_MARK } from './priorityMark.js'

describe('pickModeOf', () => {
  it('Cmd/Meta links, Ctrl edits, the context menu edits whatever is held, a plain click has no mode', () => {
    expect(pickModeOf({ metaKey: true, ctrlKey: false })).toBe('link')
    expect(pickModeOf({ metaKey: false, ctrlKey: true })).toBe('edit')
    expect(pickModeOf({ metaKey: false, ctrlKey: false })).toBeUndefined()
    expect(pickModeOf({ metaKey: true, ctrlKey: false }, true)).toBe('edit')
  })

  it('Shift alone is its own mode; Cmd+Shift still links, Ctrl+Shift and the context menu with Shift still edit', () => {
    expect(pickModeOf({ metaKey: false, ctrlKey: false, shiftKey: true })).toBe('shift')
    expect(pickModeOf({ metaKey: true, ctrlKey: false, shiftKey: true })).toBe('link')
    expect(pickModeOf({ metaKey: false, ctrlKey: true, shiftKey: true })).toBe('edit')
    expect(pickModeOf({ metaKey: false, ctrlKey: false, shiftKey: true }, true)).toBe('edit')
  })
})

describe('a label under Shift', () => {
  it('a Shift+press on a label is kept from starting a text selection; a plain press is left alone', () => {
    const el = createLabelElement('a', () => {})
    const shifted = new MouseEvent('mousedown', { bubbles: true, cancelable: true, shiftKey: true })
    el.dispatchEvent(shifted)
    expect(shifted.defaultPrevented).toBe(true)
    const plain = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    el.dispatchEvent(plain)
    expect(plain.defaultPrevented).toBe(false)
  })

  it('a Shift+click on a label picks it in the shift mode; one on a deck row picks the row plainly', () => {
    const picks: [string, string | undefined][] = []
    const el = createLabelElement('a', (id, mode) => picks.push([id, mode]))
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))
    const row = document.createElement('li')
    row.setAttribute('data-member-id', 'm')
    el.append(row)
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))
    expect(picks).toEqual([['a', 'shift'], ['m', undefined]])
  })
})

describe('onSelectedText', () => {
  const rect = (left: number, top: number, w: number, h: number) => ({ left, top, right: left + w, bottom: top + h, width: w, height: h, x: left, y: top, toJSON: () => ({}) })
  // The rects of the words on each line of a part (jsdom lays nothing out): a range over the part's contents gives them.
  const lines = new Map<Node, ReturnType<typeof rect>[]>()
  afterEach(() => {
    vi.restoreAllMocks()
    lines.clear()
  })
  const make = (title: ReturnType<typeof rect>[], due: ReturnType<typeof rect>[]) => {
    const el = createLabelElement('a', () => {})
    lines.set(el.querySelector('.node-label-title')!, title)
    lines.set(el.querySelector('.node-label-due')!, due)
    vi.spyOn(document, 'createRange').mockImplementation(() => {
      let of: Node | null = null
      return { selectNodeContents: (n: Node) => void (of = n), getClientRects: () => (of ? (lines.get(of) ?? []) : []) } as unknown as Range
    })
    return new Map([['a', el]])
  }

  it('is true on the selected label\'s title or due line, false beside them', () => {
    const labels = make([rect(100, 50, 80, 16)], [rect(100, 66, 40, 12)])
    expect(onSelectedText(labels, 'a', 120, 55)).toBe(true)
    expect(onSelectedText(labels, 'a', 120, 70)).toBe(true)
    expect(onSelectedText(labels, 'a', 160, 70)).toBe(false)
    expect(onSelectedText(labels, 'a', 20, 55)).toBe(false)
  })

  it('on a title wrapped to two lines, only the words count: the empty end of the shorter line does not', () => {
    const labels = make([rect(100, 50, 120, 16), rect(100, 66, 40, 16)], [])
    expect(onSelectedText(labels, 'a', 200, 55), 'on the first line').toBe(true)
    expect(onSelectedText(labels, 'a', 120, 74), 'on the second line').toBe(true)
    expect(onSelectedText(labels, 'a', 200, 74), 'beside the second line, under the end of the first').toBe(false)
  })

  it('is false with nothing selected, for a label not drawn, and for an empty due line', () => {
    const labels = make([rect(100, 50, 80, 16)], [rect(100, 66, 0, 0)])
    expect(onSelectedText(labels, null, 120, 55)).toBe(false)
    expect(onSelectedText(labels, 'b', 120, 55)).toBe(false)
    expect(onSelectedText(labels, 'a', 130, 74)).toBe(false)
  })
})

describe('createLabelElement', () => {
  it('is a focusable button tagged with the node id', () => {
    const el = createLabelElement('schema', () => {})
    expect(el.getAttribute('data-testid')).toBe('node-label')
    expect(el.getAttribute('data-node-id')).toBe('schema')
    expect(el.getAttribute('role')).toBe('button')
    expect(el.tabIndex).toBe(0)
    expect(el.querySelector('.node-label-id')?.textContent).toBe('schema')
  })

  it('wraps the title and id in an inner card that can scale while the outer element is positioned', () => {
    const el = createLabelElement('schema', () => {})
    const card = el.querySelector(':scope > .node-card')
    expect(card).not.toBeNull()
    expect(card!.querySelector('.node-label-title')).not.toBeNull()
    expect(card!.querySelector('.node-label-id')?.textContent).toBe('schema')
  })

  it('Cmd+click picks with "link"; Ctrl+click and the context menu pick with "edit" and suppress the menu', () => {
    const onPick = vi.fn()
    const el = createLabelElement('schema', onPick)
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }))
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    el.dispatchEvent(menu)
    expect(onPick.mock.calls).toEqual([['schema', 'link'], ['schema', 'edit'], ['schema', 'edit']])
    expect(menu.defaultPrevented).toBe(true)
  })

  it('click and Enter pick the node; pointerdown does not reach the graph container', () => {
    const onPick = vi.fn()
    const graphDown = vi.fn()
    const container = document.createElement('div')
    container.addEventListener('pointerdown', graphDown)
    const el = createLabelElement('schema', onPick)
    container.append(el)
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    el.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(onPick.mock.calls).toEqual([['schema'], ['schema']])
    expect(graphDown).not.toHaveBeenCalled()
  })
})

describe('DOT', () => {
  it('holds the numbers the stylesheet repeats', () => {
    expect(DOT).toEqual({ cx: 18, r: 11, reach: 18 })
  })
})

describe('node dot', () => {
  it('is the first child of the card', () => {
    const el = createLabelElement('schema', () => {})
    const card = el.querySelector(':scope > .node-card')!
    expect(card.firstElementChild?.classList.contains('node-dot')).toBe(true)
  })

  it('carries one selection mark in the card, hidden from screen readers (the stylesheet shows it on the selected step)', () => {
    const el = createLabelElement('schema', () => {})
    const marks = el.querySelectorAll('.node-card > .node-mark')
    expect(marks).toHaveLength(1)
    expect(marks[0].getAttribute('aria-hidden')).toBe('true')
    expect(marks[0].textContent).toBe('')
    renderLabel(el, { title: 'T', status: 'todo', state: 'ready', chain: '', selected: true, dim: false, priority: 'normal', deck: { ids: ['a', 'b'], titles: ['A', 'B'], more: 0, count: 2 } })
    expect(el.querySelectorAll('.node-mark')).toHaveLength(1)
  })

  it('renderLabel writes the priority as a data attribute', () => {
    const el = createLabelElement('schema', () => {})
    const view = { title: 'T', status: 'todo' as const, state: 'ready' as const, chain: '' as const, selected: false, dim: false, priority: 'normal' as const }
    for (const priority of ['low', 'normal', 'high'] as const) {
      renderLabel(el, { ...view, priority })
      expect(el.dataset.priority).toBe(priority)
    }
  })
})

describe('renderLabel', () => {
  it('shows the full title, uses it as name and tooltip, and exposes status, state, chain and flags', () => {
    const el = createLabelElement('mig', () => {})
    const title = 'Write the migration for the billing tables and backfill every historical row'
    renderLabel(el, { title, status: 'doing', state: 'doing', chain: 'up', selected: true, dim: false, priority: 'normal' as const })
    expect(el.getAttribute('aria-label')).toBe(title)
    expect(el.title).toBe(title)
    expect(el.querySelector('.node-label-title')?.textContent).toBe(title)
    expect(el.dataset.status).toBe('doing')
    expect(el.dataset.state).toBe('doing')
    expect(el.dataset.chain).toBe('up')
    expect(el.dataset.selected).toBe('true')
    expect(el.dataset.dim).toBe('false')
  })

  it('writes the derived state and chain, which can differ from the status', () => {
    const el = createLabelElement('mig', () => {})
    renderLabel(el, { title: 'T', status: 'todo', state: 'ready', chain: 'down', selected: false, dim: false, priority: 'normal' as const })
    expect(el.dataset.status).toBe('todo')
    expect(el.dataset.state).toBe('ready')
    expect(el.dataset.chain).toBe('down')
    renderLabel(el, { title: 'T', status: 'todo', state: 'waiting', chain: '', selected: false, dim: false, priority: 'normal' as const })
    expect(el.dataset.chain).toBe('')
  })

  it('marks a held node with data-hold and a held tag, and clears both when released', () => {
    const el = createLabelElement('mig', () => {})
    const view = { title: 'T', status: 'todo' as const, state: 'ready' as const, chain: '' as const, selected: false, dim: false, priority: 'normal' as const }
    expect(el.querySelector('.node-label-held')?.textContent).toBe('held')
    renderLabel(el, view)
    expect(el.hasAttribute('data-hold')).toBe(false)
    renderLabel(el, { ...view, held: true })
    expect(el.getAttribute('data-hold')).toBe('true')
    renderLabel(el, { ...view, held: false })
    expect(el.hasAttribute('data-hold')).toBe(false)
  })

  it('says on the label, its tooltip and its name how many needs are drawn elsewhere, and clears it', () => {
    const el = createLabelElement('mig', () => {})
    const view = { title: 'T', status: 'todo' as const, state: 'waiting' as const, chain: '' as const, selected: false, dim: false, priority: 'normal' as const }
    const cue = () => el.querySelector('.node-label-elsewhere')
    expect(cue()).not.toBeNull()
    expect(cue()!.getAttribute('aria-hidden')).toBe('true')
    renderLabel(el, view)
    expect(el.hasAttribute('data-elsewhere')).toBe(false)
    expect(cue()!.textContent).toBe('')
    renderLabel(el, { ...view, elsewhere: { count: 2, titles: ['Pick a lender', 'Save more'] } })
    expect(el.dataset.elsewhere).toBe('2')
    expect(cue()!.textContent).toBe('+2')
    expect(el.title).toBe('T\n2 more needs, drawn elsewhere: Pick a lender, Save more')
    expect(el.getAttribute('aria-label')).toBe('T, 2 more needs drawn elsewhere')
    renderLabel(el, { ...view, elsewhere: { count: 1, titles: ['Pick a lender'] } })
    expect(el.title).toBe('T\n1 more need, drawn elsewhere: Pick a lender')
    expect(el.getAttribute('aria-label')).toBe('T, 1 more need drawn elsewhere')
    // past three titles the rest are counted; the date stays on the first line
    renderLabel(el, { ...view, due: { text: 'Jan 1, 2099', date: '2099-01-01', strength: 0.4, radius: 7, scale: 1, overdue: false }, elsewhere: { count: 5, titles: ['a', 'b', 'c', 'd', 'e'] } })
    expect(el.title).toBe('T (due Jan 1, 2099)\n5 more needs, drawn elsewhere: a, b, c and 2 more')
    renderLabel(el, view)
    expect(el.hasAttribute('data-elsewhere')).toBe(false)
    expect(cue()!.textContent).toBe('')
    expect(el.title).toBe('T')
    // each named title is cut at 60 characters, so the line stays bounded however long the titles are
    const long = 'x'.repeat(200)
    renderLabel(el, { ...view, elsewhere: { count: 3, titles: [long, 'short', 'y'.repeat(60)] } })
    expect(el.title).toBe(`T\n3 more needs, drawn elsewhere: ${'x'.repeat(59)}…, short, ${'y'.repeat(60)}`)
    // characters, not UTF-16 units: an emoji at the cut stays whole (or goes whole), never half a surrogate pair
    renderLabel(el, { ...view, elsewhere: { count: 2, titles: [`${'x'.repeat(58)}🚀🚀🚀`, `${'z'.repeat(59)}🚀`] } })
    expect(el.title).toBe(`T\n2 more needs, drawn elsewhere: ${'x'.repeat(58)}🚀…, ${'z'.repeat(59)}🚀`)
  })

  it('falls back to the id when the title is empty', () => {
    const el = createLabelElement('mig', () => {})
    renderLabel(el, { title: '', status: 'todo', state: 'ready', chain: '', selected: false, dim: true, priority: 'normal' as const })
    expect(el.getAttribute('aria-label')).toBe('mig')
    expect(el.querySelector('.node-label-title')?.textContent).toBe('mig')
    expect(el.dataset.dim).toBe('true')
  })
})

describe('priority on a label', () => {
  const view = { title: 'Ship it', status: 'todo' as const, state: 'ready' as const, chain: '' as const, selected: false, dim: false, priority: 'normal' as const }
  const mark = (el: HTMLElement) => el.querySelector('.node-label-title > .node-prio > svg.priority-mark')

  it('the title holds a mark slot before the words', () => {
    const el = createLabelElement('a', () => {})
    const title = el.querySelector('.node-label-title')!
    expect([...title.children].map(c => c.className)).toEqual(['node-prio', 'node-label-words'])
  })

  it('high draws three lit bars before the title, named "High priority"; the words and the title text stay the title', () => {
    const el = createLabelElement('a', () => {})
    renderLabel(el, { ...view, priority: 'high' })
    const svg = mark(el)!
    expect(svg.getAttribute('aria-label')).toBe('High priority')
    expect([...svg.querySelectorAll('rect')].map(r => r.getAttribute('fill'))).toEqual([PRIORITY_MARK.on, PRIORITY_MARK.on, PRIORITY_MARK.on])
    expect(el.querySelector('.node-label-words')!.textContent).toBe('Ship it')
    expect(el.querySelector('.node-label-title')!.textContent).toBe('Ship it')
    // the step's name says it too, so a screen reader hears it with the title
    expect(el.getAttribute('aria-label')).toBe('Ship it, high priority')
    expect(el.dataset.priority).toBe('high')
  })

  it('low draws the same glyph with only the lowest bar lit, named "Low priority"', () => {
    const el = createLabelElement('a', () => {})
    renderLabel(el, { ...view, priority: 'low' })
    const svg = mark(el)!
    expect(svg.getAttribute('aria-label')).toBe('Low priority')
    expect([...svg.querySelectorAll('rect')].map(r => r.getAttribute('fill'))).toEqual([PRIORITY_MARK.lowOn, PRIORITY_MARK.off, PRIORITY_MARK.off])
    expect(el.getAttribute('aria-label')).toBe('Ship it, low priority')
  })

  it('normal draws nothing, and going back to normal takes the mark away', () => {
    const el = createLabelElement('a', () => {})
    renderLabel(el, view)
    expect(el.querySelector('.node-prio')!.childElementCount).toBe(0)
    renderLabel(el, { ...view, priority: 'high' })
    renderLabel(el, { ...view, priority: 'low' })
    expect(el.querySelectorAll('svg.priority-mark')).toHaveLength(1)
    renderLabel(el, view)
    expect(el.querySelector('.node-prio')!.childElementCount).toBe(0)
    expect(el.getAttribute('aria-label')).toBe('Ship it')
  })

  it('keeps the same mark element across renders that do not change the priority', () => {
    const el = createLabelElement('a', () => {})
    renderLabel(el, { ...view, priority: 'high' })
    const first = mark(el)
    renderLabel(el, { ...view, priority: 'high', selected: true })
    expect(mark(el)).toBe(first)
  })

  it('a deck shows the high mark beside its count; each listed member carries its own mark', () => {
    const el = createLabelElement('deck:goal', () => {})
    const deck = { ids: ['a', 'b', 'c'], titles: ['Alpha', 'Beta', 'Gamma'], more: 0, count: 3 }
    renderLabel(el, { ...view, title: '3 steps', priority: 'high', deck: { ...deck, priorities: ['high', 'normal', 'low'] } })
    expect(mark(el)!.getAttribute('aria-label')).toBe('High priority')
    const rows = [...el.querySelectorAll<HTMLElement>('.node-deck-list > li[data-member-id]')]
    expect(rows.map(li => li.querySelector('svg.priority-mark')?.getAttribute('aria-label') ?? null)).toEqual(['High priority', null, 'Low priority'])
    // the mark comes before the words; the row's text is still the title alone
    expect(rows[0].firstElementChild?.matches('svg.priority-mark')).toBe(true)
    expect(rows.map(li => li.textContent)).toEqual(['Alpha', 'Beta', 'Gamma'])
    // a member's priority changing redraws its row
    renderLabel(el, { ...view, title: '3 steps', priority: 'normal', deck: { ...deck, priorities: ['normal', 'normal', 'low'] } })
    expect(mark(el)).toBeNull()
    expect([...el.querySelectorAll('.node-deck-list > li[data-member-id]')].map(li => li.querySelector('svg') !== null)).toEqual([false, false, true])
  })

  it('marks a done member\'s row, so its bars dim with it', () => {
    const el = createLabelElement('deck:goal', () => {})
    const deck = { ids: ['a', 'b'], titles: ['Alpha', 'Beta'], priorities: ['high' as const, 'high' as const], more: 0, count: 2 }
    renderLabel(el, { ...view, title: '2 steps', deck: { ...deck, done: [true, false] } })
    const rows = () => [...el.querySelectorAll<HTMLElement>('.node-deck-list > li[data-member-id]')]
    expect(rows().map(li => li.dataset.done ?? null)).toEqual(['true', null])
    renderLabel(el, { ...view, title: '2 steps', deck: { ...deck, done: [false, false] } })
    expect(rows().map(li => li.dataset.done ?? null)).toEqual([null, null])
  })
})

describe('the stylesheet', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/view/viewer.css'), 'utf8')
  const rules = css.split('}')

  it('has no other priority signal: no glow, no bold or brighter title, no muting', () => {
    expect(css).not.toMatch(/data-priority/)
    expect(css).not.toMatch(/--glow/)
  })

  it('bold on a graph title means only "selected"', () => {
    const bold = rules.filter(rule => /\.node-label/.test(rule) && /font-weight/.test(rule))
    expect(bold.map(r => r.trim().split('{')[0].trim().split('\n').pop())).toEqual([".node-label[data-selected='true'] .node-label-title"])
  })

  it('fades the words with the due-date haze, never the mark', () => {
    const haze = rules.find(rule => /opacity: var\(--haze/.test(rule))!
    expect(haze).toMatch(/\.node-label-words/)
    expect(haze).not.toMatch(/\.node-label-title|\.node-prio|priority-mark/)
  })

  it('draws the mark no smaller than MARK_MIN_PX on screen, in em above that, and never animates it', () => {
    const rule = rules.find(r => r.includes('.node-prio .priority-mark {'))!
    expect(rule).toContain('max(var(--mark-w), calc(var(--mark-min-w) / var(--card-zoom, 1)))')
    expect(rule).toContain('max(var(--mark-h), calc(var(--mark-min-h) / var(--card-zoom, 1)))')
    // every division by the card's zoom falls back to 1, so a card drawn without it still gets a mark
    expect(css).not.toMatch(/var\(--card-zoom\)/)
    expect(css).not.toMatch(/priority-mark[^{]*\{[^}]*(animation|transition)/)
  })

  it("takes the mark's sizes from one place, the same numbers as MARK_EM, PRIORITY_MARK and MARK_MIN_PX", () => {
    const root = rules.find(r => r.includes('--mark-h:'))!
    const value = (name: string) => root.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim()
    expect(value('--mark-h')).toBe(`${MARK_EM.h}em`)
    expect(value('--mark-w')).toBe(`calc(var(--mark-h) * ${PRIORITY_MARK.w} / ${PRIORITY_MARK.h})`)
    expect(value('--mark-gap')).toBe(`${MARK_EM.gap}em`)
    expect(value('--mark-min-w')).toBe(`${MARK_MIN_PX.w}px`)
    expect(value('--mark-min-h')).toBe(`${MARK_MIN_PX.h}px`)
    // nowhere else spells the numbers out: every rule reads the properties
    const rest = css.replace(root, '')
    expect(rest).not.toMatch(new RegExp(`${MARK_EM.h}em|${MARK_EM.gap}em|\\* ${PRIORITY_MARK.w} / ${PRIORITY_MARK.h}`))
    // and the search's mark column is as wide as the mark, read from the same property
  })

  it("dims a done deck member's mark, as a done step's mark dims with its card", () => {
    const rule = rules.find(r => r.includes(".node-deck-list li[data-done='true'] .priority-mark"))
    expect(rule).toMatch(/filter: brightness\(0\.\d+\)/)
  })
})

describe('markRoom', () => {
  it('is nothing for normal', () => {
    expect(markRoom('normal', 1)).toBe(0)
  })

  it('is the mark and its gap in em of the title at scale 1', () => {
    const em = LABEL_TEXT.font
    expect(markRoom('high', 1)).toBeCloseTo(em * (MARK_EM.h * (PRIORITY_MARK.w / PRIORITY_MARK.h) + MARK_EM.gap))
    expect(markRoom('low', 1)).toBe(markRoom('high', 1))
  })

  it('zoomed far out, the mark keeps its minimum size on screen, so it takes more of the card', () => {
    const zoom = LABEL_SCALE.min * 0.85
    expect(markRoom('high', zoom)).toBeCloseTo(MARK_MIN_PX.w / zoom + LABEL_TEXT.font * MARK_EM.gap)
    expect(markRoom('high', zoom)).toBeGreaterThan(markRoom('high', 1))
  })

  it('always fits inside the text block, which never widens: the slot already reserves it', () => {
    for (const zoom of [LABEL_SCALE.min * 0.85, 0.5, 1, LABEL_SCALE.max * NEAR_MAX]) expect(markRoom('high', zoom)).toBeLessThan(LABEL_TEXT.width / 4)
    expect(TEXT_RIGHT).toBe(LABEL_TEXT.left + LABEL_TEXT.width)
    // slotTail measures to the text block's right edge, which holds the mark and the words
    const cardW = 170
    const colGap = 36
    const reach = DOT.cx + (TEXT_RIGHT - DOT.cx) * NEAR_MAX
    expect(slotTail(NEAR_MAX, cardW, colGap)).toBe(Math.ceil(reach - cardW - colGap - (DOT.cx - SIZE.near * NEAR_MAX - 4)))
  })
})

describe('labelFor / syncLabels', () => {
  const view = { status: 'todo' as const, state: 'ready' as const, chain: '' as const, selected: false, dim: false, priority: 'normal' as const }

  it('creates one element per id and reuses it', () => {
    const labels = new Map<string, HTMLDivElement>()
    const first = labelFor(labels, 'a', () => {})
    expect(labelFor(labels, 'a', () => {})).toBe(first)
    expect(labels.size).toBe(1)
  })

  it('renders current nodes and removes labels of deleted nodes from the map and the DOM', () => {
    const labels = new Map<string, HTMLDivElement>()
    const overlay = document.createElement('div')
    syncLabels(labels, [{ id: 'a', title: 'A', ...view }, { id: 'b', title: 'B', ...view }], () => {})
    overlay.append(labels.get('a')!, labels.get('b')!)
    syncLabels(labels, [{ id: 'a', title: 'A2', ...view }], () => {})
    expect([...labels.keys()]).toEqual(['a'])
    expect(overlay.children).toHaveLength(1)
    expect(labels.get('a')!.getAttribute('aria-label')).toBe('A2')
  })
})

describe('stackLabels', () => {
  it('stacks labels left to right, so a circle always draws over the text of any step to its left', () => {
    const labels = new Map(['c', 'a', 'b', 'd'].map(id => [id, createLabelElement(id, () => {})]))
    // a and d share a column (a above): any order works there, the text starts right of the column's circles
    stackLabels(labels, [
      { id: 'b', x: 0, y: 0 },
      { id: 'c', x: 206, y: 0 },
      { id: 'a', x: -206, y: 0 },
      { id: 'd', x: -206, y: 122 },
    ])
    const z = (id: string) => Number(labels.get(id)!.style.zIndex)
    expect(z('a')).toBeLessThan(z('b'))
    expect(z('d')).toBeLessThan(z('b'))
    expect(z('b')).toBeLessThan(z('c'))
    expect(z('a')).toBeGreaterThan(0)
  })

  it('skips positions without a label', () => {
    const labels = new Map([['a', createLabelElement('a', () => {})]])
    expect(() => stackLabels(labels, [{ id: 'gone', x: 0, y: 0 }, { id: 'a', x: 1, y: 0 }])).not.toThrow()
    expect(labels.get('a')!.style.zIndex).not.toBe('')
  })

  it("hands a label its walls (where a block's lanes run past it) as data-walls, and takes them back when the lanes are gone", () => {
    const labels = new Map([['a', createLabelElement('a', () => {})]])
    stackLabels(labels, [{ id: 'a', x: 0, y: 0, walls: [-120, 190.5] }])
    expect(labels.get('a')!.dataset.walls).toBe('-120,190.5')
    stackLabels(labels, [{ id: 'a', x: 0, y: 0 }])
    expect(labels.get('a')!.dataset.walls).toBeUndefined()
  })

  it("hands a label its wallRuns (lanes ending a row or two away, each with its run's span) as data-wall-runs, and takes them back", () => {
    const labels = new Map([['a', createLabelElement('a', () => {})]])
    stackLabels(labels, [{ id: 'a', x: 0, y: 0, wallRuns: [{ dx: 40, top: -300, bottom: -60 }, { dx: -12.5, top: 80, bottom: 122 }] }])
    expect(labels.get('a')!.dataset.wallRuns).toBe('40:-300:-60,-12.5:80:122')
    stackLabels(labels, [{ id: 'a', x: 0, y: 0 }])
    expect(labels.get('a')!.dataset.wallRuns).toBeUndefined()
  })

  it('hands a label its wallDot (the card centre of a step an arrow climbs past it into) as data-wall-dot, and takes it back', () => {
    const labels = new Map([['a', createLabelElement('a', () => {})]])
    stackLabels(labels, [{ id: 'a', x: 0, y: 0, walls: [300], wallDot: 206 }])
    expect(labels.get('a')!.dataset.wallDot).toBe('206')
    stackLabels(labels, [{ id: 'a', x: 0, y: 0, walls: [300] }])
    expect(labels.get('a')!.dataset.wallDot).toBeUndefined()
    // with the climb's span, after it
    stackLabels(labels, [{ id: 'a', x: 0, y: 0, walls: [300], wallDot: 206, wallDotRun: { top: -40, bottom: 122 } }])
    expect(labels.get('a')!.dataset.wallDot).toBe('206:-40:122')
  })
})

describe('shakeLabel', () => {
  it('sets data-shake for 600 ms and restarts when repeated', () => {
    vi.useFakeTimers()
    try {
      expect(SHAKE_MS).toBe(600)
      const el = createLabelElement('a', () => {})
      shakeLabel(el)
      expect(el.dataset.shake).toBe('true')
      vi.advanceTimersByTime(400)
      shakeLabel(el)
      vi.advanceTimersByTime(400)
      expect(el.dataset.shake).toBe('true')
      vi.advanceTimersByTime(200)
      expect(el.dataset.shake).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('due on a label', () => {
  const view = { title: 'Ship it', status: 'todo' as const, state: 'ready' as const, chain: '' as const, selected: false, dim: false, priority: 'normal' as const }
  const far = { date: '2099-01-01', text: 'Jan 1, 2099', strength: 0.4, overdue: false, radius: 7, scale: 0.85 }
  const late = { date: '2000-01-01', text: 'Jan 1, 2000 · 26 years late', strength: 1, overdue: true, radius: 16, scale: 1.3 }

  it('has a due line under the title', () => {
    const el = createLabelElement('a', () => {})
    const kids = [...el.querySelector('.node-label-text')!.children].map(c => c.className)
    expect(kids.indexOf('node-label-due')).toBe(kids.indexOf('node-label-title') + 1)
  })

  it('shows the text, the same date in the tooltip and the haze', () => {
    const el = createLabelElement('a', () => {})
    renderLabel(el, { ...view, due: far })
    expect(el.querySelector('.node-label-due')?.textContent).toBe('Jan 1, 2099')
    expect(el.title).toBe('Ship it (due Jan 1, 2099)')
    expect(el.style.getPropertyValue('--haze')).toBe('0.4')
    expect(el.hasAttribute('data-overdue')).toBe(false)
  })

  it('marks an overdue node', () => {
    const el = createLabelElement('a', () => {})
    renderLabel(el, { ...view, due: late })
    expect(el.dataset.overdue).toBe('true')
    expect(el.title).toBe('Ship it (due Jan 1, 2000 · 26 years late)')
  })

  it('is at full haze when selected or on the chain', () => {
    const el = createLabelElement('a', () => {})
    renderLabel(el, { ...view, due: far, selected: true })
    expect(el.style.getPropertyValue('--haze')).toBe('1')
    renderLabel(el, { ...view, due: far, chain: 'up' })
    expect(el.style.getPropertyValue('--haze')).toBe('1')
    expect(el.querySelector('.node-label-due')?.textContent).toBe('Jan 1, 2099')
  })

  it('leaves an undated node as it was, and clears everything when the date goes', () => {
    const el = createLabelElement('a', () => {})
    renderLabel(el, { ...view, due: late })
    renderLabel(el, view)
    expect(el.querySelector('.node-label-due')?.textContent).toBe('')
    expect(el.hasAttribute('data-overdue')).toBe(false)
    expect(el.style.getPropertyValue('--haze')).toBe('')
    expect(el.title).toBe('Ship it')
  })

  it('marks an inherited date and names where it comes from; an own date or none clears the mark', () => {
    const el = createLabelElement('a', () => {})
    const inherited = { ...far, text: 'by Jan 1, 2099', inherited: true as const, from: 'Launch' }
    renderLabel(el, { ...view, due: inherited })
    expect(el.querySelector('.node-label-due')?.textContent).toBe('by Jan 1, 2099')
    expect(el.dataset.dueInherited).toBe('true')
    expect(el.title).toBe('Ship it (due by Jan 1, 2099, from Launch)')
    renderLabel(el, { ...view, due: far })
    expect(el.hasAttribute('data-due-inherited')).toBe(false)
    expect(el.title).toBe('Ship it (due Jan 1, 2099)')
    renderLabel(el, { ...view, due: inherited })
    renderLabel(el, view)
    expect(el.hasAttribute('data-due-inherited')).toBe(false)
  })

  it('sets the dot radius from the due date, 11px when undated, and clears it again', () => {
    const el = createLabelElement('a', () => {})
    const r = () => el.style.getPropertyValue('--dot-r')
    renderLabel(el, { ...view, due: far })
    expect(r()).toBe('7px')
    renderLabel(el, { ...view, due: late })
    expect(r()).toBe('16px')
    renderLabel(el, view)
    expect(r()).toBe('11px')
    expect(el.dataset.priority).toBe('normal')
    expect(el.dataset.status).toBe('todo')
  })
})

describe('nearness on a label', () => {
  const view = { title: 'Ship it', status: 'todo' as const, state: 'ready' as const, chain: '' as const, selected: false, dim: false, priority: 'normal' as const }
  const due = { date: '2099-01-01', text: 'x', strength: 1, overdue: false, radius: 11 }

  it('sets --near-scale and data-near: "true" above 1, "false" below, neither at 1 or undated', () => {
    const el = createLabelElement('a', () => {})
    renderLabel(el, { ...view, due: { ...due, scale: 1.3 } })
    expect(el.dataset.near).toBe('true')
    expect(el.style.getPropertyValue('--near-scale')).toBe('1.3')
    renderLabel(el, { ...view, due: { ...due, scale: 0.85 } })
    expect(el.dataset.near).toBe('false')
    expect(el.style.getPropertyValue('--near-scale')).toBe('0.85')
    renderLabel(el, { ...view, due: { ...due, scale: 1 } })
    expect(el.hasAttribute('data-near')).toBe(false)
    expect(el.style.getPropertyValue('--near-scale')).toBe('')
    renderLabel(el, { ...view, due: { ...due, scale: 1.04 } })
    expect(el.dataset.near).toBe('true')
    renderLabel(el, view)
    expect(el.hasAttribute('data-near')).toBe(false)
    expect(el.style.getPropertyValue('--near-scale')).toBe('')
  })

  it('a label made afresh for a node (a deck folded and unfolded) carries its scale at once', () => {
    const labels = new Map<string, HTMLDivElement>()
    const node = { id: 'a', ...view, due: { ...due, scale: 1.3 } }
    syncLabels(labels, [node], () => {})
    const first = labels.get('a')!
    syncLabels(labels, [], () => {})
    syncLabels(labels, [node], () => {})
    const again = labels.get('a')!
    expect(again).not.toBe(first)
    expect(again.style.getPropertyValue('--near-scale')).toBe('1.3')
  })
})

describe('text block', () => {
  it('holds the title and the due line, with the id tag after them', () => {
    const el = createLabelElement('a', () => {})
    const text = el.querySelector(':scope > .node-card > .node-label-text')!
    expect([...text.children].map(c => c.className)).toEqual(['node-label-title', 'node-label-due', 'node-label-id'])
  })
})

describe('renderLabel: a deck', () => {
  const view = { title: '8 steps', status: 'todo' as const, state: 'ready' as const, chain: '' as const, selected: false, dim: false, priority: 'normal' as const }
  const deck = { ids: ['a', 'b', 'c'], titles: ['Alpha', 'Beta', 'Gamma'], priorities: ['normal' as const, 'normal' as const, 'normal' as const], more: 0, count: 3 }

  it('is tagged with its size, and the tags and parts go when the label becomes a plain node', () => {
    const el = createLabelElement('deck:goal', () => {})
    renderLabel(el, { ...view, deck: { ...deck, count: 8 } })
    expect(el.dataset.deck).toBe('true')
    expect(el.dataset.deckSize).toBe('8')
    expect(el.getAttribute('data-node-id')).toBe('deck:goal')
    renderLabel(el, view)
    expect(el.hasAttribute('data-deck')).toBe(false)
    expect(el.hasAttribute('data-deck-size')).toBe(false)
    expect(el.querySelector('.node-deck-dot')).toBeNull()
    expect(el.querySelector('.node-deck-list')).toBeNull()
    expect(el.style.getPropertyValue('--deck-dx')).toBe('')
  })

  it('fans out min(count, 5) circles, the first being the node dot, each offset behind the one before', () => {
    const el = createLabelElement('deck:goal', () => {})
    renderLabel(el, { ...view, deck: { ...deck, count: 8 } })
    const card = el.querySelector(':scope > .node-card')!
    expect([...card.children].filter(c => c.matches('.node-dot, .node-deck-dot')).map(c => c.className)).toEqual(['node-dot', 'node-deck-dot', 'node-deck-dot', 'node-deck-dot', 'node-deck-dot'])
    const dots = [...card.querySelectorAll<HTMLElement>('.node-deck-dot')]
    expect(dots.map(d => d.style.getPropertyValue('--deck-i'))).toEqual(['1', '2', '3', '4'])
    // the offsets come from DECK_FAN alone: the stylesheet reads them as --deck-dx / --deck-dy
    expect(el.style.getPropertyValue('--deck-dx')).toBe(`${DECK_FAN.dx}px`)
    expect(el.style.getPropertyValue('--deck-dy')).toBe(`${DECK_FAN.dy}px`)
    renderLabel(el, { ...view, deck: { ...deck, count: 2 } })
    expect(card.querySelectorAll('.node-deck-dot')).toHaveLength(1)
    renderLabel(el, { ...view, deck: { ...deck, count: 1 } })
    expect(card.querySelectorAll('.node-deck-dot')).toHaveLength(0)
  })

  it('lists the member titles beside the fan, with "+N more" last, inside the text block', () => {
    const el = createLabelElement('deck:goal', () => {})
    renderLabel(el, { ...view, deck: { ...deck, more: 2, count: 5 } })
    const list = el.querySelector(':scope > .node-card > .node-label-text > ul.node-deck-list')!
    const items = [...list.children] as HTMLElement[]
    expect(items.map(li => li.textContent)).toEqual(['Alpha', 'Beta', 'Gamma', '+2 more'])
    expect(items.map(li => li.getAttribute('data-member-id'))).toEqual(['a', 'b', 'c', null])
    expect(items[3].className).toBe('node-deck-more')
    // it lists every step of the deck rather than picking a member, and says so
    expect(items[3].title).toBe('List all 5 steps')
    // titles are cut to one line in the list (so its height is known to the layout); the full title is the tooltip
    expect(items.slice(0, 3).map(li => li.title)).toEqual(['Alpha', 'Beta', 'Gamma'])
    renderLabel(el, { ...view, deck })
    expect(el.querySelectorAll('.node-deck-list > li')).toHaveLength(3)
  })

  it('picks a member from its list item and the parent (the deck id) from anywhere else', () => {
    const onPick = vi.fn()
    const el = createLabelElement('deck:goal', onPick)
    renderLabel(el, { ...view, deck: { ...deck, more: 1, count: 4 } })
    const item = el.querySelector<HTMLElement>('li[data-member-id="b"]')!
    item.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    item.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }))
    item.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))
    item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    expect(onPick.mock.calls).toEqual([['b'], ['b'], ['b'], ['b']])
    onPick.mockClear()
    el.querySelector<HTMLElement>('.node-deck-more')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    el.querySelector<HTMLElement>('.node-dot')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(onPick.mock.calls).toEqual([['deck:goal'], ['deck:goal'], ['deck:goal']])
  })
})

describe('renderLabel: what a deck holds', () => {
  const view = { title: '23 steps', status: 'todo' as const, state: 'waiting' as const, chain: '' as const, selected: false, dim: false, priority: 'normal' as const }
  const deck = { ids: ['a', 'b'], titles: ['Alpha', 'Beta'], more: 21, count: 23 }
  const mix = [{ state: 'ready' as const, n: 2 }, { state: 'waiting' as const, n: 21 }]

  it('says how many steps are in each state on a line under its title, each count in its state colour', () => {
    const el = createLabelElement('deck:goal', () => {})
    renderLabel(el, { ...view, deck: { ...deck, mix, readyInside: true } })
    const text = el.querySelector('.node-label-text')!
    expect([...text.children].map(c => c.className)).toEqual(['node-label-title', 'node-deck-mix', 'node-label-due', 'node-deck-list', 'node-label-id'])
    const line = el.querySelector('.node-deck-mix')!
    expect(line.textContent).toBe('2 ready, 21 waiting')
    expect([...line.querySelectorAll<HTMLElement>('[data-state]')].map(s => [s.dataset.state, s.textContent])).toEqual([
      ['ready', '2 ready'],
      ['waiting', '21 waiting'],
    ])
    // the whole of it is the label's name and tooltip too
    expect(el.getAttribute('aria-label')).toBe('23 steps · 2 ready, 21 waiting')
    expect(el.title).toBe('23 steps · 2 ready, 21 waiting')
    // a step inside can be started now though the deck is painted waiting: it carries the ready marker
    expect(el.dataset.deckReady).toBe('true')
  })

  it('keeps the line (empty) when every step is in one state, and drops it and the marker for a plain step', () => {
    const el = createLabelElement('deck:goal', () => {})
    renderLabel(el, { ...view, deck: { ...deck, mix, readyInside: true } })
    renderLabel(el, { ...view, deck: { ...deck, mix: [], readyInside: false } })
    expect(el.querySelector('.node-deck-mix')!.textContent).toBe('')
    expect(el.hasAttribute('data-deck-ready')).toBe(false)
    expect(el.getAttribute('aria-label')).toBe('23 steps')
    renderLabel(el, { ...view, title: 'Plain' })
    expect(el.querySelector('.node-deck-mix')).toBeNull()
  })
})

describe('deckHeight', () => {
  it('is the height of the deck\'s text block at the largest due-date scale, never less than a card', () => {
    expect(deckHeight(0, false)).toBeGreaterThanOrEqual(44)
    const six = deckHeight(6, false)
    expect(deckHeight(6, true)).toBeGreaterThan(six)
    expect(deckHeight(5, false)).toBeLessThan(six)
    // one listed line per member, the same whatever the titles say
    // (to within the whole unit the height is rounded up to)
    expect(Math.abs(six - deckHeight(5, false) - (deckHeight(5, false) - deckHeight(4, false)))).toBeLessThanOrEqual(1)
  })
  it('leaves room for a deck whose nearest member inherits a date several levels down (NEAR_MAX, not NEAR.near)', () => {
    // 3 listed lines: title 15.6 + state line 12.5 + due 12 + gap 2 + 3 x 14.5 = 85.6 units at scale 1
    expect(deckHeight(3, false)).toBe(Math.ceil(85.6 * NEAR_MAX))
  })
})

describe('deckWidth', () => {
  it('leaves room on each side for a neighbour drawn at the largest due-date scale', () => {
    const cardW = 170
    const colGap = 36
    const w = deckWidth(cardW, colGap)
    const pad = (w - cardW) / 2
    // a card at NEAR_MAX reaches this far from its slot's left edge (its circle stays put, its text grows)
    const reach = DOT.cx + (190 - DOT.cx) * NEAR_MAX
    // the step on the left: its text ends before the deck's circle (and ring) begins
    expect(reach).toBeLessThanOrEqual(cardW + colGap + pad + DOT.cx - 16 * NEAR_MAX - 4)
    // the deck's own text ends before the circle of the step on its right
    expect(pad + reach).toBeLessThanOrEqual(w + colGap + DOT.cx - 16 * NEAR_MAX - 4)
    // no wider than that needs
    expect(deckWidth(cardW, colGap + 1000)).toBe(cardW)
  })
})

describe('slotTail', () => {
  const cardW = 170
  const colGap = 36
  // where the circle (and ring) of the step on the right begins, from this slot's left, at its largest
  const nextDot = cardW + colGap + DOT.cx - 16 * NEAR_MAX - 4
  it('is the room a card drawn at `scale` needs past its slot so its words end before the next circle', () => {
    for (const scale of [1.1, 1.2, 1.3, NEAR_MAX]) {
      const reach = DOT.cx + (190 - DOT.cx) * scale
      const tail = slotTail(scale, cardW, colGap)
      expect(tail).toBeGreaterThan(0)
      expect(reach).toBeLessThanOrEqual(nextDot + tail)
      expect(reach).toBeGreaterThan(nextDot + tail - 1)
    }
  })
  it('is nothing for a card at its usual size or smaller', () => {
    expect(slotTail(1, cardW, colGap)).toBe(0)
    expect(slotTail(0.85, cardW, colGap)).toBe(0)
  })
  it("is half of a deck's extra width at the largest scale", () => {
    expect(deckWidth(cardW, colGap)).toBe(cardW + 2 * slotTail(NEAR_MAX, cardW, colGap))
  })
})

describe('deckListed', () => {
  it('lists up to the maximum at card scale 1 or below', () => {
    expect(deckListed(3, 6, 1)).toBe(3)
    expect(deckListed(9, 6, 1)).toBe(6)
    expect(deckListed(9, 6, 0.6)).toBe(6)
  })

  it('lists fewer names when cards draw larger than their slot, so the list stays inside the room its row keeps', () => {
    for (const [count, scale] of [[8, 1.3], [8, 1.8], [4, 1.5], [20, 2.5]]) {
      const k = deckListed(count, 6, scale)
      const room = deckHeight(Math.min(count, 6), count > 6)
      expect(k).toBeLessThan(Math.min(count, 6))
      // what it draws at that scale fits the room
      if (k > 0) expect(deckHeight(k, k < count) * scale).toBeLessThanOrEqual(room)
    }
  })

  it('counts the deck at the size its date draws it: the room its row keeps for a near date is free for the words of one drawn smaller', () => {
    // the row keeps room for the deck drawn at NEAR_MAX: undated (1) its words may draw that much larger and still fit
    expect(deckListed(2, 6, 1.05, 1)).toBe(2)
    expect(deckListed(9, 6, 1.2, 1)).toBe(6)
    expect(deckListed(9, 6, NEAR_MAX, 1)).toBe(6)
    // left out, the date is taken at its largest, as before
    expect(deckListed(9, 6, 1.2)).toBe(deckListed(9, 6, 1.2, NEAR_MAX))
    expect(deckListed(9, 6, 1.2)).toBeLessThan(6)
    for (const [count, scale, date] of [[2, 1.5, 1], [9, 1.6, 1], [9, 2.4, 1.1], [20, 1.3, 1.3]]) {
      const k = deckListed(count, 6, scale, date)
      const room = deckHeight(Math.min(count, 6), count > 6)
      // what it draws at that scale and date fits the room
      if (k > 0) expect(deckHeight(k, k < count) * scale * (date / NEAR_MAX)).toBeLessThanOrEqual(room)
    }
  })
})
