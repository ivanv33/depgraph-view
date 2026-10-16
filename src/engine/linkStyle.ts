import type { Chain } from './chain.js'

export type LinkRole = 'upstream' | 'downstream' | 'other' | 'none' | 'hover'

export function linkRole(sourceId: string, targetId: string, selectedId: string | null, chain: Chain, hoveredId: string | null = null): LinkRole {
  if (selectedId === null) return hoveredId !== null && (sourceId === hoveredId || targetId === hoveredId) ? 'hover' : 'none'
  if (chain.upstream.has(sourceId) && (targetId === selectedId || chain.upstream.has(targetId))) return 'upstream'
  if (chain.downstream.has(targetId) && (sourceId === selectedId || chain.downstream.has(sourceId))) return 'downstream'
  return 'other'
}

export interface LinkStyle {
  color: string
  /** Line width in screen pixels. */
  width: number
  /** Arrowhead length in layout units. */
  arrow: number
  dashed: boolean
}

/** `redundant`: the edge is implied by a longer path between the same ends. */
export function linkStyle(role: LinkRole, sourceDone: boolean, redundant = false): LinkStyle {
  switch (role) {
    case 'upstream':
      return redundant ? { color: '#ffb454', width: 1.2, arrow: 6, dashed: false } : { color: '#ffb454', width: 2.6, arrow: 10, dashed: false }
    case 'downstream':
      return redundant ? { color: '#5ac8fa', width: 1.2, arrow: 6, dashed: false } : { color: '#5ac8fa', width: 2.6, arrow: 10, dashed: false }
    case 'hover':
      return { color: '#c9d3e6', width: 2.6, arrow: 10, dashed: false }
    case 'other':
      return { color: '#2a3040', width: 0.8, arrow: 5, dashed: false }
    case 'none':
      if (redundant) return { color: '#2a3040', width: 0.8, arrow: 4, dashed: true }
      return sourceDone
        ? { color: '#4a5266', width: 1, arrow: 6, dashed: false }
        : { color: '#c9d3e6', width: 1.8, arrow: 9, dashed: false }
  }
}

/**
 * An edge fades with the fainter of its two ends (each is 1 when undated, done or focused), except while it is
 * highlighted (hovered, or on the selected chain): then it is drawn at full strength.
 */
export function edgeOpacity(sourceHaze: number, targetHaze: number, role: LinkRole = 'none'): number {
  if (role === 'upstream' || role === 'downstream' || role === 'hover') return 1
  return Math.min(sourceHaze, targetHaze)
}
