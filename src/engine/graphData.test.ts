import { describe, expect, it } from 'vitest'
import { placeNodes, structureKey, toGraphData, type GraphNode } from './graphData.js'
import type { Plan } from './schema.js'

const plan: Plan = {
  name: 'p',
  nodes: [
    { id: 'a', title: 'A', description: '', status: 'done', tags: [], depends_on: [] },
    { id: 'b', title: 'B', description: '', status: 'todo', tags: [], depends_on: ['a'] },
  ],
}

describe('toGraphData', () => {
  it('maps nodes and derives links dependency->dependent', () => {
    const data = toGraphData(plan, new Map())
    expect(data.nodes).toEqual([{ id: 'a', title: 'A', status: 'done' }, { id: 'b', title: 'B', status: 'todo' }])
    expect(data.links).toEqual([{ source: 'a', target: 'b' }])
  })
  it('reuses cached node objects and updates them in place', () => {
    const cache = new Map<string, GraphNode>()
    const first = toGraphData(plan, cache)
    first.nodes[0].x = 42
    const updated: Plan = { ...plan, nodes: [{ ...plan.nodes[0], title: 'A2' }] }
    const second = toGraphData(updated, cache)
    expect(second.nodes[0]).toBe(first.nodes[0])
    expect(second.nodes[0].x).toBe(42)
    expect(second.nodes[0].title).toBe('A2')
    expect(cache.has('b')).toBe(false)
  })
})

describe('structureKey', () => {
  const n = (id: string, depends_on: string[]) => ({ id, depends_on })
  it('is the JSON of [id, depends_on] pairs', () => {
    expect(structureKey([n('a', []), n('b', ['a'])])).toBe(JSON.stringify([['a', []], ['b', ['a']]]))
  })
  it('never collides for different structures, whatever the strings hold', () => {
    expect(structureKey([n('a', ['b,c'])])).not.toBe(structureKey([n('a', ['b', 'c'])]))
    expect(structureKey([n('a:', ['b'])])).not.toBe(structureKey([n('a', [':b'])]))
    expect(structureKey([n('a', ['x|b:'])])).not.toBe(structureKey([n('a', ['x']), n('b', [])]))
  })
  it('ignores everything but ids and dependencies', () => {
    expect(structureKey([{ ...n('a', []), title: 'x' } as never])).toBe(structureKey([n('a', [])]))
  })
})

describe('placeNodes', () => {
  it('pins each node to its layout slot (y up) on the z = 0 plane; no slot is left alone', () => {
    const a: GraphNode = { id: 'a', title: 'A', status: 'todo', z: 260 }
    const b: GraphNode = { id: 'b', title: 'B', status: 'todo' }
    const c: GraphNode = { id: 'c', title: 'C', status: 'todo', x: 7, y: 8, z: 9 }
    placeNodes([a, b, c], new Map([['a', { x: 10, y: 20 }], ['b', { x: -5, y: 0 }]]))
    expect(a).toMatchObject({ x: 10, fx: 10, y: -20, fy: -20, z: 0, fz: 0 })
    expect(b).toMatchObject({ x: -5, fx: -5, y: -0, fy: -0, z: 0, fz: 0 })
    expect(c).toMatchObject({ x: 7, y: 8, z: 9 })
  })
})
