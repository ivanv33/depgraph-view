import { describe, expect, it } from 'vitest'
import { countStates, NODE_STATES, nodeStates } from './readiness.js'
import type { Plan, PlanNode, Status } from './schema.js'

const n = (id: string, status: Status, depends_on: string[] = []): PlanNode => ({ id, title: id, description: '', status, tags: [], depends_on })
const plan = (...nodes: PlanNode[]): Plan => ({ name: 'p', nodes })

describe('nodeStates', () => {
  it('maps done/doing/blocked to themselves', () => {
    const s = nodeStates(plan(n('a', 'done'), n('b', 'doing', ['x']), n('c', 'blocked')))
    expect([s.get('a'), s.get('b'), s.get('c')]).toEqual(['done', 'doing', 'blocked'])
  })
  it('todo without deps is ready', () => {
    expect(nodeStates(plan(n('a', 'todo'))).get('a')).toBe('ready')
  })
  it('todo is ready when all deps done, waiting otherwise', () => {
    const s = nodeStates(plan(n('a', 'done'), n('b', 'doing'), n('c', 'todo', ['a']), n('d', 'todo', ['a', 'b'])))
    expect(s.get('c')).toBe('ready')
    expect(s.get('d')).toBe('waiting')
  })
  it('ignores unknown dependency ids', () => {
    const s = nodeStates(plan(n('a', 'todo', ['ghost']), n('b', 'todo', ['ghost', 'c']), n('c', 'todo')))
    expect(s.get('a')).toBe('ready')
    expect(s.get('b')).toBe('waiting')
  })
})

describe('countStates', () => {
  it('counts every state, including zeros', () => {
    const c = countStates(nodeStates(plan(n('a', 'done'), n('b', 'todo', ['a']), n('c', 'todo', ['b']))))
    expect(c).toEqual({ ready: 1, waiting: 1, doing: 0, blocked: 0, done: 1 })
  })
  it('NODE_STATES lists all five in display order', () => {
    expect(NODE_STATES).toEqual(['ready', 'doing', 'waiting', 'blocked', 'done'])
  })
})
