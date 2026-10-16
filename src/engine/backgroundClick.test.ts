import { describe, expect, it } from 'vitest'
import { backgroundAction } from './backgroundClick.js'

describe('backgroundAction', () => {
  it.each([
    // a plain click on empty canvas deselects, as before
    [{ shift: false, arming: false, linking: false, onText: false }, 'deselect'],
    // Shift+click on empty canvas asks for a new step's name
    [{ shift: true, arming: false, linking: false, onText: false }, 'add'],
    // with L armed a click on the canvas does what it did before: Shift adds nothing then
    [{ shift: true, arming: true, linking: false, onText: false }, 'deselect'],
    [{ shift: false, arming: true, linking: false, onText: false }, 'deselect'],
    // a click on the selected step's own text is a click on that step, Shift or not
    [{ shift: false, arming: false, linking: false, onText: true }, 'selected'],
    [{ shift: true, arming: false, linking: false, onText: true }, 'selected'],
    [{ shift: true, arming: true, linking: false, onText: true }, 'selected'],
    // with a Shift+click link pending, a click on the canvas only cancels it: it adds no step and keeps the selection
    [{ shift: true, arming: false, linking: true, onText: false }, 'cancelLink'],
    [{ shift: false, arming: false, linking: true, onText: false }, 'cancelLink'],
    // ...but one on the selected step's own text is a click on that step (it may be where the link goes)
    [{ shift: true, arming: false, linking: true, onText: true }, 'selected'],
  ] as const)('%o -> %s', (input, want) => {
    expect(backgroundAction(input)).toBe(want)
  })

  it.each([
    // the second or later press of a multi-click (a double-click, or two quick clicks) is set aside
    [{ shift: false, arming: false, linking: false, onText: false, detail: 2 }, 'ignore'],
    [{ shift: false, arming: false, linking: false, onText: false, detail: 3 }, 'ignore'],
    [{ shift: true, arming: false, linking: true, onText: true, detail: 2 }, 'ignore'],
    // a first press, or a synthetic click with no count, is unchanged
    [{ shift: false, arming: false, linking: false, onText: false, detail: 1 }, 'deselect'],
    [{ shift: false, arming: false, linking: false, onText: false, detail: 0 }, 'deselect'],
    [{ shift: true, arming: false, linking: false, onText: false, detail: 1 }, 'add'],
    [{ shift: false, arming: false, linking: false, onText: true, detail: 1 }, 'selected'],
  ] as const)('%o -> %s', (input, want) => {
    expect(backgroundAction(input)).toBe(want)
  })
})
