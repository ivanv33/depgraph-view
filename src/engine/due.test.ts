import { describe, expect, it } from 'vitest'
import { HAZE, INHERIT_DAMP, NEAR, NEAR_MAX, NEAR_TEXT_DAYS, SIZE, daysUntil, dueLabel, dueText, dueView, dueViewOf, effectiveDue, hazeOf, inheritDamping, inheritHint, inheritedScale, inheritedSize, localDate, nearScale, radius, shortDate, strength } from './due.js'
import type { Plan, PlanNode } from './schema.js'

describe('localDate', () => {
  it('is the local calendar date, zero padded', () => {
    expect(localDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
    expect(localDate(new Date(2026, 11, 31, 0, 0))).toBe('2026-12-31')
  })
})

describe('daysUntil', () => {
  it('counts whole calendar days', () => {
    expect(daysUntil('2026-10-11', '2026-10-04')).toBe(7)
    expect(daysUntil('2026-10-04', '2026-10-04')).toBe(0)
    expect(daysUntil('2026-10-03', '2026-10-04')).toBe(-1)
  })
  it('crosses DST changes and year ends', () => {
    expect(daysUntil('2026-03-30', '2026-03-01')).toBe(29)
    expect(daysUntil('2026-11-02', '2026-10-30')).toBe(3)
    expect(daysUntil('2027-01-01', '2026-12-31')).toBe(1)
    expect(daysUntil('2028-03-01', '2028-02-28')).toBe(2)
    expect(daysUntil('2027-10-04', '2026-10-04')).toBe(365)
  })
})

describe('dueText', () => {
  it.each([
    [0, 'today'],
    [1, 'tomorrow'],
    [2, 'in 2 days'],
    [13, 'in 13 days'],
    [14, 'in 2 weeks'],
    [55, 'in 7 weeks'],
    [56, 'in 1 month'],
    [364, 'in 12 months'],
    [365, 'in 1 year'],
    [730, 'in 2 years'],
    [-1, '1 day late'],
    [-2, '2 days late'],
    [-13, '13 days late'],
    [-14, '2 weeks late'],
    [-56, '1 month late'],
    [-365, '1 year late'],
  ])('%i -> %s', (days, text) => {
    expect(dueText(days)).toBe(text)
  })
})

describe('strength', () => {
  it('is 1 up to a week out and for everything overdue', () => {
    expect(strength(7)).toBe(1)
    expect(strength(0)).toBe(1)
    expect(strength(-400)).toBe(1)
  })
  it('is the floor from 180 days out', () => {
    expect(strength(180)).toBe(HAZE.floor)
    expect(strength(5000)).toBe(HAZE.floor)
  })
  it('is linear in between', () => {
    expect(strength(93.5)).toBeCloseTo(0.7)
    expect(strength(8)).toBeLessThan(1)
    expect(strength(179)).toBeGreaterThan(0.4)
  })
})

describe('radius', () => {
  it('is the largest up to a week out and for everything overdue', () => {
    expect(radius(-30)).toBe(16)
    expect(radius(0)).toBe(16)
    expect(radius(7)).toBe(16)
  })
  it('is the smallest from 180 days out', () => {
    expect(radius(180)).toBe(7)
    expect(radius(5000)).toBe(7)
  })
  it('is linear in between and never outside the range', () => {
    expect(radius(93.5)).toBeCloseTo(11.5)
    for (const d of [-1000, 8, 50, 179, 1e6]) {
      expect(radius(d)).toBeGreaterThanOrEqual(SIZE.far)
      expect(radius(d)).toBeLessThanOrEqual(SIZE.near)
    }
  })
})

describe('nearScale', () => {
  it('is 1.3 up to a week out and for everything overdue', () => {
    expect(nearScale(-30)).toBe(1.3)
    expect(nearScale(0)).toBe(NEAR.near)
    expect(nearScale(HAZE.nearDays)).toBe(1.3)
  })
  it('is 0.85 from 180 days out', () => {
    expect(nearScale(180)).toBe(0.85)
    expect(nearScale(5000)).toBe(NEAR.far)
  })
  it('is linear in between and never outside the range', () => {
    expect(nearScale(93.5)).toBeCloseTo(1.075, 9)
    for (const d of [-1000, 8, 50, 179, 1e6]) {
      expect(nearScale(d)).toBeGreaterThanOrEqual(NEAR.far)
      expect(nearScale(d)).toBeLessThanOrEqual(NEAR.near)
    }
  })
})

describe('dueView', () => {
  const today = '2026-10-04'
  it('is null without a date or when done', () => {
    expect(dueView({ status: 'todo' }, today)).toBeNull()
    expect(dueView({ due: '2026-01-01', status: 'done' }, today)).toBeNull()
  })
  it('describes a dated node', () => {
    expect(dueView({ due: '2026-10-05', status: 'todo' }, today)).toEqual({ date: '2026-10-05', text: 'Oct 5 · tomorrow', strength: 1, overdue: false, radius: 16, scale: 1.3 })
    expect(dueView({ due: '2026-10-03', status: 'doing' }, today)).toEqual({ date: '2026-10-03', text: 'Oct 3 · 1 day late', strength: 1, overdue: true, radius: 16, scale: 1.3 })
    expect(dueView({ due: '2099-01-01', status: 'blocked' }, today)).toMatchObject({ text: 'Jan 1, 2099', strength: 0.4, overdue: false, radius: 7, scale: 0.85 })
  })
})

describe('hazeOf', () => {
  const far = { date: '2099-01-01', text: 'Jan 1, 2099', strength: 0.4, overdue: false, radius: 7, scale: 0.85 }
  it('is the strength, or 1 when undated or focused (selected / on the chain)', () => {
    expect(hazeOf(far, false)).toBe(0.4)
    expect(hazeOf(far, true)).toBe(1)
    expect(hazeOf(null, false)).toBe(1)
  })
})

const node = (id: string, depends_on: string[] = [], extra: Partial<PlanNode> = {}): PlanNode => ({
  id,
  title: `Title ${id}`,
  description: '',
  status: 'todo',
  tags: [],
  depends_on,
  ...extra,
})
const planOf = (...nodes: PlanNode[]): Plan => ({ name: 'p', nodes })

describe('effectiveDue', () => {
  it('keeps an explicit date, even when what needs the step is due sooner', () => {
    const e = effectiveDue(planOf(node('goal', ['a'], { due: '2026-11-01' }), node('a', [], { due: '2026-12-01' })))
    expect(e.get('a')).toEqual({ date: '2026-12-01', inherited: false, from: null, depth: 0 })
    expect(e.get('goal')).toEqual({ date: '2026-11-01', inherited: false, from: null, depth: 0 })
  })
  it('inherits from the single step that needs it', () => {
    const e = effectiveDue(planOf(node('goal', ['a'], { due: '2026-11-01' }), node('a')))
    expect(e.get('a')).toEqual({ date: '2026-11-01', inherited: true, from: 'goal', depth: 1 })
  })
  it('takes the earliest of two dependents', () => {
    const e = effectiveDue(planOf(node('x', ['a'], { due: '2026-12-01' }), node('y', ['a'], { due: '2026-11-15' }), node('a')))
    expect(e.get('a')).toEqual({ date: '2026-11-15', inherited: true, from: 'y', depth: 1 })
  })
  it('passes through an undated middle step, two levels deep', () => {
    const e = effectiveDue(planOf(node('goal', ['mid'], { due: '2026-11-01' }), node('mid', ['leaf']), node('leaf')))
    expect(e.get('mid')).toMatchObject({ inherited: true, from: 'goal', depth: 1 })
    expect(e.get('leaf')).toEqual({ date: '2026-11-01', inherited: true, from: 'goal', depth: 2 })
  })
  it('takes the shortest path when several give the same date', () => {
    const e = effectiveDue(planOf(node('goal', ['mid', 'leaf'], { due: '2026-11-01' }), node('mid', ['leaf']), node('leaf')))
    expect(e.get('leaf')).toMatchObject({ from: 'goal', depth: 1 })
  })
  it('has nothing for a step when nothing above it is dated', () => {
    const e = effectiveDue(planOf(node('goal', ['a']), node('a')))
    expect(e.has('a')).toBe(false)
    expect(e.has('goal')).toBe(false)
  })
  it("passes a done dependent's date down", () => {
    const e = effectiveDue(planOf(node('goal', ['a'], { due: '2026-11-01', status: 'done' }), node('a')))
    expect(e.get('a')).toMatchObject({ date: '2026-11-01', inherited: true })
  })
  it('is memoised per plan object and survives a cycle', () => {
    const p = planOf(node('a', ['b'], { due: '2026-11-01' }), node('b', ['c']), node('c', ['b']))
    const e = effectiveDue(p)
    expect(effectiveDue(p)).toBe(e)
    expect(e.get('b')).toMatchObject({ date: '2026-11-01', depth: 1 })
    expect(e.get('c')).toMatchObject({ date: '2026-11-01', depth: 2 })
  })
  it('never changes the plan', () => {
    const p = planOf(node('goal', ['a'], { due: '2026-11-01' }), node('a'))
    const before = JSON.stringify(p)
    effectiveDue(p)
    expect(JSON.stringify(p)).toBe(before)
    expect(p.nodes[1]).not.toHaveProperty('due')
  })
})

describe('inheritedScale', () => {
  it('adds a little per level on top of nearScale', () => {
    expect(inheritedScale(100, 1)).toBeCloseTo(nearScale(100) + 0.025)
    expect(inheritedScale(100, 2)).toBeCloseTo(nearScale(100) + 0.05)
  })
  it('caps the extra at four levels and the total at NEAR.near + 0.1', () => {
    expect(inheritedScale(100, 9)).toBeCloseTo(nearScale(100) + 0.1)
    expect(inheritedScale(0, 1)).toBeCloseTo(NEAR.near + 0.025)
    expect(inheritedScale(0, 9)).toBeCloseTo(NEAR.near + 0.1)
    expect(NEAR_MAX).toBeCloseTo(NEAR.near + 0.1)
  })
})

describe('inheritDamping', () => {
  it('keeps the whole boost while a handful of steps share an inherited date', () => {
    for (let share = 1; share <= INHERIT_DAMP.few; share++) expect(inheritDamping(share)).toBe(1)
  })
  it('gives less the more steps share it, and none from INHERIT_DAMP.crowd on', () => {
    const fs = Array.from({ length: INHERIT_DAMP.crowd + 3 }, (_, i) => inheritDamping(i + 1))
    for (let i = 1; i < fs.length; i++) expect(fs[i]).toBeLessThanOrEqual(fs[i - 1])
    expect(inheritDamping(INHERIT_DAMP.few + 1)).toBeLessThan(1)
    expect(inheritDamping(INHERIT_DAMP.few + 1)).toBeGreaterThan(0)
    expect(inheritDamping(INHERIT_DAMP.crowd)).toBe(0)
    expect(inheritDamping(24)).toBe(0)
  })
})

describe('inheritedSize', () => {
  it('is exactly inheritedScale and the date radius while few steps share the date (the owner\'s order: a prerequisite a little nearer)', () => {
    // the sizes base 46e5c7d drew, as literals: due in 3 days one and two levels down, 300 days one level down
    expect(inheritedSize(3, 1, 1)).toEqual({ scale: 1.325, radius: 16 })
    expect(inheritedSize(3, 2, 2)).toEqual({ scale: 1.35, radius: 16 })
    expect(inheritedSize(3, 4, INHERIT_DAMP.few).scale).toBeCloseTo(1.4, 10)
    expect(inheritedSize(300, 1, INHERIT_DAMP.few)).toEqual({ scale: 0.875, radius: 7 })
  })
  it('fades in gently: five sharers lose far less than an eighth of the boost, and the fade is never steeper than a quarter per step', () => {
    expect(inheritDamping(INHERIT_DAMP.few + 1)).toBeGreaterThan(0.95)
    for (let s = INHERIT_DAMP.few; s < INHERIT_DAMP.crowd; s++) expect(inheritDamping(s) - inheritDamping(s + 1)).toBeLessThanOrEqual(0.25)
    expect(inheritDamping(8)).toBeCloseTo(0.5, 10)
  })
  it('is an undated step\'s size once the date is shared by a crowd', () => {
    expect(inheritedSize(3, 1, 24)).toEqual({ scale: 1, radius: SIZE.normal })
    expect(inheritedSize(300, 3, 39)).toEqual({ scale: 1, radius: SIZE.normal })
  })
  it('in between, a near date still draws larger than undated, a far one smaller, by part of the boost', () => {
    const share = Math.round((INHERIT_DAMP.few + INHERIT_DAMP.crowd) / 2)
    const near = inheritedSize(3, 1, share)
    expect(near.scale).toBeGreaterThan(1)
    expect(near.scale).toBeLessThan(inheritedScale(3, 1))
    expect(near.radius).toBeGreaterThan(SIZE.normal)
    expect(near.radius).toBeLessThan(radius(3))
    const far = inheritedSize(300, 1, share)
    expect(far.scale).toBeLessThan(1)
    expect(far.scale).toBeGreaterThan(inheritedScale(300, 1))
  })
  it('never draws a step smaller than a shallower one inheriting the same date (the prerequisite comes first)', () => {
    for (const days of [-5, 0, 3, 7, 40, 100, 179, 400])
      for (let share = 1; share <= 30; share++)
        for (let depth = 1; depth < 7; depth++) {
          const up = inheritedSize(days, depth, share)
          const down = inheritedSize(days, depth + 1, share)
          expect(down.scale, `${days}d share ${share} depth ${depth}`).toBeGreaterThanOrEqual(up.scale)
          expect(down.radius).toBeGreaterThanOrEqual(up.radius)
        }
  })
})

describe('shortDate', () => {
  it('is month and day, with the year only when it is not this year', () => {
    expect(shortDate('2026-11-01', '2026-10-05')).toBe('Nov 1')
    expect(shortDate('2027-01-15', '2026-10-05')).toBe('Jan 15, 2027')
  })
})

describe('dueLabel', () => {
  const today = '2026-10-05'
  it('is the short calendar date alone by default, with the year only when it is not this year', () => {
    expect(dueLabel('2026-11-14', today)).toBe('Nov 14')
    expect(dueLabel('2027-11-14', today)).toBe('Nov 14, 2027')
    expect(dueLabel('2026-10-05', today)).toBe('Oct 5')
    expect(dueLabel('2026-10-01', today)).toBe('Oct 1')
  })
  it('reads "by <date>" for an inherited date', () => {
    expect(dueLabel('2026-11-14', today, { inherited: true })).toBe('by Nov 14')
    expect(dueLabel('2027-01-15', today, { inherited: true })).toBe('by Jan 15, 2027')
  })
  it('with nearness, adds how near after the date only when it is within NEAR_TEXT_DAYS or past', () => {
    expect(NEAR_TEXT_DAYS).toBe(14)
    const near = (date: string, inherited = false) => dueLabel(date, today, { inherited, nearness: true })
    expect(near('2026-10-05')).toBe('Oct 5 · today')
    expect(near('2026-10-06')).toBe('Oct 6 · tomorrow')
    expect(near('2026-10-08')).toBe('Oct 8 · in 3 days')
    expect(near('2026-10-19')).toBe('Oct 19 · in 2 weeks')
    expect(near('2026-10-20')).toBe('Oct 20')
    expect(near('2026-11-14')).toBe('Nov 14')
    expect(near('2026-10-03')).toBe('Oct 3 · 2 days late')
    expect(near('2026-08-01')).toBe('Aug 1 · 2 months late')
    expect(near('2027-11-14')).toBe('Nov 14, 2027')
    expect(near('2026-10-08', true)).toBe('by Oct 8 · in 3 days')
    expect(near('2026-10-03', true)).toBe('by Oct 3 · 2 days late')
    expect(near('2026-11-14', true)).toBe('by Nov 14')
  })
  it('keeps the year where the date is in another year, even when near', () => {
    expect(dueLabel('2027-01-02', '2026-12-30', { nearness: true })).toBe('Jan 2, 2027 · in 3 days')
    expect(dueLabel('2026-12-30', '2027-01-02', { nearness: true })).toBe('Dec 30, 2026 · 3 days late')
  })
})

describe('dueViewOf', () => {
  const today = '2026-10-04'
  const p = planOf(node('goal', ['mid'], { due: '2026-11-01' }), node('mid', ['leaf']), node('leaf'), node('lone'))

  it('is the plain view for an explicit date', () => {
    expect(dueViewOf(p, p.nodes[0], today)).toEqual(dueView(p.nodes[0], today))
  })
  it('reads "by <date>" for an inherited one, names where it comes from, and is a little larger per level', () => {
    const goal = dueViewOf(p, p.nodes[0], today)!
    const mid = dueViewOf(p, p.nodes[1], today)!
    const leaf = dueViewOf(p, p.nodes[2], today)!
    expect(mid).toMatchObject({ date: '2026-11-01', text: 'by Nov 1', inherited: true, from: 'Title goal', overdue: false })
    expect(mid.scale).toBeCloseTo(goal.scale + 0.025)
    expect(leaf.scale).toBeCloseTo(goal.scale + 0.05)
    expect(mid.strength).toBe(goal.strength)
    expect(mid.radius).toBe(goal.radius)
  })
  it('damps the size of a date shared by many steps, never their text, and leaves an own date as it was', () => {
    const many = Array.from({ length: 24 }, (_, i) => node(`s${i}`, i < 23 ? [`s${i + 1}`] : []))
    const crowd = planOf(node('goal', ['s0'], { due: '2026-10-07' }), ...many, node('own', [], { due: '2027-06-01' }))
    crowd.nodes[24] = { ...crowd.nodes[24], depends_on: ['own'] }
    const goal = dueViewOf(crowd, crowd.nodes[0], today)!
    expect(goal).toEqual(dueView(crowd.nodes[0], today))
    const first = dueViewOf(crowd, crowd.nodes[1], today)!
    expect(first).toMatchObject({ text: 'by Oct 7 · in 3 days', inherited: true, strength: goal.strength, scale: 1, radius: SIZE.normal })
    // an own far date under the near goal keeps its own size
    const own = crowd.nodes.find(n => n.id === 'own')!
    expect(dueViewOf(crowd, own, today)).toEqual(dueView(own, today))
    expect(dueViewOf(crowd, own, today)!.scale).toBeLessThan(1)
  })
  it('counts the steps sharing a date per step it comes from: a few under one, many under another', () => {
    const q = planOf(
      node('a', ['a1'], { due: '2026-10-07' }),
      node('a1'),
      node('b', Array.from({ length: 20 }, (_, i) => `b${i}`), { due: '2026-10-07' }),
      ...Array.from({ length: 20 }, (_, i) => node(`b${i}`)),
    )
    expect(dueViewOf(q, q.nodes[1], today)!.scale).toBeCloseTo(inheritedScale(3, 1))
    expect(dueViewOf(q, q.nodes[3], today)!.scale).toBe(1)
  })
  it('counts only the steps drawn with the date: done ones do not damp the live ones, held ones do', () => {
    const live = Array.from({ length: 4 }, (_, i) => node(`l${i}`))
    const done = Array.from({ length: 8 }, (_, i) => node(`d${i}`, [], { status: 'done' }))
    const q = planOf(node('goal', [...live, ...done].map(n => n.id), { due: '2026-10-07' }), ...live, ...done)
    for (const n of live) expect(dueViewOf(q, n, today)).toMatchObject({ scale: 1.325, radius: 16 })
    const held = planOf(...q.nodes.map(n => (n.status === 'done' ? { ...n, status: 'todo' as const, hold: 'waiting on a reply' } : n)))
    expect(dueViewOf(held, held.nodes[1], today)!.scale).toBe(1)
  })
  it('damps an overdue inherited date the same way, its text and overdue mark as before', () => {
    const kids = Array.from({ length: 8 }, (_, i) => node(`k${i}`))
    const q = planOf(node('goal', kids.map(k => k.id), { due: '2026-10-02' }), ...kids)
    const views = kids.map(k => dueViewOf(q, k, today)!)
    for (const v of views) {
      expect(v).toMatchObject({ text: 'by Oct 2 · 2 days late', overdue: true, strength: 1, inherited: true })
      expect(v.scale).toBeCloseTo(1 + 0.325 * inheritDamping(8), 10)
      expect(v.radius).toBeCloseTo(SIZE.normal + (16 - SIZE.normal) * inheritDamping(8), 10)
    }
    expect(views[0].scale).toBeGreaterThan(1)
    expect(views[0].scale).toBeLessThan(1.325)
  })
  it('is null for an undated step with nothing above it dated, and for a done step', () => {
    expect(dueViewOf(p, p.nodes[3], today)).toBeNull()
    expect(dueViewOf(p, { ...p.nodes[1], status: 'done' }, today)).toBeNull()
  })
})

describe('inheritHint', () => {
  const p = planOf(node('goal', ['mid'], { due: '2026-11-01' }), node('mid', ['leaf']), node('leaf'), node('lone'))
  it('names the date and the step it comes from', () => {
    expect(inheritHint(p, 'leaf')).toEqual({ date: '2026-11-01', fromId: 'goal', fromTitle: 'Title goal' })
    expect(inheritHint(p, 'mid')).toEqual({ date: '2026-11-01', fromId: 'goal', fromTitle: 'Title goal' })
  })
  it('is null for a step with its own date, with nothing to inherit, or unknown', () => {
    expect(inheritHint(p, 'goal')).toBeNull()
    expect(inheritHint(p, 'lone')).toBeNull()
    expect(inheritHint(p, 'nope')).toBeNull()
  })
  it('follows the plan: setting a date makes it explicit, and its prerequisites inherit that one', () => {
    const set = planOf(...p.nodes.map(x => (x.id === 'mid' ? { ...x, due: '2026-10-20' } : x)))
    expect(inheritHint(set, 'mid')).toBeNull()
    expect(inheritHint(set, 'leaf')).toEqual({ date: '2026-10-20', fromId: 'mid', fromTitle: 'Title mid' })
  })
})
