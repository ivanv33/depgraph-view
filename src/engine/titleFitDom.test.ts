// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BRACKET_CLEAR } from './bracketRoom.js'
import { FIT } from './titleFit.js'
import { MARK_CSS, PLATE } from './plateFit.js'
import { aimPlateHoles, boostStep, deckScale, fitBrackets, goalArrowBoxes, labelRanks, laneWall, runTitleFit, runWalls, TITLE_CSS, titleBoost, titleLine, topOf, viewMoved, watchFonts } from './titleFitDom.js'
import { createLabelElement, deckListed, DOT, renderLabel, type LabelNode } from './nodeLabel.js'
import { LAYOUT } from './layered.js'
import { LABEL_SCALE, labelScale } from './camera.js'

const node = (id: string, extra: Partial<LabelNode> = {}): LabelNode => ({
  id,
  title: `Step ${id}`,
  status: 'todo',
  state: 'waiting',
  chain: '',
  selected: false,
  dim: false,
  priority: 'normal',
  ...extra,
})

describe('titleBoost', () => {
  it('draws an undated title half a px over the floor however small the cards get, and adds nothing once they draw it larger', () => {
    expect(titleBoost(0.45) * 13 * 0.45).toBeCloseTo(FIT.floor + 0.5)
    expect(titleBoost(1)).toBe(1)
    expect(titleBoost((FIT.floor + 0.5) / 13)).toBe(1)
  })
})

describe('labelRanks', () => {
  it('ranks from what each label shows, in the order given', () => {
    const near = { date: 'x', text: 'x', strength: 1, overdue: false, radius: 16, scale: 1.3 }
    const far = { ...near, strength: 0.5 }
    const r = labelRanks(
      [node('a'), node('b', { selected: true }), node('c', { chain: 'up' }), node('d', { due: near }), node('e', { due: far }), node('f', { priority: 'high' }), node('g', { state: 'ready' })],
      'a',
    )
    expect(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(id => r.get(id)!.tier)).toEqual([2, 0, 1, 4, 8, 5, 7])
    expect(r.get('e')!.order).toBe(4)
  })

  it('ranks the goal, then (after dates and priority) its own needs, and a step being done as a ready one', () => {
    const plan = [
      { id: 'goal', depends_on: ['n1', 'n2'] },
      { id: 'n1', depends_on: ['x'] },
      { id: 'n2', depends_on: [] },
      { id: 'x', depends_on: [] },
    ]
    const top = topOf(plan)
    expect([...top.goals]).toEqual(['goal'])
    expect([...top.needs].sort()).toEqual(['n1', 'n2'])
    const r = labelRanks([node('goal'), node('n1'), node('n2', { priority: 'high' }), node('x', { state: 'doing' })], null, top)
    expect(['goal', 'n1', 'n2', 'x'].map(id => r.get(id)!.tier)).toEqual([3, 6, 5, 7])
  })
})

describe('watchFonts', () => {
  it('reports once the fonts are ready and again when more load, and stops when told', async () => {
    const target = new EventTarget()
    let ready!: () => void
    const fonts = Object.assign(target, { ready: new Promise<void>(r => (ready = r)) }) as unknown as FontFaceSet
    let calls = 0
    const stop = watchFonts(() => calls++, fonts)
    expect(calls).toBe(0)
    ready()
    await Promise.resolve()
    await Promise.resolve()
    expect(calls).toBe(1)
    target.dispatchEvent(new Event('loadingdone'))
    expect(calls).toBe(2)
    stop()
    target.dispatchEvent(new Event('loadingdone'))
    expect(calls).toBe(2)
  })
  it('reports a font that loads only where it is one the titles draw with', async () => {
    const target = new EventTarget()
    const fonts = Object.assign(target, { ready: new Promise<void>(() => {}) }) as unknown as FontFaceSet
    const loaded = (...families: string[]) => Object.assign(new Event('loadingdone'), { fontfaces: families.map(family => ({ family })) })
    let calls = 0
    watchFonts(() => calls++, fonts, () => '"Instrument Sans", "Instrument Sans Fallback", ui-sans-serif, system-ui, sans-serif')
    // a font for something else on the page (the dev overlay's, in its own shadow root): the titles draw as they did
    target.dispatchEvent(loaded('__nextjs-Geist'))
    expect(calls).toBe(0)
    target.dispatchEvent(loaded('__nextjs-Geist', 'Instrument Sans Fallback'))
    expect(calls).toBe(1)
    target.dispatchEvent(loaded('Instrument Sans'))
    expect(calls).toBe(2)
    // a load that names no faces may be any font
    target.dispatchEvent(new Event('loadingdone'))
    expect(calls).toBe(3)
  })
  it('takes a family named in another case for the same, and any load for a change while the titles name no family', () => {
    const target = new EventTarget()
    const fonts = Object.assign(target, { ready: new Promise<void>(() => {}) }) as unknown as FontFaceSet
    const loaded = (...families: string[]) => Object.assign(new Event('loadingdone'), { fontfaces: families.map(family => ({ family })) })
    let list = '"Instrument Sans", sans-serif'
    let calls = 0
    watchFonts(() => calls++, fonts, () => list)
    // CSS family names match whatever their case
    target.dispatchEvent(loaded('instrument sans'))
    expect(calls).toBe(1)
    target.dispatchEvent(loaded('__nextjs-Geist'))
    expect(calls).toBe(1)
    // the layer read no family (detached when the font loaded): the load may be the titles' own
    list = ''
    target.dispatchEvent(loaded('__nextjs-Geist'))
    expect(calls).toBe(2)
  })
})

describe('viewMoved', () => {
  // fov 60 at z 1000 in a 800x600 view: about 0.52 screen px per layout unit
  const at = { x: 0, y: 0, z: 1000, w: 800, h: 600 }
  it('takes a move of half a screen px or more, a resize or an unknown start for moving', () => {
    expect(viewMoved({ ...at, x: NaN }, at, 60)).toBe(true)
    expect(viewMoved(at, { ...at, w: 801 }, 60)).toBe(true)
    expect(viewMoved(at, { ...at, h: 601 }, 60)).toBe(true)
    // a pan of 1 unit is about 0.52 px; of 0.9 units about 0.47 px
    expect(viewMoved(at, { ...at, x: 1 }, 60)).toBe(true)
    expect(viewMoved(at, { ...at, y: -0.9 }, 60)).toBe(false)
    // a zoom moves the view's edge (400 px from the middle) by 400 * dz / z px
    expect(viewMoved(at, { ...at, z: 1001.3 }, 60)).toBe(true)
    expect(viewMoved(at, { ...at, z: 1001 }, 60)).toBe(false)
  })
  it('takes a camera creeping by a hair, as a zoom eases out, for still', () => {
    expect(viewMoved(at, { ...at, z: 1000.01, x: 0.001 }, 60)).toBe(false)
    expect(viewMoved(at, at, 60)).toBe(false)
  })
})

describe('boostStep', () => {
  it('moves one step per 4% of boost, so a small change keeps a saved shape and a larger one measures again', () => {
    expect(boostStep(1)).toBe(0)
    expect(boostStep(1.01)).toBe(boostStep(1))
    expect(boostStep(1.08)).toBe(2)
    expect(boostStep(1.6)).not.toBe(boostStep(1.5))
  })
})

describe('runTitleFit', () => {
  it('marks each label it can measure and leaves alone one the renderer hides', () => {
    // jsdom lays nothing out: every box is empty, so nothing can be measured and nothing is marked
    const a = createLabelElement('a', () => {})
    const b = createLabelElement('b', () => {})
    renderLabel(a, node('a'))
    renderLabel(b, node('b'))
    b.dataset.titleFit = 'dot'
    b.style.display = 'none'
    document.body.append(a, b)
    const labels = new Map([
      ['a', a],
      ['b', b],
    ])
    const ms = runTitleFit(labels, labelRanks([node('a'), node('b')], null), 1)
    expect(ms).toBeGreaterThanOrEqual(0)
    expect(a.dataset.titleFit).toBeUndefined()
    expect(b.dataset.titleFit).toBe('dot')
  })
})

describe('runTitleFit and the needs drawn elsewhere', () => {
  it("keeps every other title clear of a step's '+N' tag, as of its circle", () => {
    // a's circle is far right; its tag sits where b's 80px title would run (a stand-in place: only the overlap matters).
    // Circles at their card size (22px), so the titles draw at 13px, over the floor.
    const at = (e: Element) => {
      const l = e.closest<HTMLElement>('.node-label')!
      const x = Number(l.dataset.x)
      if (e.classList.contains('node-dot')) return new DOMRect(x - 11, -11, 22, 22)
      if (e.classList.contains('node-label-title')) return new DOMRect(x + 12, -6, 80, 12)
      if (e.classList.contains('node-label-text')) return new DOMRect(x + 12, -6, 150, 12)
      if (e.classList.contains('node-label-elsewhere') && l.dataset.elsewhere) return new DOMRect(110, -6, 20, 12)
      return new DOMRect(0, 0, 0, 0)
    }
    const original = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function (this: Element) {
      return this.closest('.node-label') ? at(this) : original.call(this)
    }
    try {
      const a = createLabelElement('a', () => {})
      const b = createLabelElement('b', () => {})
      a.dataset.x = '300'
      b.dataset.x = '40'
      document.body.append(a, b)
      const labels = new Map([
        ['a', a],
        ['b', b],
      ])
      const fit = (nodes: LabelNode[]) => {
        nodes.forEach(n => renderLabel(labels.get(n.id)!, n))
        runTitleFit(labels, labelRanks(nodes, null), 1)
        return b.dataset.titleFit
      }
      expect(fit([node('a'), node('b')])).toBe('full')
      expect(fit([node('a', { elsewhere: { count: 2, titles: ['x', 'y'] } }), node('b')])).not.toBe('full')
    } finally {
      Element.prototype.getBoundingClientRect = original
    }
  })
})

describe('runTitleFit while the view glides (nothing measured afresh)', () => {
  it('places a step let go of the selection from the shape it had before, so its forced full title does not stay over a neighbour', () => {
    // A stand-in layout: each label at its data-x, its 10px circle there, its 80px title 12px right of it; the selected
    // step's plate a 120px block. b's title runs over a's circle.
    const at = (e: Element) => {
      const l = e.closest<HTMLElement>('.node-label')!
      const x = Number(l.dataset.x)
      const sel = l.dataset.selected === 'true'
      if (e.classList.contains('node-dot')) return new DOMRect(x - 5, -5, 10, 10)
      if (e.classList.contains('node-label-title')) return new DOMRect(x + 12, -6, 80, 12)
      if (e.classList.contains('node-label-text')) return sel ? new DOMRect(x + 25, -10, 120, 20) : new DOMRect(x + 12, -6, 150, 12)
      return new DOMRect(0, 0, 0, 0)
    }
    const original = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function (this: Element) {
      return this.closest('.node-label') ? at(this) : original.call(this)
    }
    try {
      const a = createLabelElement('a', () => {})
      const b = createLabelElement('b', () => {})
      a.dataset.x = '100'
      b.dataset.x = '40'
      document.body.append(a, b)
      const labels = new Map([
        ['a', a],
        ['b', b],
      ])
      const fit = (nodes: LabelNode[], measure: boolean) => {
        nodes.forEach(n => renderLabel(labels.get(n.id)!, n))
        runTitleFit(labels, labelRanks(nodes, null), 1, measure)
        return b.dataset.titleFit
      }
      const plain = [node('a', { priority: 'high' }), node('b')]
      expect(fit(plain, true)).not.toBe('full')
      const picked = [node('a', { priority: 'high' }), node('b', { selected: true })]
      expect(fit(picked, true)).toBe('full')
      // let go while the view glides: decided again from b's saved unselected shape, not kept full as it is drawn
      expect(fit(plain, false)).not.toBe('full')
    } finally {
      Element.prototype.getBoundingClientRect = original
    }
  })
})

describe('runTitleFit and a deck shown in full while the view moves', () => {
  it("cuts or hides a deck whose list has come to cross the selected step's plate or a chain title, rather than keeping it whole as it stands", () => {
    // A stand-in layout: each label at its data-x / data-y, its 10px circle there; a step's 80px title 12px right of
    // it; the selected step's plate a 120px block; the deck's title, state line and a 60px tall list under them.
    // Circles at their card size (22px), so the words draw at 13px, over the floor.
    const at = (e: Element) => {
      const l = e.closest<HTMLElement>('.node-label')!
      const x = Number(l.dataset.x)
      const y = Number(l.dataset.y)
      const sel = l.dataset.selected === 'true'
      const deck = l.dataset.deck === 'true'
      if (e.classList.contains('node-dot')) return new DOMRect(x - 11, y - 11, 22, 22)
      if (deck) {
        if (e.classList.contains('node-label-title')) return new DOMRect(x + 12, y - 40, 80, 12)
        if (e.classList.contains('node-deck-mix')) return new DOMRect(x + 12, y - 28, 80, 10)
        if (e.classList.contains('node-deck-list')) return new DOMRect(x + 12, y - 18, 90, 60)
        if (e.classList.contains('node-label-text')) return new DOMRect(x + 12, y - 40, 150, 82)
        return new DOMRect(0, 0, 0, 0)
      }
      if (e.classList.contains('node-label-title')) return new DOMRect(x + 12, y - 6, 80, 12)
      if (e.classList.contains('node-label-text')) return sel ? new DOMRect(x + 12, y - 10, 120, 20) : new DOMRect(x + 12, y - 6, 150, 12)
      return new DOMRect(0, 0, 0, 0)
    }
    const original = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function (this: Element) {
      return this.closest('.node-label') ? at(this) : original.call(this)
    }
    try {
      const deck: LabelNode = node('deck:g', { title: '19 steps', deck: { ids: ['m1', 'm2'], titles: ['One', 'Two'], more: 17, count: 19 } })
      for (const other of [node('s', { selected: true }), node('c', { chain: 'down' })])
        for (const held of ['none', 'hovered', 'focused'] as const) {
          const o = createLabelElement(other.id, () => {})
          const d = createLabelElement(deck.id, () => {})
          document.body.append(o, d)
          const labels = new Map([
            [other.id, o],
            [deck.id, d],
          ])
          const nodes = [other, deck]
          nodes.forEach(n => renderLabel(labels.get(n.id)!, n))
          expect(d.dataset.deck).toBe('true')
          // still, far apart: the deck is shown in full
          o.dataset.x = '300'
          o.dataset.y = '200'
          d.dataset.x = '40'
          d.dataset.y = '100'
          runTitleFit(labels, labelRanks(nodes, null), 1, true)
          expect(d.dataset.titleFit).toBe('full')
          // under the pointer or the keyboard focus, a deck shown in full keeps it while the view moves: cut, it would
          // flip to the raised hover style mid-gesture (viewer.css); the next still run decides it
          if (held === 'hovered') d.dataset.hovered = 'true'
          if (held === 'focused') d.focus()
          // the view moves (a zoom still easing out): the deck's list now runs over the other step's words
          o.dataset.x = '20'
          o.dataset.y = '140'
          runTitleFit(labels, labelRanks(nodes, null), 1, false)
          if (held === 'none') {
            expect(o.dataset.titleFit, other.id).toBe('full')
            expect(d.dataset.titleFit, `deck beside ${other.id}`).not.toBe('full')
          } else expect(d.dataset.titleFit, `${held} deck beside ${other.id}`).toBe('full')
          d.blur()
          o.remove()
          d.remove()
        }
    } finally {
      Element.prototype.getBoundingClientRect = original
    }
  })
})

describe('runTitleFit and a deck shown in full while the view moves, with room', () => {
  it('leaves its data-title-fit untouched: nothing is taken off and written back', () => {
    const original = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (!this.closest('.node-label')) return original.call(this)
      if (this.classList.contains('node-dot')) return new DOMRect(29, 89, 22, 22)
      if (this.classList.contains('node-label-title')) return new DOMRect(52, 60, 80, 12)
      if (this.classList.contains('node-deck-list')) return new DOMRect(52, 82, 90, 60)
      if (this.classList.contains('node-label-text')) return new DOMRect(52, 60, 150, 82)
      return new DOMRect(0, 0, 0, 0)
    }
    try {
      const deck: LabelNode = node('deck:g', { title: '19 steps', deck: { ids: ['m1', 'm2'], titles: ['One', 'Two'], more: 17, count: 19 } })
      const d = createLabelElement(deck.id, () => {})
      document.body.append(d)
      const labels = new Map([[deck.id, d]])
      renderLabel(d, deck)
      runTitleFit(labels, labelRanks([deck], null), 1, true)
      expect(d.dataset.titleFit).toBe('full')
      const seen = new MutationObserver(() => {})
      seen.observe(d, { attributes: true, attributeFilter: ['data-title-fit'] })
      runTitleFit(labels, labelRanks([deck], null), 1, false)
      expect(seen.takeRecords()).toEqual([])
      expect(d.dataset.titleFit).toBe('full')
      // a still run measures it afresh, so it is drawn in full for that moment
      runTitleFit(labels, labelRanks([deck], null), 1, true)
      expect(seen.takeRecords().length).toBeGreaterThan(0)
      seen.disconnect()
      d.remove()
    } finally {
      Element.prototype.getBoundingClientRect = original
    }
  })
})

/**
 * The Group overview of a goal over four areas, one deck under each (fixtures/crossLinked.ts), as the browser draws it:
 * the zoom (screen px per layout unit, which is the cards' scale above the card floor) at the 1280x720 fit (252 px
 * between the area columns), one wheel notch out (231 px), two (211 px), and the fit at 1100x740 (207 px).
 */
const OVERVIEW = { fit1280: 0.7641, out1: 0.6991, out2: 0.6397, fit1100: 0.6276 } as const

describe('runTitleFit and a deck zoomed out, with room around it', () => {
  it('draws its words at the boost every title takes, so it is not hidden under the floor at an overview zoom', () => {
    // One deck alone: its circle (--dot-r 11) drawn at the zoom k, its title, state line and list at k times their card
    // size and the boost (what viewer.css draws), nothing near it.
    for (const [name, k] of Object.entries(OVERVIEW)) {
      const b = titleBoost(labelScale(k))
      const s = k * b
      const original = Element.prototype.getBoundingClientRect
      Element.prototype.getBoundingClientRect = function (this: Element) {
        if (!this.closest('.node-label')) return original.call(this)
        if (this.classList.contains('node-dot')) return new DOMRect(400 - 11 * k, 300 - 11 * k, 22 * k, 22 * k)
        if (this.classList.contains('node-label-title')) return new DOMRect(400 + 40 * k, 300 - 40 * s, 50 * s, 15.6 * s)
        if (this.classList.contains('node-deck-mix')) return new DOMRect(400 + 40 * k, 300 - 24 * s, 100 * k, 12.5 * s)
        if (this.classList.contains('node-deck-list')) return new DOMRect(400 + 40 * k, 300 - 10 * s, 110 * k, 50 * s)
        if (this.classList.contains('node-label-text')) return new DOMRect(400 + 40 * k, 300 - 40 * s, 126 * k, 80 * s)
        return new DOMRect(0, 0, 0, 0)
      }
      try {
        const deck: LabelNode = node('deck:g', { title: '12 steps', deck: { ids: ['m1', 'm2'], titles: ['One', 'Two'], more: 10, count: 12 } })
        const d = createLabelElement(deck.id, () => {})
        document.body.append(d)
        renderLabel(d, deck)
        runTitleFit(new Map([[deck.id, d]]), labelRanks([deck], null), b, true)
        expect(d.dataset.titleFit, `${name} (zoom ${k}, boost ${b.toFixed(3)})`).toBe('full')
        d.remove()
      } finally {
        Element.prototype.getBoundingClientRect = original
      }
    }
  })
})

describe('deckScale', () => {
  it("is how many times its card's size a deck's words draw: the cards' scale over their slot, times the boost", () => {
    expect(deckScale(1)).toBe(1)
    expect(deckScale(OVERVIEW.fit1280)).toBe(1)
    expect(deckScale(OVERVIEW.out2)).toBeCloseTo(titleBoost(OVERVIEW.out2))
    // past the card floor, the cards draw larger than their slots as well
    expect(deckScale(0.2)).toBeCloseTo((LABEL_SCALE.min / 0.2) * titleBoost(LABEL_SCALE.min))
  })

  it('lists fewer names as the view zooms out, one level at a time, down to the count and "+N more"', () => {
    // a deck of twelve, six listed at most (DECK_LIST_MAX)
    const at = (ppu: number) => deckListed(12, 6, deckScale(ppu))
    expect(at(OVERVIEW.fit1280)).toBe(6)
    for (const k of [OVERVIEW.out2, OVERVIEW.fit1100]) {
      expect(at(k), `zoom ${k}`).toBeGreaterThan(0)
      expect(at(k), `zoom ${k}`).toBeLessThan(6)
    }
    const levels: number[] = []
    for (let ppu = 1; ppu >= 0.1; ppu -= 0.005) levels.push(at(ppu))
    for (let i = 1; i < levels.length; i++) expect(levels[i]).toBeLessThanOrEqual(levels[i - 1])
    expect(levels.at(-1)).toBe(0)
    expect(new Set(levels)).toEqual(new Set([6, 5, 4, 3, 2, 1, 0]))
  })
})

describe("runTitleFit and the selected step's brackets", () => {
  it('gives the selected step the room its brackets have before the nearest other circle (--mark-room, in card px) and takes it from a step let go', () => {
    // A stand-in layout: each label's 10px circle at its data-x (the card drawn 10/22 of its size: --dot-r is 11).
    const original = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const l = this.closest<HTMLElement>('.node-label')
      if (!l) return original.call(this)
      const x = Number(l.dataset.x)
      if (this.classList.contains('node-dot')) return new DOMRect(x - 5, -5, 10, 10)
      if (this.classList.contains('node-label-title') || this.classList.contains('node-label-text')) return new DOMRect(x + 12, -6, 40, 12)
      return new DOMRect(0, 0, 0, 0)
    }
    try {
      const els = ['a', 'b', 'c'].map(id => createLabelElement(id, () => {}))
      els.forEach((e, i) => {
        e.dataset.x = String([100, 130, 300][i])
        document.body.append(e)
      })
      const labels = new Map(els.map(e => [e.dataset.nodeId!, e]))
      const fit = (nodes: LabelNode[]) => {
        nodes.forEach(n => renderLabel(labels.get(n.id)!, n))
        runTitleFit(labels, labelRanks(nodes, null), 1)
      }
      const room = (id: string) => labels.get(id)!.style.getPropertyValue('--mark-room')
      fit([node('a', { selected: true }), node('b'), node('c')])
      // b's circle starts 25px right of a's centre: a square up to 2 x (25 - 2) = 46px on screen, 46 x 22/10 card px
      expect(room('a')).toBe(`${((2 * (25 - BRACKET_CLEAR) * 22) / 10).toFixed(1)}px`)
      expect(room('b')).toBe('')
      fit([node('a'), node('b'), node('c', { selected: true })])
      expect(room('a'), 'let go: the usual brackets again next time').toBe('')
      // c's nearest circle is b, 170px off: far more than the usual brackets need, still given
      expect(parseFloat(room('c'))).toBeGreaterThan(500)
    } finally {
      Element.prototype.getBoundingClientRect = original
      document.body.replaceChildren()
    }
  })

  it('counts a neighbour\'s "+N" tag (needs drawn elsewhere) like its circle, so the brackets stop short of the tag too', () => {
    const original = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const l = this.closest<HTMLElement>('.node-label')
      if (!l) return original.call(this)
      const x = Number(l.dataset.x)
      if (this.classList.contains('node-dot')) return new DOMRect(x - 5, -5, 10, 10)
      // b's tag reaches left under its circle to 20px right of a's centre
      if (this.classList.contains('node-label-elsewhere') && l.dataset.elsewhere) return new DOMRect(120, 8, 70, 8)
      if (this.classList.contains('node-label-title') || this.classList.contains('node-label-text')) return new DOMRect(x + 12, -6, 40, 12)
      return new DOMRect(0, 0, 0, 0)
    }
    try {
      const els = ['a', 'b'].map(id => createLabelElement(id, () => {}))
      els.forEach((e, i) => {
        e.dataset.x = String([100, 180][i])
        document.body.append(e)
      })
      const labels = new Map(els.map(e => [e.dataset.nodeId!, e]))
      ;[node('a', { selected: true }), node('b')].forEach(n => renderLabel(labels.get(n.id)!, n))
      const room = () => labels.get('a')!.style.getPropertyValue('--mark-room')
      fitBrackets(labels)
      // b's circle alone: 75px off
      expect(room()).toBe(`${((2 * (75 - BRACKET_CLEAR) * 22) / 10).toFixed(1)}px`)
      els[1].dataset.elsewhere = '2'
      fitBrackets(labels)
      // its tag, 20px off
      expect(room()).toBe(`${((2 * (20 - BRACKET_CLEAR) * 22) / 10).toFixed(1)}px`)
    } finally {
      Element.prototype.getBoundingClientRect = original
      document.body.replaceChildren()
    }
  })

  it('fitBrackets works the room out again on its own, as circles move in a glide, without fitting any title', () => {
    const original = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const l = this.closest<HTMLElement>('.node-label')
      if (!l) return original.call(this)
      const x = Number(l.dataset.x)
      if (this.classList.contains('node-dot')) return new DOMRect(x - 5, -5, 10, 10)
      if (this.classList.contains('node-label-title') || this.classList.contains('node-label-text')) return new DOMRect(x + 12, -6, 40, 12)
      return new DOMRect(0, 0, 0, 0)
    }
    try {
      const els = ['a', 'b'].map(id => createLabelElement(id, () => {}))
      els.forEach((e, i) => {
        e.dataset.x = String([100, 300][i])
        document.body.append(e)
      })
      const labels = new Map(els.map(e => [e.dataset.nodeId!, e]))
      const nodes = [node('a', { selected: true }), node('b')]
      nodes.forEach(n => renderLabel(labels.get(n.id)!, n))
      runTitleFit(labels, labelRanks(nodes, null), 1)
      const fits = els.map(e => e.dataset.titleFit)
      expect(parseFloat(labels.get('a')!.style.getPropertyValue('--mark-room'))).toBeGreaterThan(500)
      // b glides in to 30px off a's centre
      els[1].dataset.x = '130'
      fitBrackets(labels)
      expect(labels.get('a')!.style.getPropertyValue('--mark-room')).toBe(`${((2 * (25 - BRACKET_CLEAR) * 22) / 10).toFixed(1)}px`)
      expect(els.map(e => e.dataset.titleFit), 'no title is fitted').toEqual(fits)
    } finally {
      Element.prototype.getBoundingClientRect = original
      document.body.replaceChildren()
    }
  })

  it('fitBrackets reads every box before it writes anything while the plate keeps its place, so a glide frame forces no layout', () => {
    const original = Element.prototype.getBoundingClientRect
    const computed = window.getComputedStyle
    const set = CSSStyleDeclaration.prototype.setProperty
    const remove = CSSStyleDeclaration.prototype.removeProperty
    const log: string[] = []
    Element.prototype.getBoundingClientRect = function (this: Element) {
      log.push('read')
      const l = this.closest<HTMLElement>('.node-label')
      if (!l) return original.call(this)
      const x = Number(l.dataset.x)
      if (this.classList.contains('node-dot')) return new DOMRect(x - 5, -5, 10, 10)
      if (this.classList.contains('node-label-title') || this.classList.contains('node-label-text')) return new DOMRect(x + 25, -6, 40, 12)
      return new DOMRect(0, 0, 0, 0)
    }
    window.getComputedStyle = (...args: Parameters<typeof computed>) => {
      log.push('read')
      return computed(...args)
    }
    try {
      const els = ['a', 'b'].map(id => createLabelElement(id, () => {}))
      els.forEach((e, i) => {
        e.dataset.x = String([100, 300][i])
        document.body.append(e)
      })
      const labels = new Map(els.map(e => [e.dataset.nodeId!, e]))
      const nodes = [node('a', { selected: true }), node('b')]
      nodes.forEach(n => renderLabel(labels.get(n.id)!, n))
      fitBrackets(labels)
      const room = () => labels.get('a')!.style.getPropertyValue('--mark-room')
      for (const x of [240, 200, 180]) {
        // b glides in, but stays clear of a's plate (125 to 165): the room changes, the plate keeps its place
        els[1].dataset.x = String(x)
        const before = room()
        log.length = 0
        CSSStyleDeclaration.prototype.setProperty = function (this: CSSStyleDeclaration, ...args: Parameters<typeof set>) {
          log.push('write')
          return set.apply(this, args)
        }
        CSSStyleDeclaration.prototype.removeProperty = function (this: CSSStyleDeclaration, p: string) {
          log.push('write')
          return remove.call(this, p)
        }
        fitBrackets(labels)
        CSSStyleDeclaration.prototype.setProperty = set
        CSSStyleDeclaration.prototype.removeProperty = remove
        expect(room(), 'the room changed').not.toBe(before)
        expect(log.includes('write')).toBe(true)
        expect(log.slice(log.indexOf('write')), `at ${x}: nothing read after the first write`).not.toContain('read')
        expect(labels.get('a')!.style.getPropertyValue('--plate-dy')).toBe('')
        expect(labels.get('a')!.style.getPropertyValue('--plate-w')).toBe('')
      }
    } finally {
      Element.prototype.getBoundingClientRect = original
      window.getComputedStyle = computed
      CSSStyleDeclaration.prototype.setProperty = set
      CSSStyleDeclaration.prototype.removeProperty = remove
      document.body.replaceChildren()
    }
  })
})

describe('TITLE_CSS', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/view/labels.css'), 'utf8')
  const rule = (selector: string) => {
    const at = css.indexOf(`\n${selector} {`)
    expect(at, selector).toBeGreaterThanOrEqual(0)
    return css.slice(at, css.indexOf('}', at))
  }

  it('holds the numbers the stylesheet draws titles and rings with', () => {
    expect(css).toContain(`.node-label-title { font-size: calc(${TITLE_CSS.px}px * var(--title-boost, 1)); }`)
    expect(rule('.node-card')).toContain(`line-height: ${TITLE_CSS.line};`)
    expect(rule('.node-card')).toContain(`font-size: ${TITLE_CSS.px}px;`)
    expect(rule('.node-label-text')).toContain(`width: ${TITLE_CSS.width}px;`)
    expect(css).toContain(`.node-label-text { width: calc(${TITLE_CSS.width}px * var(--title-boost, 1)); }`)
    // the shown words of a cut or hidden title too
    expect([...css.matchAll(/width: calc\((\d+)px \* var\(--title-boost, 1\)\)/g)].map(m => Number(m[1]))).toEqual([TITLE_CSS.width, TITLE_CSS.width])
    expect(rule(".node-label[data-overdue='true'] .node-dot::after")).toContain(`inset: -${TITLE_CSS.overdueRing}px;`)
    // the chain outline: 2px wide, 2px out; the open-deck ring: a 2px gap then 2px, so 4px out
    expect(rule(".node-label[data-chain='up'] .node-dot")).toContain('outline: 2px solid #ffb454; outline-offset: 2px;')
    expect(TITLE_CSS.ring).toBe(2 + 2)
    // the selected step's 2px gap sits inside its brackets, which are measured (a square --mark wide on the circle)
    expect(rule(".node-label[data-selected='true'] .node-dot")).toContain('0 0 0 2px #05060a')
    expect(rule(".node-label[data-selected='true'] .node-mark")).toMatch(/left: calc\(18px - var\(--mark\) \/ 2\);\s+top: calc\(50% - var\(--mark\) \/ 2\);\s+width: var\(--mark\);\s+height: var\(--mark\);/)
    expect(rule(".node-label[aria-expanded='true'] .node-dot")).toMatch(new RegExp(`0 0 0 ${TITLE_CSS.ring}px`))
  })

  it("holds the numbers MARK_CSS works the selected step's brackets and plate out with (plateLeft, on a glide)", () => {
    const c = MARK_CSS
    // whitespace as one space, none just inside brackets: a rule wrapped onto other lines reads the same
    const flat = (t: string) => t.replace(/\s+/g, ' ').replace(/([({]) /g, '$1').replace(/ ([)}])/g, '$1')
    const all = flat(css)
    const sel = flat(rule(".node-label[data-selected='true']"))
    expect(sel).toContain('--z: calc(var(--label-scale, 1) * var(--near-scale, 1));')
    expect(sel).toContain(`--mark-ring: ${c.ring}px;`)
    expect(all).toContain(`.node-label[data-selected='true'][data-overdue='true'] {--mark-ring: ${c.overdueRing}px;}`)
    expect(sel).toContain(
      `--mark: max(min(max(calc(${c.usual}px / var(--z)), calc(var(--dot-r) * 2 + ${2 * c.pad}px)), var(--mark-room, 100000px)), calc((var(--dot-r) + var(--mark-ring)) * 2 + ${2 * c.least}px / var(--z)));`,
    )
    expect(sel).toContain(`--boost: max(1, calc(${c.minTitle} / (${c.title} * var(--z))));`)
    expect(c.title).toBe(TITLE_CSS.px)
    expect(c.centre).toBe(DOT.cx)
    expect(flat(rule(".node-label[data-selected='true'] .node-label-text"))).toContain(
      `left: max(${c.start}px, calc(${c.centre}px + var(--mark) / 2 + ${c.gap}px / var(--z) + ${c.padding}px));`,
    )
    // where zoom works: the same place, divided back by the boost it zooms the words by
    expect(all).toContain(
      `left: max(calc(${c.start}px / var(--boost)), calc((${c.centre}px + var(--mark) / 2 + ${c.gap}px / var(--z)) / var(--boost) + ${c.padding}px));`,
    )
  })
})

describe('the stylesheet and the plate\'s line breaks', () => {
  it('sets no text-wrap on a label, its card or its words: the plate knows widths from its lines as a page breaks them, each word on the line while it fits', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/view/labels.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ selector: m[1].trim(), body: m[2] }))
    const reach = rules.filter(r => /node-label|node-card|node-prio|(^|,)\s*(\*|html|body|:root|span|div)\b/.test(r.selector))
    expect(reach.length).toBeGreaterThan(10)
    for (const r of reach) expect(r.body, r.selector).not.toMatch(/text-wrap/)
  })
})

describe('laneWall', () => {
  // the circle sits this many card px left of its card's centre, drawn labelScale(ppu) screen px each
  const centre = LAYOUT.cardW / 2 - DOT.cx
  /** Where a lane `w` layout units right of a card's centre is drawn, px right of its circle as drawn at `ppu`. */
  const drawn = (w: number, ppu: number) => centre * labelScale(ppu) + w * ppu

  it('is the nearest lane drawn right of the circle as the card is drawn at the zoom, in px right of its centre', () => {
    const walls = [-200, -100, -40, 30, 90]
    // cards drawn as large as their slots (ppu 1): the lane 40 units left of the centre is 27 card px right of the circle
    expect(laneWall(walls, 1)).toBeCloseTo(centre - 40, 9)
    // past the card floor (ppu 0.2, cards held at 0.45) the circle moves left of where the layout puts it: the lane
    // 100 units left of the centre, left of the circle in the layout, is drawn right of it, and is the wall
    expect(-100).toBeLessThan(-centre)
    expect(laneWall(walls, 0.2)).toBeCloseTo(centre * 0.45 - 100 * 0.2, 9)
    // past the card ceiling (ppu 3, cards held at 1.6) the circle moves right: the lane 40 units left of the centre is
    // drawn left of it now, and the next lane right is the wall
    expect(drawn(-40, 3)).toBeLessThan(0)
    expect(laneWall(walls, 3)).toBeCloseTo(drawn(30, 3), 9)
    // a lane drawn through the circle (here 4 px right of its centre, the circle 5 px round and the lane 2 px either
    // side) is left of the words: no wall, the next lane right is
    const through = (4 - centre) / 1
    expect(laneWall([through, 30], 1, 5 + FIT.lane)).toBeCloseTo(drawn(30, 1), 9)
    expect(laneWall([through, 30], 1)).toBeCloseTo(4, 9)
    // no lane right of the circle: no wall
    expect(laneWall([-200, -100], 1)).toBeUndefined()
    expect(laneWall([], 0.2)).toBeUndefined()
  })

  it('makes each lane a wall to every label whose circle, as drawn at the zoom, sits left of it', () => {
    // a row's lanes, layout units right of a card's centre, at zooms from far out past the card floor to past the ceiling
    const walls = [-420, -260, -130, -90, -67.5, -40, -5, 30, 90, 260]
    for (const ppu of [0.05, 0.1, 0.2, 0.3, 0.45, 0.8, 1, 1.6, 2.5]) {
      const wall = laneWall(walls, ppu)
      const right = walls.map(w => drawn(w, ppu)).filter(x => x > 0)
      if (!right.length) {
        expect(wall, `${ppu}`).toBeUndefined()
        continue
      }
      // the words end before the nearest, so before every lane right of the circle; and never before the circle itself
      expect(wall, `${ppu}`).toBeGreaterThan(0)
      for (const x of right) expect(wall!, `${ppu}: a lane drawn ${x.toFixed(1)} px right of the circle`).toBeLessThanOrEqual(x + 1e-9)
    }
  })
})

describe('runWalls', () => {
  it("is the lanes whose run, drawn half a card larger past its ends at the zoom, meets the words' height", () => {
    // a run 60 to 300 layout units above the card's centre: half a drawn card (cardH/2 card px, labelScale(ppu) px each)
    // past its lower end it reaches down to bottom*ppu + cardH/2*labelScale(ppu) px from the circle's centre
    const runs = [{ dx: 40, top: -300, bottom: -60 }]
    const end = (ppu: number) => -60 * ppu + (LAYOUT.cardH / 2) * labelScale(ppu)
    // far past the card floor (ppu 0.2, cards held at 0.45) it reaches to 2.1px above the centre: into words from -6 to 6
    expect(end(0.2)).toBeGreaterThan(-6)
    expect(runWalls(runs, 0.2, -6, 6)).toEqual([40])
    // at the card floor (0.45) and above it ends well above them
    expect(end(0.45)).toBeLessThan(-6 - FIT.gap)
    expect(runWalls(runs, 0.45, -6, 6)).toEqual([])
    // words lower down, or a run under them reaching up, the same way
    expect(runWalls(runs, 0.2, 10, 20)).toEqual([])
    expect(runWalls([{ dx: 40, top: 60, bottom: 300 }], 0.2, -6, 6)).toEqual([40])
    expect(runWalls([], 0.2, -6, 6)).toEqual([])
  })
})

describe('runTitleFit and a lane in a block', () => {
  it("keeps a lane close past a due-soon step's large circle as its wall: one ending a gap short of the words is not", () => {
    // a 16px circle at x 0, its words 3.5px past its edge (from x 11.5); cards at ppu 0.3 held at 0.45
    const original = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this.classList.contains('node-dot')) return new DOMRect(-8, -8, 16, 16)
      if (this.classList.contains('node-label-title')) return new DOMRect(11.5, -6, 80, 12)
      if (this.classList.contains('node-label-text')) return new DOMRect(11.5, -6, 150, 12)
      return original.call(this)
    }
    try {
      const a = createLabelElement('a', () => {})
      renderLabel(a, node('a'))
      document.body.append(a)
      const labels = new Map([['a', a]])
      const centre = (LAYOUT.cardW / 2 - DOT.cx) * 0.45
      const at = (x: number) => String((x - centre) / 0.3)
      // a lane 8.5px right of the circle's centre (its box ends 1px before the words): the words do not draw whole
      a.dataset.walls = at(8.5)
      runTitleFit(labels, labelRanks([node('a')], null), 2, true, 0.3)
      expect(a.dataset.titleFit).not.toBe('full')
      // a lane whose box ends the gap before the words (and one through the circle) leaves them whole
      a.dataset.walls = [at(2), at(11.5 - FIT.gap - FIT.lane)].join(',')
      runTitleFit(labels, labelRanks([node('a')], null), 2, true, 0.3)
      expect(a.dataset.titleFit).toBe('full')
      a.remove()
    } finally {
      Element.prototype.getBoundingClientRect = original
    }
  })

  it("cuts a label's words before a lane drawn right of its circle (data-walls, layout units right of its card's centre), at any zoom", () => {
    // a 10px circle at x 0, its 80px title 12px right of it, boosted over the floor
    const original = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this.classList.contains('node-dot')) return new DOMRect(-5, -5, 10, 10)
      if (this.classList.contains('node-label-title')) return new DOMRect(12, -6, 80, 12)
      if (this.classList.contains('node-label-text')) return new DOMRect(12, -6, 150, 12)
      return original.call(this)
    }
    try {
      const a = createLabelElement('a', () => {})
      renderLabel(a, node('a'))
      document.body.append(a)
      const labels = new Map([['a', a]])
      runTitleFit(labels, labelRanks([node('a')], null), 2, true, 0.4)
      expect(a.dataset.titleFit).toBe('full')
      // The card's centre sits (cardW/2 - DOT.cx) card px right of the circle, drawn labelScale(ppu) px each: while
      // cards shrink with the view (0.6 px per unit) and once they stop (0.3, cards held at 0.45), a lane 60px right
      // of the circle cuts the words clear of its line.
      const centre = LAYOUT.cardW / 2 - DOT.cx
      for (const [ppu, scale] of [[0.6, 0.6], [0.3, 0.45], [0.1, 0.45]]) {
        // a lane left of the circle as drawn comes first, and one through the circle (3px right of its centre): neither
        // is a wall, the words end before the next
        a.dataset.walls = [(-20 - centre * scale) / ppu, (3 - centre * scale) / ppu, (60 - centre * scale) / ppu].join(',')
        runTitleFit(labels, labelRanks([node('a')], null), 2, true, ppu)
        expect(a.dataset.titleFit, `at ${ppu}`).toBe('short')
        expect(parseFloat(a.style.getPropertyValue('--fit-w')) * (10 / 22), `at ${ppu}`).toBeCloseTo(60 - FIT.lane - 12 - FIT.gap, 1)
      }
      // far past the card floor (0.05 px per unit) a lane left of the circle in the layout (103 units left of the card's
      // centre, the circle 67) is drawn 25px right of the circle as drawn, through the words: they do not draw whole
      const past = (25 - centre * 0.45) / 0.05
      expect(past).toBeLessThan(-centre)
      a.dataset.walls = String(past)
      runTitleFit(labels, labelRanks([node('a')], null), 2, true, 0.05)
      expect(a.dataset.titleFit).not.toBe('full')
      // an arrow climbing into the circle of a step beside a block bends to that circle as drawn: its card centre
      // (data-wall-dot) 60 / ppu units right of this card's centre puts its circle 60px right of this one's, at any zoom,
      // and the words end before it there, though the climb itself (data-walls) is further right
      for (const ppu of [0.6, 0.3]) {
        a.dataset.walls = String(200 / ppu)
        a.dataset.wallDot = String(60 / ppu)
        runTitleFit(labels, labelRanks([node('a')], null), 2, true, ppu)
        expect(a.dataset.titleFit, `dot at ${ppu}`).toBe('short')
        expect(parseFloat(a.style.getPropertyValue('--fit-w')) * (10 / 22), `dot at ${ppu}`).toBeCloseTo(60 - FIT.lane - 12 - FIT.gap, 1)
      }
      delete a.dataset.wallDot
      // a lane whose run ends above this row (data-wall-runs: its x, then its span, layout units from the card's
      // centre) is no wall while its drawn end stays above the words, and is one once zooming out draws it down onto
      // them: 60 units above the centre, ending 12px above the circle at ppu 0.2, it reaches 9.9px further down
      delete a.dataset.walls
      for (const [ppu, scale, fit] of [[0.6, 0.6, 'full'], [0.2, 0.45, 'short']] as const) {
        a.dataset.wallRuns = `${(60 - centre * scale) / ppu}:${-300}:${-12 / 0.2}`
        runTitleFit(labels, labelRanks([node('a')], null), 2, true, ppu)
        expect(a.dataset.titleFit, `run at ${ppu}`).toBe(fit)
        if (fit === 'short') expect(parseFloat(a.style.getPropertyValue('--fit-w')) * (10 / 22), `run at ${ppu}`).toBeCloseTo(60 - FIT.lane - 12 - FIT.gap, 1)
      }
      delete a.dataset.wallRuns
      a.remove()
    } finally {
      Element.prototype.getBoundingClientRect = original
    }
  })
})

describe('runTitleFit and how far a lane is drawn', () => {
  it("keeps the words of a step in the row above clear of a lane only where its run is drawn (data-wall-runs, data-wall-dot's span)", () => {
    // a over b, a row 14px apart: each a 10px circle, its 80px title 12px right of it
    const original = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const y = this.closest<HTMLElement>('.node-label')?.dataset.nodeId === 'b' ? 14 : 0
      if (this.classList.contains('node-dot')) return new DOMRect(-5, y - 5, 10, 10)
      if (this.classList.contains('node-label-title')) return new DOMRect(12, y - 6, 80, 12)
      if (this.classList.contains('node-label-text')) return new DOMRect(12, y - 6, 150, 12)
      return original.call(this)
    }
    try {
      const a = createLabelElement('a', () => {})
      const b = createLabelElement('b', () => {})
      renderLabel(a, node('a'))
      renderLabel(b, node('b', { title: 'b' }))
      document.body.append(a, b)
      const labels = new Map([
        ['a', a],
        ['b', b],
      ])
      const ranks = labelRanks([node('a'), node('b')], null)
      // at ppu 0.6 cards draw at 0.6: a lane 60px right of b's circle, drawn half a card (13.2px) past its run's ends
      const ppu = 0.6
      const dx = (60 - (LAYOUT.cardW / 2 - DOT.cx) * 0.6) / ppu
      b.dataset.walls = String(dx)
      // its run from 17 units under b's centre: drawn from 3px above b's circle's centre down, 5px under a's words
      b.dataset.wallRuns = `${dx}:17:200`
      runTitleFit(labels, ranks, 2, true, ppu)
      expect(a.dataset.titleFit).toBe('full')
      // drawn from higher up, across a's words: they end before it
      b.dataset.wallRuns = `${dx}:-40:200`
      runTitleFit(labels, ranks, 2, true, ppu)
      expect(a.dataset.titleFit).toBe('short')
      // no run given: taken as b's row and a line past either side, which reaches a's words
      delete b.dataset.wallRuns
      runTitleFit(labels, ranks, 2, true, ppu)
      expect(a.dataset.titleFit).toBe('short')
      // an arrow climbing into a circle beside (data-wall-dot, with its climb's span after it) is drawn as far as its climb
      b.dataset.walls = String(200 / ppu)
      b.dataset.wallDot = `${60 / ppu}:17:200`
      runTitleFit(labels, ranks, 2, true, ppu)
      expect(a.dataset.titleFit).toBe('full')
      b.dataset.wallDot = String(60 / ppu)
      runTitleFit(labels, ranks, 2, true, ppu)
      expect(a.dataset.titleFit).toBe('short')
      a.remove()
      b.remove()
    } finally {
      Element.prototype.getBoundingClientRect = original
    }
  })
})

describe("goalArrowBoxes: where an arrow from a goal's own need into the goal is drawn, on screen", () => {
  // the need's slot at (100, 0), the goal's a row up at (500, -122): the arrow from the top of the need's card to the
  // bottom of the goal's, as the layout gives it
  const arrow = { from: 'n', points: [{ x: 100, y: -22 }, { x: 500, y: -100 }], arrow: 9, width: 2, scales: { start: 1, end: 1 } }
  const dots = new Map([['n', { left: -5, top: -5, right: 5, bottom: 5 }]])
  const at = <B extends { left: number; right: number }>(boxes: B[], x: number) => boxes.filter(b => b.left <= x && x <= b.right)

  it('follows the line as drawn at the zoom, from over the need\'s drawn circle', () => {
    // at ppu 1 cards draw at their slot's size: the line leaves 18px over the circle's centre and ends at its head, the
    // tip 18px under the goal's circle, 400px across and 104px up; flat across half way between its start and its head's base
    const boxes = goalArrowBoxes([arrow], dots, 1)
    expect(Math.min(...boxes.map(b => b.left))).toBeCloseTo(-1)
    expect(Math.max(...boxes.map(b => b.right))).toBeCloseTo(401)
    expect(Math.max(...boxes.map(b => b.bottom))).toBeCloseTo(-17)
    expect(Math.min(...boxes.map(b => b.top))).toBeCloseTo(-105)
    for (const b of at(boxes, 200)) expect(b.top < (-18 - 95) / 2 && (-18 - 95) / 2 < b.bottom).toBe(true)
  })

  it('runs flat across over the need\'s circle at a whole-plan zoom, where the rows are closer than the line\'s ends', () => {
    // at ppu 0.1 cards draw 4.5 times their slot: the line leaves 8.1px over the circle's centre, already over the head's
    // base, so it runs flat at that height to the goal's column (40px across) and the head drops to its tip 4px lower
    const boxes = goalArrowBoxes([arrow], dots, 0.1)
    for (const b of at(boxes, 20)) {
      expect(b.top).toBeCloseTo(-8.1 - 1)
      expect(b.bottom).toBeCloseTo(-8.1 + 1)
    }
    expect(Math.max(...boxes.map(b => b.right))).toBeCloseTo(41)
    expect(Math.max(...boxes.map(b => b.bottom))).toBeCloseTo(-4.1 + 1)
  })

  it('gives nothing for a need not drawn', () => {
    expect(goalArrowBoxes([{ ...arrow, from: 'x' }], dots, 1)).toEqual([])
  })
})

describe("runTitleFit and the goal's arrows to its needs", () => {
  it("keeps a goal's need's words clear of the arrow drawn from it into the goal", () => {
    // need a at (0, 0) and the goal g at (40, -14) on screen, each a 10px circle, its 80px title 12px right of it; at a
    // whole-plan zoom (ppu 0.1) the arrow from a into g runs flat across 8.1px over a's centre, through a's words
    // (y -6 to 6) as drawn in full: given the arrow, a's words move down clear of it
    const original = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const [x, y] = this.closest<HTMLElement>('.node-label')?.dataset.nodeId === 'g' ? [40, -14] : [0, 0]
      if (this.classList.contains('node-dot')) return new DOMRect(x - 5, y - 5, 10, 10)
      if (this.classList.contains('node-label-title')) return new DOMRect(x + 12, y - 6, 80, 12)
      if (this.classList.contains('node-label-text')) return new DOMRect(x + 12, y - 6, 150, 12)
      return original.call(this)
    }
    try {
      const a = createLabelElement('a', () => {})
      const g = createLabelElement('g', () => {})
      renderLabel(a, node('a'))
      renderLabel(g, node('g'))
      document.body.append(a, g)
      const labels = new Map([
        ['a', a],
        ['g', g],
      ])
      const ranks = labelRanks([node('g'), node('a')], null, topOf([{ id: 'g', depends_on: ['a'] }, { id: 'a', depends_on: [] }]))
      const arrows = [{ from: 'a', points: [{ x: 0, y: -22 }, { x: 400, y: -100 }], arrow: 9, width: 1.8, scales: { start: 1, end: 1 } }]
      runTitleFit(labels, ranks, 2, true, 0.1, undefined, true)
      expect(a.dataset.titleFit).toBe('full')
      runTitleFit(labels, ranks, 2, true, 0.1, undefined, true, arrows)
      expect(a.dataset.titleFit).toBe('short')
      expect(parseFloat(a.style.getPropertyValue('--fit-dy'))).toBeGreaterThan(0)
      expect(g.dataset.titleFit).toBe('full')
      a.remove()
      g.remove()
    } finally {
      Element.prototype.getBoundingClientRect = original
    }
  })
})

/**
 * A stand-in page for the selected step's plate: each label's 10px circle at (data-x, data-y); the plate 20px right of
 * the circle, 138px wide (or --plate-w, then on three lines, or two down to data-wraps-at), moved by --plate-dy. As on the page, the card is drawn at
 * the circle's size (a 22 card px circle 10px wide on screen: PLATE_PX screen px a card px, and so a plate px, the words
 * at card zoom 1 needing no boost), so --plate-w and --plate-dy are in plate px.
 */
const PLATE_PX = 10 / 22
/** A narrower width (plate px) as the plate is tried at: rounded down to its step. */
const stepped = (w: number) => Math.floor(w / PLATE.step) * PLATE.step
function standInPlate() {
  const rect = Element.prototype.getBoundingClientRect
  const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')!
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const l = this.closest<HTMLElement>('.node-label')
    if (!l) return rect.call(this)
    const x = Number(l.dataset.x)
    const y = Number(l.dataset.y ?? 0)
    if (this.classList.contains('node-dot')) return new DOMRect(x - 5, y - 5, 10, 10)
    if (this.classList.contains('node-label-held') && l.dataset.hold) return new DOMRect(x - 8, y - 16, 16, 8)
    if (this.classList.contains('node-label-text') || this.classList.contains('node-label-title')) {
      if (l.dataset.selected !== 'true') return new DOMRect(x + 12, y - 6, 40, 12)
      if (l.dataset.chars) {
        const { w, h } = laidOut(l)
        return new DOMRect(x + 20, y - h / 2, w, h)
      }
      const pw = parseFloat(l.style.getPropertyValue('--plate-w'))
      const w = Number.isFinite(pw) ? Math.min(138, pw * PLATE_PX) : 138
      // (with data-wraps-at, as many lines as in full down to that wide on screen)
      const h = w < 138 && !(w >= Number(l.dataset.wrapsAt)) ? 56 : 42
      const dy = (parseFloat(l.style.getPropertyValue('--plate-dy')) || 0) * PLATE_PX
      return new DOMRect(x + 20, y - h / 2 + dy, w, h)
    }
    return new DOMRect(0, 0, 0, 0)
  }
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('node-label-text') ? this.getBoundingClientRect().width / PLATE_PX : 0
    },
  })
  // the plate's words, where laid out (data-chars): each line's piece of a word or text, else none
  const proto = Range.prototype as unknown as { getClientRects?: () => DOMRect[] }
  proto.getClientRects = function (this: Range) {
    const n = this.startContainer
    // a piece of text, or an element whose contents are selected
    const of = n instanceof Element ? n : n.parentElement!
    const l = of.closest<HTMLElement>('.node-label')
    if (!l?.dataset.chars || l.dataset.selected !== 'true') return []
    const { h, lines, left } = laidOut(l)
    const top = Number(l.dataset.y ?? 0) - h / 2 + 2
    if (!of.classList.contains('node-label-words')) {
      if (!n.textContent) return []
      // a due line wrapped (data-due-lines 2): a piece on each of two lines
      if (of.classList.contains('node-label-due') && l.dataset.dueLines === '2')
        return [new DOMRect(left, top + lines.length * 12, 20, 12), new DOMRect(left, top + (lines.length + 1) * 12, 10, 12)]
      return [new DOMRect(left, top + lines.length * 12, 5, 12)]
    }
    const cw = Number(l.dataset.chars)
    const from = this.startOffset
    const to = this.endContainer === n ? this.endOffset : n.textContent!.length
    return lines.flatMap((line, i) => {
      const a = Math.max(from, line.start)
      const b = Math.min(to, line.end)
      return a < b ? [new DOMRect(left + (a - line.start) * cw, top + i * 12, (b - a) * cw, 12)] : []
    })
  }
  return () => {
    Element.prototype.getBoundingClientRect = rect
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', width)
    delete proto.getClientRects
    document.body.replaceChildren()
  }
}

/**
 * The selected plate's words laid out as a page does (data-chars screen px a letter, a space one letter, the plate
 * 6 plate px of padding each side, --plate-w wide at most, else 138 px): each word on the line it starts while it fits,
 * else on the next. Its lines (letters `start` to `end` of the words), where they start on screen, and the plate's
 * width and height (each line 12 px, the id line one more, 2 px above and below).
 */
function laidOut(l: HTMLElement) {
  const cw = Number(l.dataset.chars)
  const words = l.querySelector('.node-label-words')!.textContent!
  const pw = parseFloat(l.style.getPropertyValue('--plate-w'))
  const most = Number.isFinite(pw) ? pw * PLATE_PX : 138
  const pad = 6 * PLATE_PX
  const room = most - 2 * pad
  const lines: { start: number; end: number }[] = []
  let at = 0
  for (const word of words.split(' ')) {
    const last = lines[lines.length - 1]
    if (last && (last.end - last.start + 1 + word.length) * cw <= room) last.end += 1 + word.length
    else lines.push({ start: at, end: at + word.length })
    at += word.length + 1
  }
  return { lines, left: Number(l.dataset.x) + 20 + pad, w: Math.min(most, words.length * cw + 2 * pad), h: (lines.length + 1) * 12 + 4 }
}

describe("runTitleFit and the selected step's plate", () => {
  const setUp = (at: [number, number][]) => {
    const els = at.map((_, i) => createLabelElement('abcdef'[i], () => {}))
    els.forEach((e, i) => {
      e.dataset.x = String(at[i][0])
      e.dataset.y = String(at[i][1])
      document.body.append(e)
    })
    return { els, labels: new Map(els.map(e => [e.dataset.nodeId!, e])) }
  }
  const area = { left: 0, top: -400, right: 1280, bottom: 400 }

  it("leaves a neighbour's \"held\" tag out of the brackets' room (they hold circles alone), as before", () => {
    const restore = standInPlate()
    try {
      const { labels } = setUp([
        [100, 0],
        [140, 30],
      ])
      const nodes = [node('a', { selected: true }), node('b', { held: true })]
      nodes.forEach(n => renderLabel(labels.get(n.id)!, n))
      fitBrackets(labels)
      // b's circle is 35px off a's centre (its tag, above it, only 22px): the room is the circle's
      expect(labels.get('a')!.style.getPropertyValue('--mark-room')).toBe(`${((2 * (35 - BRACKET_CLEAR) * 22) / 10).toFixed(1)}px`)
    } finally {
      restore()
    }
  })

  it('places the plate on each frame of a glide too, with the brackets, and marks no circle it clears', () => {
    const restore = standInPlate()
    try {
      const { els, labels } = setUp([
        [100, 0],
        [400, 18],
      ])
      const nodes = [node('a', { selected: true }), node('b')]
      nodes.forEach(n => renderLabel(labels.get(n.id)!, n))
      runTitleFit(labels, labelRanks(nodes, null), 1, true, undefined, area)
      expect(labels.get('a')!.style.getPropertyValue('--plate-dy')).toBe('')
      // b glides in under the plate's bottom edge (its circle from 13 to 23; the plate reaches 21)
      els[1].dataset.x = '200'
      fitBrackets(labels, area)
      // moved up just off it: its bottom at 13 - gap
      expect(labels.get('a')!.style.getPropertyValue('--plate-dy')).toBe(`${((13 - PLATE.gap - 21) / PLATE_PX).toFixed(2)}px`)
      expect(els[1].dataset.underPlate).toBeUndefined()
    } finally {
      restore()
    }
  })

  it('places a narrowed plate afresh on a glide frame from where it is drawn, measuring only a narrower width', () => {
    const restore = standInPlate()
    const read = Element.prototype.getBoundingClientRect
    // the selected plate's reads, with the width written then (empty: drawn in full)
    const reads: string[] = []
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const l = this.closest<HTMLElement>('.node-label')
      if (l?.dataset.selected === 'true' && this.classList.contains('node-label-text')) reads.push(l.style.getPropertyValue('--plate-w'))
      return read.call(this)
    }
    try {
      const { els, labels } = setUp([
        [100, 0],
        [400, 0],
      ])
      const nodes = [node('a', { selected: true }), node('b')]
      nodes.forEach(n => renderLabel(labels.get(n.id)!, n))
      runTitleFit(labels, labelRanks(nodes, null), 1, true, undefined, area)
      // b glides under the plate's end: it wraps before b
      els[1].dataset.x = '240'
      fitBrackets(labels, area)
      expect(parseFloat(labels.get('a')!.style.getPropertyValue('--plate-w'))).toBe(stepped((235 - PLATE.gap - 120) / PLATE_PX))
      // and on: the narrowed plate crosses b again, so it is placed afresh, its full box known from before
      els[1].dataset.x = '200'
      reads.length = 0
      fitBrackets(labels, area)
      expect(parseFloat(labels.get('a')!.style.getPropertyValue('--plate-w'))).toBe(stepped((195 - PLATE.gap - 120) / PLATE_PX))
      expect(reads.slice(1), 'after the plate as drawn, only a narrower width is measured').not.toContain('')
    } finally {
      Element.prototype.getBoundingClientRect = read
      restore()
    }
  })

  it("knows a plate narrowed by a still run on a glide's frames too, though the page rounds the plate's width", () => {
    const restore = standInPlate()
    const read = Element.prototype.getBoundingClientRect
    const offset = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')!
    // as on the page, a whole number of px: the plate's own px measured so are a little off its zoom
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get(this: HTMLElement) { return Math.round(offset.get!.call(this)) } })
    const reads: string[] = []
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const l = this.closest<HTMLElement>('.node-label')
      if (l?.dataset.selected === 'true' && this.classList.contains('node-label-text')) reads.push(l.style.getPropertyValue('--plate-w'))
      return read.call(this)
    }
    try {
      const { els, labels } = setUp([
        [100, 0],
        [240, 0],
      ])
      const nodes = [node('a', { selected: true }), node('b')]
      nodes.forEach(n => renderLabel(labels.get(n.id)!, n))
      // a still run wraps the plate before b
      runTitleFit(labels, labelRanks(nodes, null), 1, true, undefined, area)
      expect(labels.get('a')!.style.getPropertyValue('--plate-w')).not.toBe('')
      // a glide brings b nearer: placed afresh from its size in full as the still run measured it
      els[1].dataset.x = '200'
      reads.length = 0
      fitBrackets(labels, area)
      expect(parseFloat(labels.get('a')!.style.getPropertyValue('--plate-w'))).toBe(stepped((195 - PLATE.gap - 120) / PLATE_PX))
      expect(reads.slice(1), 'after the plate as drawn, only a narrower width is measured').not.toContain('')
    } finally {
      Element.prototype.getBoundingClientRect = read
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offset)
      restore()
    }
  })

  /**
   * A glide wraps the plate before b with the cards drawn at half size (the words boosted 24/13), then a still run at
   * `zoom` times that tries the same width, with the page's plate width read `off` times too wide (whole px): the widths
   * written when the selected plate is read in the still run, and the width it is placed at.
   */
  const glideThenStill = (zoom: number, off: number) => {
    const restore = standInPlate()
    const read = Element.prototype.getBoundingClientRect
    const offset = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')!
    let wide = 1
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get(this: HTMLElement) { return offset.get!.call(this) * wide } })
    const reads: string[] = []
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const l = this.closest<HTMLElement>('.node-label')
      if (l?.dataset.selected === 'true' && this.classList.contains('node-label-text')) reads.push(l.style.getPropertyValue('--plate-w'))
      return read.call(this)
    }
    try {
      document.body.style.setProperty('--label-scale', '0.5')
      const { els, labels } = setUp([
        [100, 0],
        [400, 0],
      ])
      const sel = [node('a', { selected: true }), node('b')]
      const none = [node('a'), node('b')]
      const select = (nodes: typeof sel) => {
        nodes.forEach(n => renderLabel(labels.get(n.id)!, n))
        runTitleFit(labels, labelRanks(nodes, null), 1, true, undefined, area)
      }
      select(sel)
      // screen px a plate px: the circle's, times the words' boost
      const s = (z: number) => PLATE_PX * Math.max(1, 12 / (13 * z))
      els[1].dataset.x = '240'
      fitBrackets(labels, area)
      const at = stepped(112 / s(0.5)).toFixed(2)
      expect(labels.get('a')!.style.getPropertyValue('--plate-w')).toBe(`${at}px`)
      document.body.style.setProperty('--label-scale', String(0.5 * zoom))
      wide = off
      els[1].dataset.x = String(120 + PLATE.gap + Number(at) * s(0.5 * zoom) + 5)
      select(none)
      reads.length = 0
      select(sel)
      return { at: `${at}px`, placed: labels.get('a')!.style.getPropertyValue('--plate-w'), reads: reads.filter(Boolean) }
    } finally {
      Element.prototype.getBoundingClientRect = read
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offset)
      document.body.style.removeProperty('--label-scale')
      restore()
    }
  }

  it("takes in a still run at the glide's zoom the width the glide measured, though the page's whole px are off", () => {
    const { at, placed, reads } = glideThenStill(1, 1.007)
    expect(placed).toBe(at)
    // only read as placed
    expect(reads).toEqual([at])
  })

  it('measures again in a still run a width a glide measured at another zoom, so the settled plate wraps as drawn', () => {
    const { at, placed, reads } = glideThenStill(1 / 1.01, 1)
    expect(placed).toBe(at)
    // measured, then read as placed
    expect(reads).toEqual([at, at])
  })

  /**
   * A glide brings b's circle in under the plate's end, frame by frame (b's circle centred at each x in turn); `again`
   * lets the step go and selects it again first (a still run, b far off: drawn in full) before each frame from that one.
   * `line`, where given, is how wide (screen px) the plate's longest line is drawn once it wraps (else the page gives no
   * lines). Returns each frame's width and where the plate ends, and the widths written and measured on each frame.
   */
  const glideIn = (xs: number[], again = -1, line?: number, wrapsAt?: number, words?: { title: string; chars: number; dueLines?: number }) => {
    const restore = standInPlate()
    const read = Element.prototype.getBoundingClientRect
    const proto = Range.prototype as unknown as { getClientRects?: () => DOMRect[] }
    if (line !== undefined)
      proto.getClientRects = function (this: Range) {
        const n = this.startContainer
        const l = (n instanceof Element ? n : n.parentElement)?.closest<HTMLElement>('.node-label')
        if (l?.dataset.selected !== 'true') return []
        // from inside the plate's padding (6 plate px), at its left
        return [new DOMRect(Number(l.dataset.x) + 20 + 6 * PLATE_PX, -6, line, 10)]
      }
    let reads: string[] = []
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const l = this.closest<HTMLElement>('.node-label')
      if (l?.dataset.selected === 'true' && this.classList.contains('node-label-text')) reads.push(l.style.getPropertyValue('--plate-w'))
      return read.call(this)
    }
    try {
      const { els, labels } = setUp([
        [100, 0],
        [400, 0],
      ])
      const title = words?.title ?? 'Step a'
      const sel = [node('a', { selected: true, title }), node('b')]
      const none = [node('a', { title }), node('b')]
      const select = (nodes: typeof sel) => {
        nodes.forEach(n => renderLabel(labels.get(n.id)!, n))
        if (words?.dueLines) els[0].querySelector('.node-label-due')!.textContent = 'in 3 days'
        runTitleFit(labels, labelRanks(nodes, null), 1, true, undefined, area)
      }
      if (wrapsAt !== undefined) els[0].dataset.wrapsAt = String(wrapsAt)
      if (words) els[0].dataset.chars = String(words.chars)
      if (words?.dueLines) els[0].dataset.dueLines = String(words.dueLines)
      select(sel)
      const frames: { w: string; end: number; measured: string[] }[] = []
      for (const [i, x] of xs.entries()) {
        if (again >= 0 && i >= again) {
          els[1].dataset.x = '400'
          select(none)
          select(sel)
        }
        reads = []
        els[1].dataset.x = String(x)
        fitBrackets(labels, area)
        // after the plate read as drawn
        const measured = reads.slice(1).filter(Boolean)
        const a = labels.get('a')!
        frames.push({ w: a.style.getPropertyValue('--plate-w'), end: read.call(a.querySelector('.node-label-text')!).right, measured })
      }
      return frames
    } finally {
      Element.prototype.getBoundingClientRect = read
      delete proto.getClientRects
      restore()
    }
  }

  it('takes on a glide frame a width within one step of one measured before, measuring nothing more', () => {
    // b's circle at 235, then (the plate drawn in full again) at 234.5: the widths that end the plate before it are
    // 246.4 and 245.3 plate px, both in the step from 244
    const frames = glideIn([240, 239.5], 1)
    expect(frames.map(f => f.w)).toEqual(['244.00px', '244.00px'])
    expect(frames[0].measured).toEqual(['244.00px'])
    expect(frames[1].measured, 'the second width is taken from the first, not measured').toEqual([])
  })

  it('rounds each width tried down to its step, so the plate ends at least its gap before the circle it wraps before', () => {
    const xs = [240, 228, 215, 205]
    const frames = glideIn(xs)
    for (const [i, f] of frames.entries()) {
      expect(parseFloat(f.w) % PLATE.step, `frame ${i}`).toBe(0)
      const left = xs[i] - 5
      expect(f.end, `frame ${i}`).toBeLessThanOrEqual(left - PLATE.gap)
      expect(f.end, `frame ${i}`).toBeGreaterThan(left - PLATE.gap - PLATE.step * PLATE_PX)
    }
  })

  it('knows a narrower width without measuring it down to where the longest line of a width measured would no longer fit', () => {
    // wrapped at 244 plate px, its longest line is 40 px on screen (88 plate px): every width from there and its
    // padding (100 plate px) up to 244 wraps just so
    const frames = glideIn([240, 200, 160], -1, 40)
    expect(frames.map(f => f.w)).toEqual(['244.00px', '156.00px', '68.00px'])
    expect(frames[0].measured).toEqual(['244.00px'])
    expect(frames[1].measured, '156 wraps as 244 did: taken, not measured').toEqual([])
    expect(frames[2].measured, '68 is under the longest line: measured').toEqual(['68.00px'])
    expect(frames[1].end).toBeLessThanOrEqual(195 - PLATE.gap)
  })

  it('knows a narrower width without measuring it between one measured and the plate in full, all drawn as tall', () => {
    // two lines in full and down to 100 px on screen: wrapped at 244 plate px (112 px), then at 256 (117 px), wider
    // than any measured, but under the plate in full (303.6), as tall
    const frames = glideIn([240, 245], 1, undefined, 100)
    expect(frames.map(f => f.w)).toEqual(['244.00px', '256.00px'])
    expect(frames[0].measured).toEqual(['244.00px'])
    expect(frames[1].measured, '256 is between 244 and the plate in full, as tall: taken, not measured').toEqual([])
  })

  it('knows a wider width without measuring it while no line would take the first word of the next', () => {
    // 38 letters 3 px each, in full on one line (119.5 px wide); wrapped at 208 plate px (89.1 px for the words) it is
    // 'aaaa bbbb cccc dddd eeee ffff' (87 px) over 'gggggggg' (24 px): every width from 203.9 plate px (the longest
    // line) to 255.7 (the longest line and 'gggggggg', with no space) wraps just so, and 224 with it
    const words = { title: 'aaaa bbbb cccc dddd eeee ffff gggggggg', chars: 3 }
    const frames = glideIn([224, 230.5, 218], 1, undefined, undefined, words)
    expect(frames.map(f => f.w)).toEqual(['208.00px', '224.00px', '196.00px'])
    expect(frames[0].measured).toEqual(['208.00px'])
    expect(frames[1].measured, '224 wraps as 208 did: taken, not measured').toEqual([])
    expect(frames[2].measured, '196 is under the longest line: measured').toEqual(['196.00px'])
  })

  it("knows no wider width where the next line's first word could break after a hyphen, slash or dash", () => {
    // as above, but 'gggg-hhh' may break after its hyphen, so 'gggg-' alone could join the line above sooner
    for (const title of ['aaaa bbbb cccc dddd eeee ffff gggg-hhh', 'aaaa bbbb cccc dddd eeee ffff gggg/hhh', 'aaaa bbbb cccc dddd eeee ffff gggg\u2014hh']) {
      const frames = glideIn([224, 230.5], 1, undefined, undefined, { title, chars: 3 })
      expect(frames.map(f => f.w), title).toEqual(['208.00px', '224.00px'])
      expect(frames[1].measured, title).toEqual(['224.00px'])
    }
  })

  it('knows no wider width where the due line is wrapped, as it may unwrap sooner', () => {
    const frames = glideIn([224, 230.5], 1, undefined, undefined, { title: 'aaaa bbbb cccc dddd eeee ffff gggggggg', chars: 3, dueLines: 2 })
    expect(frames.map(f => f.w)).toEqual(['208.00px', '224.00px'])
    expect(frames[1].measured).toEqual(['224.00px'])
  })

  it('keeps a width exact where its step down would leave fewer letters a line than the least', () => {
    // b's circle at 151.5: the plate wraps 28.5 px wide, 62.70 plate px, and 60 would be under the least
    // (PLATE.minChars letters and its padding)
    const least = PLATE.minChars * PLATE.charEm * TITLE_CSS.px + 12
    expect(Math.floor(62.7 / PLATE.step) * PLATE.step).toBeLessThan(least)
    const [f] = glideIn([156.5])
    expect(f.w).toBe('62.70px')
  })

  it('keeps where the plate was while the view moves a little and that still crosses nothing', () => {
    const restore = standInPlate()
    try {
      const { els, labels } = setUp([
        [100, 0],
        [200, 18],
      ])
      const nodes = [node('a', { selected: true }), node('b')]
      nodes.forEach(n => renderLabel(labels.get(n.id)!, n))
      runTitleFit(labels, labelRanks(nodes, null), 1, true, undefined, area)
      const first = labels.get('a')!.style.getPropertyValue('--plate-dy')
      expect(first).toBe(`${((13 - PLATE.gap - 21) / PLATE_PX).toFixed(2)}px`)
      // b drifts down a few px, run by run: placed afresh the plate would move less, or not at all
      for (const y of [20, 23, 27, 30]) {
        els[1].dataset.y = String(y)
        runTitleFit(labels, labelRanks(nodes, null), 1, false, undefined, area)
        expect(labels.get('a')!.style.getPropertyValue('--plate-dy'), `b at ${y}`).toBe(first)
      }
    } finally {
      restore()
    }
  })

  it('drops the place from a step let go, so selected again it starts as usual', () => {
    const restore = standInPlate()
    try {
      const { labels } = setUp([
        [100, 0],
        [200, 18],
      ])
      const sel = [node('a', { selected: true }), node('b')]
      sel.forEach(n => renderLabel(labels.get(n.id)!, n))
      runTitleFit(labels, labelRanks(sel, null), 1, true, undefined, area)
      expect(labels.get('a')!.style.getPropertyValue('--plate-dy')).not.toBe('')
      const none = [node('a'), node('b')]
      none.forEach(n => renderLabel(labels.get(n.id)!, n))
      runTitleFit(labels, labelRanks(none, null), 1, true, undefined, area)
      expect(labels.get('a')!.style.getPropertyValue('--plate-dy')).toBe('')
      expect(labels.get('a')!.style.getPropertyValue('--plate-w')).toBe('')
    } finally {
      restore()
    }
  })

  it('marks a circle the plate cannot clear (with no room to move it) as drawn over it', () => {
    const restore = standInPlate()
    try {
      const { els, labels } = setUp([
        [100, 0],
        [140, 0],
      ])
      const nodes = [node('a', { selected: true }), node('b')]
      nodes.forEach(n => renderLabel(labels.get(n.id)!, n))
      // the free area is the plate's own height: no move fits
      runTitleFit(labels, labelRanks(nodes, null), 1, true, undefined, { left: 0, top: -21, right: 1280, bottom: 21 })
      expect(els[1].dataset.underPlate).toBe('true')
      expect(els[0].dataset.underPlate).toBeUndefined()
    } finally {
      restore()
    }
  })

  it("cuts the plate's backing round a circle it cannot clear, so that circle shows through under its words, and drops the cut once it is clear", () => {
    const restore = standInPlate()
    try {
      const { els, labels } = setUp([
        [100, 0],
        [140, 0],
      ])
      const nodes = [node('a', { selected: true }), node('b')]
      nodes.forEach(n => renderLabel(labels.get(n.id)!, n))
      runTitleFit(labels, labelRanks(nodes, null), 1, true, undefined, { left: 0, top: -21, right: 1280, bottom: 21 })
      expect(els[0].dataset.plateHoles).toBe('true')
      expect(els[0].style.getPropertyValue('--plate-holes').match(/radial-gradient/g)).toHaveLength(1)
      expect(els[1].dataset.plateHoles).toBeUndefined()
      // b moves far off: nothing to show through
      els[1].dataset.x = '900'
      runTitleFit(labels, labelRanks(nodes, null), 1, true, undefined, { left: 0, top: -21, right: 1280, bottom: 21 })
      expect(els[0].dataset.plateHoles).toBeUndefined()
      expect(els[0].style.getPropertyValue('--plate-holes')).toBe('')
    } finally {
      restore()
    }
  })

  it('aims the holes on each frame where the renderer puts their circles, reading nothing laid out', () => {
    const restore = standInPlate()
    try {
      const { els, labels } = setUp([
        [100, 0],
        [140, 0],
      ])
      // the renderer's place for each label (its circle's centre here), at the label scale the stand-in draws (its
      // circles 10 px across, radius 11 card px)
      const place = (e: HTMLElement, x: number) => (e.style.transform = `translate(-50%, -50%) translate(${x}px, ${Number(e.dataset.y)}px)`)
      els.forEach(e => place(e, Number(e.dataset.x)))
      document.body.style.setProperty('--label-scale', String(PLATE_PX))
      const nodes = [node('a', { selected: true }), node('b')]
      nodes.forEach(n => renderLabel(labels.get(n.id)!, n))
      runTitleFit(labels, labelRanks(nodes, null), 1, true, undefined, { left: 0, top: -21, right: 1280, bottom: 21 })
      expect(els[0].dataset.plateHoles).toBe('true')
      const holeX = () => Number(/at ([\d.-]+)px/.exec(els[0].style.getPropertyValue('--plate-holes'))![1])
      const rect = Element.prototype.getBoundingClientRect
      let reads = 0
      Element.prototype.getBoundingClientRect = function (this: Element) {
        reads++
        return rect.call(this)
      }
      aimPlateHoles(labels)
      const before = holeX()
      // a zoom moves b 6 px further from a: its hole follows it, in the plate's own px
      place(els[1], 146)
      aimPlateHoles(labels)
      Element.prototype.getBoundingClientRect = rect
      const s = PLATE_PX * Math.max(1, MARK_CSS.minTitle / (MARK_CSS.title * PLATE_PX))
      expect(holeX() - before).toBeCloseTo(6 / s, 1)
      expect(reads, 'nothing read laid out').toBe(0)
      // where b leaves the plate, no hole is cut for it
      place(els[1], 900)
      aimPlateHoles(labels)
      expect(els[0].style.getPropertyValue('--plate-holes')).toBe('')
    } finally {
      document.body.style.removeProperty('--label-scale')
      restore()
    }
  })
})

describe('titleLine: the longest drawn line of a title, for the whole-plan frame', () => {
  // a 22px circle (radius SIZE.normal, so 1 screen px a card px) at x 0, its text block from x 22, boosted 2 times: each
  // line of the words or the due line given by how far it ends from the block's left (`pieces`, by class)
  const stand = (pieces: Record<string, number[]>) => {
    const original = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this.classList.contains('node-dot')) return new DOMRect(-11, -11, 22, 22)
      if (this.classList.contains('node-label-title')) return new DOMRect(22, -16, 300, 32)
      if (this.classList.contains('node-label-text')) return new DOMRect(22, -16, 300, 52)
      if (this.classList.contains('node-label-due')) return new DOMRect(22, 16, 300, 20)
      return original.call(this)
    }
    const proto = Range.prototype as unknown as { getClientRects?: () => DOMRect[] }
    proto.getClientRects = function (this: Range) {
      const n = this.startContainer
      const of = n instanceof Element ? n : n.parentElement!
      const part = Object.keys(pieces).find(c => of.closest(`.${c}`))
      return (part ? pieces[part] : []).map((w, i) => new DOMRect(22, -16 + 16 * i, w, 16))
    }
    return () => {
      Element.prototype.getBoundingClientRect = original
      delete proto.getClientRects
      document.body.replaceChildren()
    }
  }
  const dated = (id: string) => node(id, { title: 'A title long enough to wrap onto a second line', due: { date: 'x', text: 'due in 3 days', strength: 1, overdue: false, radius: 11, scale: 1 } })

  it('is how far the longest line of its words or its due line ends from where its text block starts, in card px at no boost', () => {
    const restore = stand({ 'node-label-words': [180, 236], 'node-label-due': [120] })
    try {
      const a = createLabelElement('a', () => {})
      renderLabel(a, dated('a'))
      document.body.append(a)
      const labels = new Map([['a', a]])
      expect(titleLine(a), 'not measured yet').toBeUndefined()
      runTitleFit(labels, labelRanks([dated('a')], null), 2, true, 0.4)
      expect(titleLine(a)).toBeCloseTo(236 / 2, 6)
      // a run that measures nothing (the view gliding) keeps it
      runTitleFit(labels, labelRanks([dated('a')], null), 2, false, 0.4)
      expect(titleLine(a)).toBeCloseTo(118, 6)
    } finally {
      restore()
    }
  })

  it("is the line of the words drawn now: back to an earlier title its kept shape's line, a title not measured yet none", () => {
    const pieces: Record<string, number[]> = { 'node-label-words': [200] }
    const restore = stand(pieces)
    try {
      const titled = (title: string) => node('a', { title })
      const a = createLabelElement('a', () => {})
      renderLabel(a, titled('Title A'))
      document.body.append(a)
      const labels = new Map([['a', a]])
      runTitleFit(labels, labelRanks([titled('Title A')], null), 2, true, 0.4)
      expect(titleLine(a), 'A measured').toBeCloseTo(100, 6)
      // edited to B: not measured yet, so the frame counts its box
      renderLabel(a, titled('Title B'))
      expect(titleLine(a), 'B before its measure').toBeUndefined()
      pieces['node-label-words'] = [100]
      runTitleFit(labels, labelRanks([titled('Title B')], null), 2, true, 0.4)
      expect(titleLine(a), 'B measured').toBeCloseTo(50, 6)
      // back to A: placed from its kept shape (not saved again), and its line is A's
      renderLabel(a, titled('Title A'))
      pieces['node-label-words'] = [999]
      runTitleFit(labels, labelRanks([titled('Title A')], null), 2, true, 0.4)
      expect(titleLine(a), 'A again').toBeCloseTo(100, 6)
    } finally {
      restore()
    }
  })

  it('counts the due line where it is the longer', () => {
    const restore = stand({ 'node-label-words': [60], 'node-label-due': [120] })
    try {
      const a = createLabelElement('a', () => {})
      renderLabel(a, dated('a'))
      document.body.append(a)
      runTitleFit(new Map([['a', a]]), labelRanks([dated('a')], null), 2, true, 0.4)
      expect(titleLine(a)).toBeCloseTo(60, 6)
    } finally {
      restore()
    }
  })

  it('is unknown where the page gives no lines, and for a deck', () => {
    const restore = stand({})
    try {
      const a = createLabelElement('a', () => {})
      renderLabel(a, node('a'))
      document.body.append(a)
      runTitleFit(new Map([['a', a]]), labelRanks([node('a')], null), 2, true, 0.4)
      expect(titleLine(a)).toBeUndefined()
    } finally {
      restore()
    }
    const back = stand({ 'node-label-words': [100] })
    try {
      const d = createLabelElement('d', () => {})
      renderLabel(d, node('d'))
      d.dataset.deck = 'true'
      document.body.append(d)
      runTitleFit(new Map([['d', d]]), labelRanks([node('d')], null), 2, true, 0.4)
      expect(titleLine(d)).toBeUndefined()
    } finally {
      back()
    }
  })
})

describe('runTitleFit decided afresh', () => {
  it("keeps a title shown before while it overlaps by the slack, but decides a fresh run as if nothing were shown (the load's frame landing)", () => {
    // b's title ends 1 px into a's circle (22px circles, so the words draw over the floor): within FIT.slack, so a title
    // already shown full stays; one not shown must clear by FIT.gap. A fresh run ignores what was shown.
    const at = (e: Element) => {
      const l = e.closest<HTMLElement>('.node-label')!
      const x = Number(l.dataset.x)
      if (e.classList.contains('node-dot')) return new DOMRect(x - 11, -11, 22, 22)
      if (e.classList.contains('node-label-title')) return new DOMRect(x + 12, -6, Number(l.dataset.w), 12)
      if (e.classList.contains('node-label-text')) return new DOMRect(x + 12, -6, 150, 12)
      return new DOMRect(0, 0, 0, 0)
    }
    const original = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function (this: Element) {
      return this.closest('.node-label') ? at(this) : original.call(this)
    }
    try {
      const a = createLabelElement('a', () => {})
      const b = createLabelElement('b', () => {})
      a.dataset.w = '40'
      b.dataset.x = '40'
      document.body.append(a, b)
      const labels = new Map([
        ['a', a],
        ['b', b],
      ])
      const nodes = [node('a', { priority: 'high' }), node('b')]
      nodes.forEach(n => renderLabel(labels.get(n.id)!, n))
      b.dataset.w = '238'
      const fit = (ax: number, fresh: boolean) => {
        a.dataset.x = String(ax)
        b.dataset.titleFit = 'full'
        runTitleFit(labels, labelRanks(nodes, null), 1, true, undefined, undefined, fresh)
        return b.dataset.titleFit
      }
      // b's words run from 52 to 290; a's circle starts 11 px left of its x
      expect(fit(300, false), 'shown, 1 px into the circle: kept').toBe('full')
      expect(fit(300, true), 'afresh, 1 px into the circle: not kept').not.toBe('full')
      expect(fit(310, true), 'afresh, clear by the gap: full').toBe('full')
    } finally {
      Element.prototype.getBoundingClientRect = original
    }
  })
})
