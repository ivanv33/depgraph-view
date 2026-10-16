import { describe, expect, it } from 'vitest'
import { chainOf, neighboursOf } from './chain.js'
import type { Plan, PlanNode } from './schema.js'

const n = (id: string, depends_on: string[] = []): PlanNode => ({ id, title: id, description: '', status: 'todo', tags: [], depends_on })
const plan = (...nodes: PlanNode[]): Plan => ({ name: 'p', nodes })

describe('chainOf', () => {
  const p = plan(n('a'), n('b', ['a']), n('c', ['b']), n('d', ['c']), n('x'))
  it('collects transitive upstream and downstream, excluding the node', () => {
    const c = chainOf(p, 'b')
    expect([...c.upstream].sort()).toEqual(['a'])
    expect([...c.downstream].sort()).toEqual(['c', 'd'])
    expect([...chainOf(p, 'd').upstream].sort()).toEqual(['a', 'b', 'c'])
  })
  it('null or unknown id gives empty sets', () => {
    for (const id of [null, 'nope']) {
      const c = chainOf(p, id)
      expect(c.upstream.size).toBe(0)
      expect(c.downstream.size).toBe(0)
    }
  })
  it('terminates on cycles and excludes the node itself', () => {
    const cyc = plan(n('a', ['c']), n('b', ['a']), n('c', ['b']))
    const c = chainOf(cyc, 'a')
    expect([...c.upstream].sort()).toEqual(['b', 'c'])
    expect([...c.downstream].sort()).toEqual(['b', 'c'])
  })
  it('ignores unknown dependency ids', () => {
    expect(chainOf(plan(n('a', ['ghost'])), 'a').upstream.size).toBe(0)
  })
})

describe('neighboursOf', () => {
  const p = plan(n('a'), n('b', ['a']), n('c', ['b']), n('d', ['c']), n('e', ['c', 'a']), n('x'))
  it('collects only the direct needs and the steps that need it directly, excluding the node', () => {
    const c = neighboursOf(p, 'c')
    expect([...c.upstream].sort()).toEqual(['b'])
    expect([...c.downstream].sort()).toEqual(['d', 'e'])
    expect([...neighboursOf(p, 'a').downstream].sort()).toEqual(['b', 'e'])
    expect(neighboursOf(p, 'a').upstream.size).toBe(0)
  })
  it('null or unknown id gives empty sets, unknown needs are ignored and a step is never its own neighbour', () => {
    for (const id of [null, 'nope']) expect(neighboursOf(p, id).upstream.size + neighboursOf(p, id).downstream.size).toBe(0)
    expect(neighboursOf(plan(n('a', ['ghost'])), 'a').upstream.size).toBe(0)
    const self = neighboursOf(plan(n('a', ['a', 'b']), n('b')), 'a')
    expect([...self.upstream]).toEqual(['b'])
    expect(self.downstream.size).toBe(0)
  })
})
