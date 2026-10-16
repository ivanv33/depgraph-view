// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import DeckList, { type DeckListFrame } from './DeckList.js'
import type { DeckRow } from '../engine/deckList.js'

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})
afterEach(cleanup)

const row = (id: string, extra: Partial<DeckRow> = {}): DeckRow => ({ id, title: `Step ${id}`, state: 'ready', due: null, dateText: null, priority: 'normal', ...extra })

describe('DeckList rows', () => {
  it("show each step's priority mark before its title, say it in the row's name, and keep a column for it", () => {
    render(
      <DeckList
        deckId="deck:x"
        title="3 steps"
        mix={[]}
        rows={[row('a', { priority: 'high' }), row('b'), row('c', { priority: 'low', state: 'done' })]}
        anchor={() => undefined}
        frameRef={{ current: null }}
        around={{}}
        onPick={vi.fn()}
        onClose={vi.fn()}
        onFocusLost={vi.fn()}
      />,
    )
    const rows = screen.getAllByTestId('deck-list-row')
    expect(rows.map(r => r.querySelector('svg.priority-mark')?.getAttribute('data-priority') ?? null)).toEqual(['high', null, 'low'])
    // the row's name already says it: the mark itself is not announced again
    expect(rows[0].querySelector('svg.priority-mark')!.getAttribute('aria-hidden')).toBe('true')
    expect(rows[0].getAttribute('aria-label')).toBe('Step a, high priority, ready')
    expect(rows[1].getAttribute('aria-label')).toBe('Step b, ready')
    expect(rows[2].getAttribute('aria-label')).toBe('Step c, low priority, done')
    // every row has the column, empty for normal, so the titles line up
    expect(rows.map(r => !!r.querySelector('.deck-list-prio'))).toEqual([true, true, true])
    // the mark comes before the name
    expect(rows[0].querySelector('.deck-list-prio')!.nextElementSibling!.className).toBe('deck-list-name')
  })

  it("dims a done row's mark as the graph dims a done step", () => {
    const css = readFileSync(resolve(process.cwd(), 'src/view/deckList.css'), 'utf8')
    expect(css).toMatch(/\.deck-list-rows \[data-state='done'\] \.priority-mark \{ filter: brightness\(0\.7\); \}/)
  })
})

describe('DeckList linking', () => {
  const props = {
    deckId: 'deck:x',
    title: '2 steps',
    mix: [],
    rows: [row('a'), row('b')],
    anchor: () => undefined,
    frameRef: { current: null },
    around: {},
    onPick: vi.fn(),
    onClose: vi.fn(),
    onFocusLost: vi.fn(),
  }
  it('while linking, says to pick the step to link to and offers no branch to open', () => {
    const { rerender } = render(<DeckList {...props} onOpenBranch={vi.fn()} />)
    expect(screen.queryByText('Pick the step to link to.')).toBeNull()
    expect(screen.getByTestId('deck-list-open-branch')).toBeTruthy()
    rerender(<DeckList {...props} onOpenBranch={vi.fn()} linking />)
    expect(screen.getByText('Pick the step to link to.').className).toBe('deck-list-hint')
    expect(screen.queryByTestId('deck-list-open-branch')).toBeNull()
  })
})

describe('DeckList place', () => {
  /** A deck label drawn with its circle and text at `x` (px from the left), whatever is asked. */
  const deckAt = (x: { v: number }) => {
    const deck = document.createElement('div')
    const dot = document.createElement('span')
    dot.className = 'node-dot'
    const text = document.createElement('span')
    text.className = 'node-label-text'
    deck.append(dot, text)
    document.body.append(deck)
    const box = (w: number) => () => ({ left: x.v, top: 100, right: x.v + w, bottom: 120, width: w, height: 20, x: x.v, y: 100, toJSON() {} }) as DOMRect
    dot.getBoundingClientRect = box(20)
    text.getBoundingClientRect = box(80)
    return deck
  }

  it("reads in the graph's frame and writes only when the frame hands its place back, and lets go of the frame when closed", () => {
    const x = { v: 200 }
    const deck = deckAt(x)
    const frameRef: { current: DeckListFrame | null } = { current: null }
    const { unmount } = render(
      <DeckList
        deckId="deck:x"
        title="1 step"
        mix={[]}
        rows={[row('a')]}
        anchor={() => deck}
        frameRef={frameRef}
        around={{}}
        onPick={vi.fn()}
        onClose={vi.fn()}
        onFocusLost={vi.fn()}
      />,
    )
    const list = screen.getByTestId('deck-list')
    // placed at once, before it is first drawn: right of the deck's text
    expect(list.style.left).toBe('288px')
    expect(frameRef.current).toBeTypeOf('function')
    // the view moves: the read measures the deck again and writes nothing; its place is written when handed back
    x.v = 300
    deck.style.transform = 'translate(100px, 0)'
    const place = frameRef.current!()
    expect(list.style.left).toBe('288px')
    expect(place).toBeTypeOf('function')
    place!()
    expect(list.style.left).toBe('388px')
    // nothing moved: nothing to read or write
    expect(frameRef.current!()).toBeUndefined()
    unmount()
    expect(frameRef.current).toBeNull()
    deck.remove()
  })

  it('ends above the Legend in the bottom-left corner while the Legend is shown', () => {
    const deck = deckAt({ v: 10 })
    const size = { w: window.innerWidth, h: window.innerHeight }
    const setView = (w: number, h: number) => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: w })
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: h })
    }
    const open = () =>
      render(
        <DeckList
          deckId="deck:x"
          title="1 step"
          mix={[]}
          rows={[row('a')]}
          anchor={() => deck}
          frameRef={{ current: null }}
          around={{}}
          onPick={vi.fn()}
          onClose={vi.fn()}
          onFocusLost={vi.fn()}
        />,
      )
    try {
      // 600 px tall: the Legend's top edge is 304 px above the bottom, so the list ends 8 px above it (296 - 8 - 8 top)
      setView(1000, 600)
      open()
      expect(screen.getByTestId('deck-list').style.maxHeight).toBe('280px')
      cleanup()
      // narrower than 640 px the Legend is hidden: the list may reach the window's bottom margin
      setView(600, 600)
      open()
      expect(screen.getByTestId('deck-list').style.maxHeight).toBe('440px')
    } finally {
      setView(size.w, size.h)
      deck.remove()
    }
  })
})
