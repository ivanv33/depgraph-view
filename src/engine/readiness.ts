import type { Plan } from './schema.js'

export type NodeState = 'ready' | 'waiting' | 'doing' | 'blocked' | 'done'
export const NODE_STATES: NodeState[] = ['ready', 'doing', 'waiting', 'blocked', 'done']

export function nodeStates(plan: Plan): Map<string, NodeState> {
  const status = new Map(plan.nodes.map(n => [n.id, n.status]))
  const out = new Map<string, NodeState>()
  for (const n of plan.nodes) {
    if (n.status !== 'todo') {
      out.set(n.id, n.status)
      continue
    }
    const open = n.depends_on.some(d => status.has(d) && status.get(d) !== 'done')
    out.set(n.id, open ? 'waiting' : 'ready')
  }
  return out
}

export function countStates(states: Map<string, NodeState>): Record<NodeState, number> {
  const counts: Record<NodeState, number> = { ready: 0, waiting: 0, doing: 0, blocked: 0, done: 0 }
  for (const s of states.values()) counts[s]++
  return counts
}
