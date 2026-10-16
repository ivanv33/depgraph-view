import { describe, expect, it } from 'vitest'
import { initialSearch, initialStep } from './pageState.js'
import type { Plan } from '../engine/schema.js'

/** A fictional two-step plan. */
const plan: Plan = {
  name: 'Herb pots',
  nodes: [
    { id: 'a', title: 'Buy pots', description: '', status: 'todo', tags: [], depends_on: [] },
    { id: 'b', title: 'Plant basil', description: '', status: 'todo', tags: [], depends_on: ['a'] },
  ],
}

describe('initialStep', () => {
  it('initialStep ignores unknown ids', () => {
    expect(initialStep('?step=b', plan)).toBe('b')
    expect(initialStep('?step=gone', plan)).toBeNull()
    expect(initialStep('?step=Bad%20Id', plan)).toBeNull()
    expect(initialStep('', plan)).toBeNull()
  })
  it('initialSearch drops an unknown step from the query and keeps a known one and other params', () => {
    expect(initialSearch('?step=gone', plan)).toBe('')
    expect(initialSearch('?x=1&step=gone', plan)).toBe('?x=1')
    expect(initialSearch('?step=b&x=1', plan)).toBe('?step=b&x=1')
    expect(initialSearch('', plan)).toBe('')
  })
})
