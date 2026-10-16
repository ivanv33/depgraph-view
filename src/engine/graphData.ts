import type { PlanNode, Status } from './schema.js'

/** A key that changes exactly when the set of nodes or their dependencies does. */
export const structureKey = (nodes: Pick<PlanNode, 'id' | 'depends_on'>[]) => JSON.stringify(nodes.map(n => [n.id, n.depends_on]))

export interface GraphNode {
  id: string
  title: string
  status: Status
  x?: number
  y?: number
  z?: number
  /** Pinned position: the layered layout decides where every node goes. */
  fx?: number
  fy?: number
  fz?: number
}
export interface GraphLink { source: string; target: string }
export interface GraphData { nodes: GraphNode[]; links: GraphLink[] }

export function toGraphData(plan: { nodes: Pick<PlanNode, 'id' | 'title' | 'status' | 'depends_on'>[] }, cache: Map<string, GraphNode>): GraphData {
  const ids = new Set(plan.nodes.map(n => n.id))
  for (const id of [...cache.keys()]) if (!ids.has(id)) cache.delete(id)
  const nodes = plan.nodes.map(n => {
    const existing = cache.get(n.id)
    if (existing) {
      existing.title = n.title
      existing.status = n.status
      return existing
    }
    const fresh: GraphNode = { id: n.id, title: n.title, status: n.status }
    cache.set(n.id, fresh)
    return fresh
  })
  const links: GraphLink[] = []
  for (const n of plan.nodes) for (const d of n.depends_on) links.push({ source: d, target: n.id })
  return { nodes, links }
}

/** Pins each node with a slot to it (layout y runs down, the scene's up) on the z = 0 plane. */
export function placeNodes(nodes: GraphNode[], slots: Map<string, { x: number; y: number }>): void {
  for (const n of nodes) {
    const p = slots.get(n.id)
    if (!p) continue
    n.x = n.fx = p.x
    n.y = n.fy = -p.y
    n.z = n.fz = 0
  }
}
