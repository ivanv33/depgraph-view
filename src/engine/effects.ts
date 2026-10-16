import type { PlanNode, Status } from './schema.js'

export function takeNewlyDone(seen: Map<string, Status>, nodes: ReadonlyArray<Pick<PlanNode, 'id' | 'status'>>): string[] {
  const ids = nodes.filter(n => n.status === 'done' && seen.has(n.id) && seen.get(n.id) !== 'done').map(n => n.id)
  seen.clear()
  for (const n of nodes) seen.set(n.id, n.status)
  return ids
}

export const BURST_MS = 700

export function burstFrame(elapsedMs: number, ms = BURST_MS): { scale: number; opacity: number; done: boolean } {
  const t = Math.min(Math.max(elapsedMs / ms, 0), 1)
  return { scale: 1 + 3 * t, opacity: 0.9 * (1 - t), done: t >= 1 }
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
