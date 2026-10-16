import { describe, expect, it } from 'vitest'
import { initialStep } from './pageState.js'
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
})
