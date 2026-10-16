// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { markOverPlate, refreshOverPlate, shownLabels } from './overPlate.js'

/** A stand-in label: its words' box and, when selected, its plate's and brackets' boxes. */
function label(id: string, words: DOMRect, selected?: { plate: DOMRect; mark: DOMRect }) {
  const el = document.createElement('div')
  el.className = 'node-label'
  el.dataset.nodeId = id
  // a cut title, the pointer on its circle: what is drawn over the plate (the selected one is never cut)
  if (!selected) {
    el.dataset.titleFit = 'short'
    el.dataset.hovered = 'true'
  }
  const text = document.createElement('div')
  text.className = 'node-label-text'
  text.getBoundingClientRect = () => selected?.plate ?? words
  el.append(text)
  if (selected) {
    el.dataset.selected = 'true'
    const mark = document.createElement('div')
    mark.className = 'node-mark'
    mark.getBoundingClientRect = () => selected.mark
    el.append(mark)
  }
  document.body.append(el)
  return el
}

afterEach(() => document.body.replaceChildren())

describe('markOverPlate', () => {
  it('leaves the plate alone for a title shown in full, or a label focused by a click: nothing is drawn over it then', () => {
    const sel = label('s', new DOMRect(), { plate: new DOMRect(120, 90, 100, 30), mark: new DOMRect(95, 95, 20, 20) })
    const whole = label('a', new DOMRect(60, 95, 90, 14))
    delete whole.dataset.titleFit
    markOverPlate([whole], [sel, whole])
    expect(whole.dataset.overPlate).toBeUndefined()
    expect(sel.dataset.plateCovered).toBeUndefined()
    const clicked = label('b', new DOMRect(60, 95, 90, 14))
    delete clicked.dataset.hovered
    clicked.tabIndex = 0
    clicked.matches = (q: string) => (q === ':focus-visible' ? false : Element.prototype.matches.call(clicked, q))
    clicked.focus()
    refreshOverPlate([sel, whole, clicked])
    expect(clicked.dataset.overPlate).toBeUndefined()
    expect(sel.dataset.plateCovered).toBeUndefined()
  })

  it("raises a hovered neighbour whose shown words cross the selected step's plate or brackets, and only that one", () => {
    const sel = label('s', new DOMRect(), { plate: new DOMRect(120, 90, 100, 30), mark: new DOMRect(95, 95, 20, 20) })
    const crossing = label('a', new DOMRect(60, 95, 90, 14))
    const brackets = label('b', new DOMRect(60, 100, 40, 14))
    const clear = label('c', new DOMRect(60, 200, 90, 14))
    const all = [sel, crossing, brackets, clear]
    markOverPlate([crossing], all)
    expect(crossing.dataset.overPlate).toBe('true')
    expect(sel.dataset.plateCovered, 'the plate steps aside under it').toBe('true')
    markOverPlate([brackets], all)
    expect(brackets.dataset.overPlate).toBe('true')
    expect(crossing.dataset.overPlate, 'the one left is let go').toBeUndefined()
    markOverPlate([clear], all)
    expect(clear.dataset.overPlate).toBeUndefined()
    expect(brackets.dataset.overPlate).toBeUndefined()
    expect(sel.dataset.plateCovered, 'and comes back once nothing covers it').toBeUndefined()
  })

  it('is worked out again for the label shown on hover once things have moved (after a title fit)', () => {
    const plate = { plate: new DOMRect(120, 90, 100, 30), mark: new DOMRect(95, 95, 20, 20) }
    const sel = label('s', new DOMRect(), plate)
    const a = label('a', new DOMRect(60, 95, 90, 14))
    a.dataset.hovered = 'true'
    refreshOverPlate([sel, a])
    expect(a.dataset.overPlate).toBe('true')
    // zoomed in: the plate moved away from the shown words
    plate.plate = new DOMRect(400, 90, 100, 30)
    plate.mark = new DOMRect(375, 95, 20, 20)
    refreshOverPlate([sel, a])
    expect(a.dataset.overPlate).toBeUndefined()
  })

  it('raises the label with the keyboard focus too, alongside a hovered one, and lets it go when the focus moves on', () => {
    const sel = label('s', new DOMRect(), { plate: new DOMRect(120, 90, 100, 30), mark: new DOMRect(95, 95, 20, 20) })
    const a = label('a', new DOMRect(60, 95, 90, 14))
    const b = label('b', new DOMRect(60, 100, 40, 14))
    delete a.dataset.hovered
    a.tabIndex = 0
    // focused by the keyboard
    a.matches = (q: string) => q === ':focus-visible' ? document.activeElement === a : Element.prototype.matches.call(a, q)
    a.focus()
    expect(shownLabels([sel, a, b]).map(l => l.dataset.nodeId)).toEqual(['a', 'b'])
    refreshOverPlate([sel, a, b])
    expect(a.dataset.overPlate).toBe('true')
    expect(b.dataset.overPlate).toBe('true')
    a.blur()
    refreshOverPlate([sel, a, b])
    expect(a.dataset.overPlate).toBeUndefined()
    expect(b.dataset.overPlate).toBe('true')
  })

  it('raises nothing with nothing hovered, nothing selected, or the selected step itself hovered', () => {
    const sel = label('s', new DOMRect(), { plate: new DOMRect(120, 90, 100, 30), mark: new DOMRect(95, 95, 20, 20) })
    const a = label('a', new DOMRect(60, 95, 90, 14))
    markOverPlate([a], [sel, a])
    markOverPlate([null], [sel, a])
    expect(a.dataset.overPlate).toBeUndefined()
    markOverPlate([sel], [sel, a])
    expect(sel.dataset.overPlate).toBeUndefined()
    delete sel.dataset.selected
    markOverPlate([a], [sel, a])
    expect(a.dataset.overPlate).toBeUndefined()
  })
})
