// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { deckView } from '../../engine/grouping.js'
import { deckListed } from '../../engine/nodeLabel.js'
import { nodeStates } from '../../engine/readiness.js'
import type { Plan } from '../../engine/schema.js'
import { useDeckViews } from './useDeckViews.js'

const step = (id: string, depends_on: string[]) => ({ id, title: `Step ${id}`, description: '', status: 'todo' as const, tags: [], depends_on })
const kids = Array.from({ length: 13 }, (_, i) => `c${i + 1}`)
const plan: Plan = { name: 'Thirteen', nodes: [step('goal', kids), ...kids.map(k => step(k, k === 'c1' ? ['g'] : [])), step('g', [])] } as Plan
const view = deckView(plan, 'c1', true)
const states = nodeStates(plan)
const TODAY = '2026-01-01'

describe('useDeckViews', () => {
  it('keeps the same views (same reference) across zoom steps that list as many members', () => {
    const count = view.decks.get('deck:goal')!.members.length
    // two zoom steps past the label clamp (cards drawn larger than their slots) that list as many members
    const steps = Array.from({ length: 100 }, (_, i) => 1 + (i + 1) / 50)
    const a = steps.find((s, i) => i + 1 < steps.length && deckListed(count, 6, s) === deckListed(count, 6, steps[i + 1]))!
    const b = a + 1 / 50
    expect(deckListed(count, 6, a)).toBe(deckListed(count, 6, b))
    const { result, rerender } = renderHook(({ scale }) => useDeckViews(plan, view, TODAY, states, 'c1', scale), { initialProps: { scale: a } })
    const first = result.current
    rerender({ scale: b })
    expect(result.current).toBe(first)
  })

  it('makes new views when a zoom step changes how many members a deck lists', () => {
    const count = view.decks.get('deck:goal')!.members.length
    // an undated deck: counted at its own size (date scale 1)
    const far = [1.5, 2, 3, 4].find(s => deckListed(count, 6, s, 1) !== deckListed(count, 6, 1, 1))!
    const { result, rerender } = renderHook(({ scale }) => useDeckViews(plan, view, TODAY, states, 'c1', scale), { initialProps: { scale: 1 } })
    const first = result.current
    rerender({ scale: far })
    expect(result.current).not.toBe(first)
    expect(result.current.get('deck:goal')!.deck!.ids).toHaveLength(deckListed(count, 6, far, 1))
  })

  it("draws a done deck as part of the selection's chain (not dim), in the done state, and a branch deck dim", () => {
    const done = (id: string) => ({ ...step(id, []), status: 'done' as const })
    const p = { name: 'Done', nodes: [step('goal', ['sel', 'b']), step('sel', ['n', 'd1', 'd2']), step('n', []), done('d1'), done('d2'), step('b', ['b1', 'b2']), step('b1', []), step('b2', [])] } as Plan
    const v = deckView(p, 'sel', true)
    const { result } = renderHook(() => useDeckViews(p, v, TODAY, nodeStates(p), 'sel', 1))
    expect(result.current.get('deck:sel')).toMatchObject({ dim: false, chain: 'up', state: 'done', status: 'done', title: '2 steps' })
    expect(result.current.get('deck:sel')!.deck).toMatchObject({ ids: ['d1', 'd2'], count: 2, more: 0 })
    expect(result.current.get('deck:goal')).toMatchObject({ dim: true, chain: '' })
  })

  it("draws a finished other goal's done deck off the chain dim, like its goal", () => {
    const done = (id: string, deps: string[] = []) => ({ ...step(id, deps), status: 'done' as const })
    const p = { name: 'Two', nodes: [step('A', ['sel']), step('sel', ['d1', 'd2']), done('d1'), done('d2'), done('D', ['e1', 'e2']), done('e1'), done('e2')] } as Plan
    const v = deckView(p, 'sel', true)
    const { result } = renderHook(() => useDeckViews(p, v, TODAY, nodeStates(p), 'sel', 1))
    expect(result.current.get('deck:sel')).toMatchObject({ dim: false, chain: 'up' })
    expect(result.current.get('deck:D')).toMatchObject({ dim: true, chain: '', state: 'done' })
  })

  it("lists each shown member's stored priority beside its title, normal where it has none", () => {
    const p = { name: 'P', nodes: [step('goal', ['a', 'b']), step('a', ['a1', 'a2', 'a3']), { ...step('a1', []), priority: 'high' }, step('a2', []), { ...step('a3', []), priority: 'low' }, step('b', [])] } as Plan
    const v = deckView(p, null, true)
    const { result } = renderHook(() => useDeckViews(p, v, TODAY, nodeStates(p), null, 1))
    expect(result.current.get('deck:a')!.deck).toMatchObject({ ids: ['a1', 'a2', 'a3'], priorities: ['high', 'normal', 'low'] })
    expect(result.current.get('deck:a')!.priority).toBe('high')
  })

  it('says which shown members are done', () => {
    const p = { name: 'P', nodes: [step('goal', ['a', 'b']), step('a', ['a1', 'a2']), { ...step('a1', []), status: 'done' }, step('a2', []), step('b', [])] } as Plan
    const v = deckView(p, null, true)
    const { result } = renderHook(() => useDeckViews(p, v, TODAY, nodeStates(p), null, 1))
    expect(result.current.get('deck:a')!.deck).toMatchObject({ ids: ['a1', 'a2'], done: [true, false] })
  })

  it('is an empty map, the same one at every scale, with Group off', () => {
    const flat = deckView(plan, 'c1', false)
    const { result, rerender } = renderHook(({ scale }) => useDeckViews(plan, flat, TODAY, states, 'c1', scale), { initialProps: { scale: 1 } })
    const first = result.current
    expect(first.size).toBe(0)
    rerender({ scale: 3 })
    expect(result.current).toBe(first)
  })
})
