// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { focusSoon } from './focusSoon.js'

/** rAF driven by hand: `frame()` runs the callbacks queued so far. */
let queue: FrameRequestCallback[] = []
const frame = () => {
  const now = queue
  queue = []
  for (const f of now) f(0)
}
beforeEach(() => {
  queue = []
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => queue.push(f))
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    queue[id - 1] = () => {}
  })
  document.body.innerHTML = '<button id="start">start</button><button id="fallback">group</button><input id="other" />'
})
afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})
const el = (id: string) => document.getElementById(id)!
const addTarget = () => {
  document.body.insertAdjacentHTML('beforeend', '<button id="target">step</button>')
  return el('target')
}

describe('focusSoon', () => {
  it('focuses the element once it is drawn, a few frames later', () => {
    el('start').focus()
    const drawn: { el?: HTMLElement } = {}
    focusSoon(() => drawn.el, () => el('fallback'))
    frame()
    frame()
    drawn.el = addTarget()
    frame()
    expect(document.activeElement).toBe(drawn.el)
  })

  it('keeps trying while the focus is on the page or still where it started, and falls back to the Group button from the page only', () => {
    el('start').focus()
    focusSoon(() => undefined, () => el('fallback'), 3)
    frame()
    el('start').remove() // the list closed: the focus falls to the page
    for (let i = 0; i < 5; i++) frame()
    expect(document.activeElement).toBe(el('fallback'))
  })

  it('stops as soon as the user put the focus somewhere else, and never takes it back', () => {
    el('start').focus()
    const drawn: { el?: HTMLElement } = {}
    focusSoon(() => drawn.el, () => el('fallback'), 3)
    frame()
    el('other').focus()
    drawn.el = addTarget()
    for (let i = 0; i < 5; i++) frame()
    expect(document.activeElement).toBe(el('other'))
  })

  it('no fallback when the focus is somewhere other than the page when the tries run out', () => {
    el('start').focus()
    focusSoon(() => undefined, () => el('fallback'), 2)
    for (let i = 0; i < 4; i++) frame()
    expect(document.activeElement).toBe(el('start'))
  })

  it('does nothing once cancelled (the graph went away)', () => {
    el('start').focus()
    const drawn: { el?: HTMLElement } = {}
    const cancel = focusSoon(() => drawn.el, () => el('fallback'))
    frame()
    cancel()
    drawn.el = addTarget()
    for (let i = 0; i < 3; i++) frame()
    expect(document.activeElement).toBe(el('start'))
  })

  it('says it is done once, however it ends: focused, given up, fallen back or cancelled (so a caller can forget it)', () => {
    const drawn: { el?: HTMLElement } = {}
    const ends: string[] = []
    el('start').focus()
    focusSoon(() => drawn.el, () => el('fallback'), 30, () => ends.push('focused'))
    drawn.el = addTarget()
    frame()
    frame()
    el('start').focus()
    focusSoon(() => undefined, () => el('fallback'), 30, () => ends.push('given up'))
    el('other').focus()
    frame()
    el('other').blur()
    focusSoon(() => undefined, () => el('fallback'), 2, () => ends.push('fallen back'))
    for (let i = 0; i < 4; i++) frame()
    el('start').focus()
    const cancel = focusSoon(() => undefined, () => el('fallback'), 30, () => ends.push('cancelled'))
    cancel()
    cancel()
    for (let i = 0; i < 3; i++) frame()
    expect(ends).toEqual(['focused', 'given up', 'fallen back', 'cancelled'])
  })
})
