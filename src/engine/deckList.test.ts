import { describe, expect, it } from 'vitest'
import { freeArea, placeDeckList, rowsOf } from './deckList.js'
import { nodeStates } from './readiness.js'
import type { Plan, PlanNode } from './schema.js'

const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom })

describe('freeArea', () => {
  it('is the window less a margin, below the toolbar, left of a tall side panel and above the bottom card', () => {
    expect(freeArea({ w: 1280, h: 720 }, {})).toEqual(box(8, 8, 1272, 712))
    expect(freeArea({ w: 1280, h: 720 }, { toolbar: box(16, 16, 600, 60), panel: box(864, 64, 1264, 704), hud: box(300, 560, 800, 704) })).toEqual(box(8, 68, 856, 552))
  })

  it('treats a collapsed side panel (a short bar at the top right) as part of the top strip, not the whole right side', () => {
    expect(freeArea({ w: 1280, h: 720 }, { toolbar: box(16, 16, 600, 60), panel: box(864, 64, 1264, 110) })).toEqual(box(8, 118, 1272, 712))
  })
})

describe('placeDeckList', () => {
  const free = box(8, 68, 1272, 712)
  const anchor = { dot: box(400, 300, 422, 322), text: box(440, 280, 580, 360) }

  it('sits right of the deck, its top level with the circle, as tall as its rows need', () => {
    expect(placeDeckList(anchor, { w: 300, h: 200 }, free)).toEqual({ left: 588, top: 288, width: 300, maxHeight: 440 })
  })

  it('goes left of the deck when the right has no room, and is moved inside the free area when neither side has', () => {
    const right = { dot: box(1100, 300, 1122, 322), text: box(1140, 280, 1270, 360) }
    expect(placeDeckList(right, { w: 300, h: 200 }, free).left).toBe(1100 - 8 - 300)
    const narrow = box(8, 68, 400, 712)
    const mid = { dot: box(150, 300, 172, 322), text: box(190, 280, 330, 360) }
    const p = placeDeckList(mid, { w: 300, h: 200 }, narrow)
    expect(p.left).toBeGreaterThanOrEqual(8)
    expect(p.left + p.width).toBeLessThanOrEqual(400)
  })

  it('never runs past the bottom of the free area, nor above its top, and never taller than it', () => {
    const low = { dot: box(400, 690, 422, 712), text: box(440, 670, 580, 730) }
    const p = placeDeckList(low, { w: 300, h: 300 }, free)
    expect(p.top + Math.min(300, p.maxHeight)).toBeLessThanOrEqual(712)
    const high = { dot: box(400, 10, 422, 32), text: box(440, 0, 580, 50) }
    expect(placeDeckList(high, { w: 300, h: 100 }, free).top).toBe(68)
    const short = box(8, 68, 1272, 268)
    expect(placeDeckList(anchor, { w: 300, h: 900 }, short)).toMatchObject({ top: 68, maxHeight: 200 })
  })

  it('ends above the legend in the bottom-left corner when it would reach across it, and not when it is clear of it', () => {
    const legend = box(16, 450, 236, 656)
    const low = { dot: box(150, 400, 172, 422), text: box(190, 380, 330, 460) }
    const narrow = box(8, 68, 440, 712)
    const p = placeDeckList(low, { w: 300, h: 600 }, narrow, [legend])
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(450 - 8)
    const clear = placeDeckList(anchor, { w: 300, h: 600 }, free, [legend])
    expect(clear).toEqual(placeDeckList(anchor, { w: 300, h: 600 }, free))
  })

  it('is no wider than the free area', () => {
    expect(placeDeckList(anchor, { w: 300, h: 100 }, box(8, 68, 208, 712)).width).toBe(200)
  })
})

describe('rowsOf', () => {
  const node = (id: string, depends_on: string[] = [], extra: Partial<PlanNode> = {}): PlanNode => ({ id, title: `Step ${id}`, description: '', status: 'todo', tags: [], depends_on, ...extra })

  it('lists every member with its state and date, what can be started now first, then plan order', () => {
    const members = [node('w', ['x']), node('d', [], { status: 'done' }), node('r', [], { due: '2026-10-10' }), node('b', [], { status: 'blocked' }), node('r2')]
    const plan: Plan = { name: 'p', nodes: [node('goal', members.map(m => m.id), { due: '2026-11-01' }), ...members, node('x', [], { status: 'doing' })] }
    const rows = rowsOf(members, nodeStates(plan), plan, '2026-10-04')
    expect(rows.map(r => [r.id, r.state])).toEqual([
      ['r', 'ready'],
      ['r2', 'ready'],
      ['b', 'blocked'],
      ['w', 'waiting'],
      ['d', 'done'],
    ])
    expect(rows[0]).toMatchObject({ title: 'Step r', due: { date: '2026-10-10' } })
    // a member without a date of its own shows the one it inherits
    expect(rows[1].due).toMatchObject({ date: '2026-11-01', inherited: true })
    // a row says its date as the graph does, the short date only ("by" before an inherited one); how near it is goes
    // in its spoken name, which says the date in full as the graph's label does
    expect(rows[0].dateText).toBe('Oct 10')
    expect(rows[1].dateText).toBe('by Nov 1')
    expect(rows[0].due?.text).toBe('Oct 10 · in 6 days')
    expect(rows.find(r => r.id === 'd')!.dateText).toBeNull()
  })

  it("carries each member's stored priority, normal where it has none; the order does not change for it", () => {
    const members = [node('a'), node('b', [], { priority: 'high' }), node('c', [], { priority: 'low' })]
    const p: Plan = { name: 'p', nodes: members }
    expect(rowsOf(members, nodeStates(p), p, '2026-10-04').map(r => [r.id, r.priority])).toEqual([
      ['a', 'normal'],
      ['b', 'high'],
      ['c', 'low'],
    ])
  })

  it('gives the year of a date in another year', () => {
    const p: Plan = { name: 'p', nodes: [node('a', [], { due: '2027-01-15' })] }
    expect(rowsOf(p.nodes, nodeStates(p), p, '2026-10-04')[0].dateText).toBe('Jan 15, 2027')
  })
})
