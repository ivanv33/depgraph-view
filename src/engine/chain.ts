import type { Plan } from './schema.js'

export interface Chain {
  upstream: Set<string>
  downstream: Set<string>
}

function reach(start: string, next: Map<string, string[]>): Set<string> {
  const seen = new Set<string>()
  const stack = [start]
  while (stack.length) {
    for (const m of next.get(stack.pop()!) ?? []) {
      if (m === start || seen.has(m)) continue
      seen.add(m)
      stack.push(m)
    }
  }
  return seen
}

export function chainOf(plan: Plan, id: string | null): Chain {
  if (id === null || !plan.nodes.some(n => n.id === id)) return { upstream: new Set(), downstream: new Set() }
  const ids = new Set(plan.nodes.map(n => n.id))
  const deps = new Map<string, string[]>()
  const dependents = new Map<string, string[]>()
  for (const n of plan.nodes) {
    const known = n.depends_on.filter(d => ids.has(d))
    deps.set(n.id, known)
    for (const d of known) dependents.set(d, [...(dependents.get(d) ?? []), n.id])
  }
  return { upstream: reach(id, deps), downstream: reach(id, dependents) }
}

/**
 * One hop of the chain: the steps `id` needs directly (`upstream`) and the steps that need it directly (`downstream`),
 * never `id` itself. A selection is framed with these, not with its whole chain.
 */
export function neighboursOf(plan: Plan, id: string | null): Chain {
  const node = id === null ? undefined : plan.nodes.find(n => n.id === id)
  if (!node) return { upstream: new Set(), downstream: new Set() }
  const ids = new Set(plan.nodes.map(n => n.id))
  return {
    upstream: new Set(node.depends_on.filter(d => d !== node.id && ids.has(d))),
    downstream: new Set(plan.nodes.filter(n => n.id !== node.id && n.depends_on.includes(node.id)).map(n => n.id)),
  }
}
