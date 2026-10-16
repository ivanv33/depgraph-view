import { describe, expect, it } from 'vitest'
import { initialSelection, MARK_MS, MARK_CHECK_MS, marksDue, nextSignal, selectionStep, type SelectionState } from './selection.js'

const none = { type: 'none' }
const selected = (id: string): SelectionState => ({ selectedId: id, arming: false })
const armed = (id: string): SelectionState => ({ selectedId: id, arming: true })

describe('selectionStep: selecting', () => {
  it('selectNode selects the node', () => {
    expect(selectionStep(initialSelection, { type: 'selectNode', id: 'a' })).toEqual({ state: selected('a'), effect: none })
    expect(selectionStep(selected('a'), { type: 'selectNode', id: 'b' })).toEqual({ state: selected('b'), effect: none })
  })

  it('background deselects', () => {
    expect(selectionStep(selected('a'), { type: 'background' })).toEqual({ state: initialSelection, effect: none })
  })

  it('clear resets everything, even while arming', () => {
    expect(selectionStep(armed('a'), { type: 'clear' })).toEqual({ state: initialSelection, effect: none })
  })
})

describe('selectionStep: linking', () => {
  it('armLink without a selection asks for one', () => {
    expect(selectionStep(initialSelection, { type: 'armLink' })).toEqual({
      state: initialSelection,
      effect: { type: 'toast', message: 'select a node first' },
    })
  })

  it('armLink with a selection arms', () => {
    expect(selectionStep(selected('a'), { type: 'armLink' })).toEqual({ state: armed('a'), effect: none })
  })

  it('while armed, clicking another node makes it a dependency of the selection and stays armed', () => {
    expect(selectionStep(armed('a'), { type: 'selectNode', id: 'b' })).toEqual({
      state: armed('a'),
      effect: { type: 'link', dependencyId: 'b', dependentId: 'a' },
    })
  })

  it('while armed, clicking the selection itself asks for that link too: the one link path refuses it (linkRefusal)', () => {
    expect(selectionStep(armed('a'), { type: 'selectNode', id: 'a' })).toEqual({
      state: armed('a'),
      effect: { type: 'link', dependencyId: 'a', dependentId: 'a' },
    })
  })

  it('while armed, a background click only disarms', () => {
    expect(selectionStep(armed('a'), { type: 'background' })).toEqual({ state: selected('a'), effect: none })
  })

  it('disarm keeps the selection', () => {
    expect(selectionStep(armed('a'), { type: 'disarm' })).toEqual({ state: selected('a'), effect: none })
  })
})

describe('selectionStep: escape backs out one step', () => {
  it('armed -> selected -> nothing', () => {
    const one = selectionStep(armed('a'), { type: 'escape' })
    expect(one).toEqual({ state: selected('a'), effect: none })
    const two = selectionStep(one.state, { type: 'escape' })
    expect(two).toEqual({ state: initialSelection, effect: none })
    expect(selectionStep(two.state, { type: 'escape' })).toEqual({ state: initialSelection, effect: none })
  })
})

describe('selectionStep: focusNode (chip navigation)', () => {
  it('selects the node and disarms instead of linking', () => {
    expect(selectionStep(armed('a'), { type: 'focusNode', id: 'b' })).toEqual({ state: selected('b'), effect: none })
    expect(selectionStep(initialSelection, { type: 'focusNode', id: 'b' })).toEqual({ state: selected('b'), effect: none })
  })
})

describe('nextSignal', () => {
  it('bumps the sequence so the same id can be requested twice', () => {
    const one = nextSignal(null, 'a')
    expect(one).toEqual({ id: 'a', seq: 1 })
    expect(nextSignal(one, 'a')).toEqual({ id: 'a', seq: 2 })
    expect(nextSignal(one, 'b')).toEqual({ id: 'b', seq: 2 })
  })
})

describe('marksDue', () => {
  it('shows the ids still due and ends the rest, whatever the plan holds', () => {
    expect(MARK_MS).toBe(2400)
    expect(MARK_CHECK_MS).toBe(100)
    const until = new Map([['sow-beans', 2400], ['water-rota', 1000]])
    expect(marksDue(until, 1500)).toEqual({ shown: ['sow-beans'], ended: ['water-rota'] })
    expect([...until.keys()]).toEqual(['sow-beans'])
    expect(marksDue(until, 2400)).toEqual({ shown: [], ended: ['sow-beans'] })
    expect(until.size).toBe(0)
  })
})
