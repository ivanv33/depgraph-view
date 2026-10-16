import { describe, expect, it } from 'vitest'
import type { Plan, PlanNode } from './schema.js'
import { searchSteps } from './search.js'

const node = (id: string, title: string): PlanNode => ({ id, title, description: '', status: 'todo', tags: [], depends_on: [] })
const planOf = (...nodes: PlanNode[]): Plan => ({ name: 'p', nodes })
const n = node
const ids = (plan: Plan, q: string) => searchSteps(plan, q).map(n => n.id)

describe('searchSteps', () => {
  const plan = planOf(
    node('a', 'Write the launch post'),
    node('b', 'Launch the site'),
    node('c', 'Relaunch checklist'),
    node('d', 'Pick a venue'),
    node('e', 'Order launch snacks'),
  )

  it('finds nothing for an empty or blank query', () => {
    expect(ids(plan, '')).toEqual([])
    expect(ids(plan, '   ')).toEqual([])
  })

  it('matches anywhere, ignoring case', () => {
    expect(ids(plan, 'VENUE')).toEqual(['d'])
    expect(ids(plan, 'aunc').sort()).toEqual(['a', 'b', 'c', 'e'])
  })

  it('ranks a prefix of the title first, then a prefix of a word, then elsewhere; plan order within a rank', () => {
    expect(ids(plan, 'launch')).toEqual(['b', 'a', 'e', 'c'])
  })

  it('matches words in any order, every word required', () => {
    expect(ids(plan, 'site launch')).toEqual(['b'])
    expect(ids(plan, 'post launch write')).toEqual(['a'])
    expect(ids(plan, 'launch venue')).toEqual([])
  })

  it('ranks a query whose every word starts a word of the title above one matched inside a word', () => {
    const p = planOf(node('x', 'Unpack boxes'), node('y', 'Pack the boxes'))
    expect(ids(p, 'pack box')).toEqual(['y', 'x'])
  })

  it('falls back to the id for a step with no title', () => {
    expect(ids(planOf(node('quiet-step', '')), 'quiet')).toEqual(['quiet-step'])
  })

  it('within the same rank, puts high before normal before low, then plan order; never across ranks', () => {
    const p = planOf(
      { ...node('l', 'Launch low'), priority: 'low' },
      node('n1', 'Launch plain'),
      { ...node('h1', 'Launch first high'), priority: 'high' },
      node('n2', 'Launch other'),
      { ...node('h2', 'Launch second high'), priority: 'high' },
      // rank 1 (a word starts with the query): a high one here stays below every rank-0 match
      { ...node('w', 'Plan the launch'), priority: 'high' },
    )
    expect(ids(p, 'launch')).toEqual(['h1', 'h2', 'n1', 'n2', 'l', 'w'])
  })

  it('matches a step by its id when no title word matches, ranked after every title match', () => {
    const plan = { name: 'p', nodes: [n('paint-shed', 'Paint the shed'), n('fence-gate', 'Fix the hinge'), n('shed-roof', 'Roof over the shed')] }
    expect(searchSteps(plan, 'fence').map(s => s.id)).toEqual(['fence-gate'])
    expect(searchSteps(plan, 'shed').map(s => s.id)).toEqual(['paint-shed', 'shed-roof'])
    // an id-only match comes after a title match even when it is earlier in the plan and higher priority
    const p = planOf({ ...n('shed-door', 'Hang the door'), priority: 'high' }, n('build-shed', 'Build the shed'))
    expect(ids(p, 'shed')).toEqual(['build-shed', 'shed-door'])
    expect(ids(p, 'shed  door')).toEqual(['shed-door'])
  })
})
