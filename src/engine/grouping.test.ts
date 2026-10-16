import { describe, expect, it } from 'vitest'
import type { Plan, PlanNode } from './schema.js'
import { chainOf } from './chain.js'
import { nodeStates } from './readiness.js'
import { DECK_LIST_MAX, DECK_PREFIX, deckLabel, deckParent, deckView, openSet } from './grouping.js'
import { CROSS_AREAS, CROSS_GOAL, crossLinkedPlan } from './fixtures/crossLinked.js'
import { drawnLayout } from './drawnLayout.js'

const node = (id: string, depends_on: string[] = [], extra: Partial<PlanNode> = {}): PlanNode => ({
  id,
  title: id,
  description: '',
  status: 'todo',
  tags: [],
  depends_on,
  ...extra,
})
const planOf = (...nodes: PlanNode[]): Plan => ({ name: 'p', nodes })

// A is the goal: A -> B, C; B -> D, E; C -> F; D -> G.
const tree = () => planOf(node('A', ['B', 'C']), node('B', ['D', 'E']), node('C', ['F']), node('D', ['G']), node('E'), node('F'), node('G'))
const ids = (s: Iterable<{ id: string }>) => [...s].map(n => n.id)

describe('openSet', () => {
  it('opens the roots and their children when nothing is selected', () => {
    expect([...openSet(tree(), null)].sort()).toEqual(['A', 'B', 'C'])
  })

  it('opens the path to the selection and its whole subtree', () => {
    expect([...openSet(tree(), 'D')].sort()).toEqual(['A', 'B', 'D', 'G'])
    expect([...openSet(tree(), 'B')].sort()).toEqual(['A', 'B', 'D', 'E', 'G'])
  })

  it('opens every path to the selection, and an unconnected root', () => {
    const p = planOf(node('top1', ['mid']), node('top2', ['mid']), node('mid', ['leaf', 'other']), node('leaf'), node('other'), node('lone'))
    expect([...openSet(p, 'mid')].sort()).toEqual(['leaf', 'lone', 'mid', 'other', 'top1', 'top2'])
    expect(openSet(p, null).has('lone')).toBe(true)
  })

  it('with a selection, opens every other root too, but none of its needs', () => {
    const p = planOf(node('A', ['a1']), node('a1'), node('B', ['b1']), node('b1'))
    expect([...openSet(p, 'a1')].sort()).toEqual(['A', 'B', 'a1'])
  })

  it('with a single root, opens what it always did for every selection', () => {
    // the one root is on the path up from every step, so opening the roots adds nothing
    const p = tree()
    for (const n of p.nodes) expect(openSet(p, n.id).has('A')).toBe(true)
  })

  it('with nothing selected, keeps opening down a single column until a node has two or more children', () => {
    // root -> a -> b -> {c, d, e}; c and d have branches of their own
    const p = planOf(node('root', ['a']), node('a', ['b']), node('b', ['c', 'd', 'e']), node('c', ['c1', 'c2']), node('d', ['d1']), node('e'), node('c1'), node('c2'), node('d1', ['d2']), node('d2'))
    expect([...openSet(p, null)].sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'root'])
  })

  it('opens a single column all the way down to its leaf', () => {
    const p = planOf(node('root', ['a']), node('a', ['b']), node('b', ['c']), node('c'))
    expect([...openSet(p, null)].sort()).toEqual(['a', 'b', 'c', 'root'])
  })

  it('stops as soon as two open nodes have closed children', () => {
    const p = planOf(node('root', ['a', 'b']), node('a', ['a1']), node('b', ['b1']), node('a1', ['a2']), node('b1'), node('a2'))
    expect([...openSet(p, null)].sort()).toEqual(['a', 'b', 'root'])
  })

  it('stops at the first node with two or more children, even when only one of them goes on', () => {
    // root -> a -> {leaf, y}; y heads a 30-step chain that stays folded
    const chain = Array.from({ length: 30 }, (_, i) => node(`y${i}`, i < 29 ? [`y${i + 1}`] : []))
    const p = planOf(node('root', ['a']), node('a', ['leaf', 'y']), node('leaf'), node('y', ['y0']), ...chain)
    expect([...openSet(p, null)].sort()).toEqual(['a', 'leaf', 'root', 'y'])
  })

  it('treats an unknown selection as none', () => {
    expect([...openSet(tree(), 'nope')].sort()).toEqual(['A', 'B', 'C'])
  })
})

describe('deckView elsewhere', () => {
  it('lists, for a drawn step, the needs it has that are not drawn under it', () => {
    // s is in x's deck; y needs s too, but that need is not drawn: y would look like a leaf
    const p = planOf(node('goal', ['x', 'y']), node('x', ['s']), node('y', ['s']), node('s', ['t']), node('t'))
    const v = deckView(p, null, true)
    expect(v.elsewhere.get('y')).toEqual(['s'])
    expect([...v.elsewhere.keys()]).toEqual(['y'])
  })

  it("counts only the needs left out, when some of a step's needs are drawn", () => {
    // b needs d (in a's deck) and e (its own, drawn as a deck of one)
    const p = planOf(node('goal', ['a', 'b']), node('a', ['m', 'd']), node('m'), node('b', ['d', 'e']), node('d'), node('e'))
    const v = deckView(p, null, true)
    expect(ids(v.decks.get('deck:a')!.members)).toEqual(['m', 'd'])
    expect(v.nodes.find(n => n.id === 'b')!.depends_on).toEqual(['e'])
    expect(v.elsewhere.get('b')).toEqual(['d'])
  })

  it('also lists them for a step drawn as a deck of one', () => {
    // c is the only step of b's deck, drawn as itself; its need s is in a's deck
    const p = planOf(node('goal', ['a', 'b']), node('a', ['s', 'k']), node('b', ['c']), node('c', ['s']), node('s'), node('k'))
    const v = deckView(p, null, true)
    expect(v.nodes.some(n => n.id === 'c')).toBe(true)
    expect(v.elsewhere.get('c')).toEqual(['s'])
  })

  it('never lists a need drawn as a done deck, nor anything with Group off', () => {
    const p = tree()
    for (const sel of [null, ...p.nodes.map(n => n.id)]) expect(deckView(p, sel, false).elsewhere.size).toBe(0)
    const done = planOf(node('A', ['B']), node('B', ['C', 'D']), node('C', [], { status: 'done' }), node('D', [], { status: 'done' }))
    const v = deckView(done, 'B', true)
    expect(v.decks.get('deck:B')?.done).toBe(true)
    expect(v.elsewhere.size).toBe(0)
  })

  it('counts a need on hold like any other need', () => {
    const p = planOf(node('goal', ['x', 'y']), node('x', ['s']), node('y', ['s']), node('s', [], { hold: 'Well understood.' }), node('t'))
    expect(deckView(p, null, true).elsewhere.get('y')).toEqual(['s'])
  })

  it('does not count a need that is drawn as a sibling of the step', () => {
    const p = planOf(node('goal', ['a', 'b']), node('a'), node('b', ['a']))
    expect(deckView(p, null, true).elsewhere.size).toBe(0)
  })

  it("does not count a need inside the selected step's own deck", () => {
    const p = planOf(node('A', ['B']), node('B', ['C', 'D']), node('C', [], { status: 'done' }), node('D', [], { status: 'done' }))
    expect(deckView(p, 'B', true).elsewhere.has('B')).toBe(false)
  })

  it('counts a need written twice once, as the drawn line is', () => {
    const p = planOf(node('goal', ['x', 'y']), node('x', ['s']), node('y', ['s', 's']), node('s', ['t']), node('t'))
    expect(deckView(p, null, true).elsewhere.get('y')).toEqual(['s'])
  })

  // A need that loops back to the step (a cycle) cannot occur: the plan schema rejects cycles (schema.ts, findCycle).

  it('on a cross-linked plan, lists exactly the needs of each drawn step that no drawn line stands for, never the selected step', () => {
    const byId = new Map(crossLinkedPlan.nodes.map(n => [n.id, n]))
    let some = 0
    for (const sel of [null, ...crossLinkedPlan.nodes.map(n => n.id)]) {
      const v = deckView(crossLinkedPlan, sel, true)
      const drawnIds = new Set(v.nodes.map(m => m.id))
      // a need is drawn when a line from the step lands on it, or on the deck it is in
      const drawnAs = (d: string) => (drawnIds.has(d) ? d : v.hidden.get(d)?.[0])
      for (const n of v.nodes) {
        const step = byId.get(n.id)
        const missing = step ? step.depends_on.filter(d => byId.has(d) && !n.depends_on.includes(drawnAs(d) ?? '')) : []
        expect(v.elsewhere.get(n.id) ?? [], `${sel} ${n.id}`).toEqual(missing)
        if (missing.length) some++
      }
      if (sel !== null) expect(v.elsewhere.has(sel)).toBe(false)
    }
    expect(some).toBeGreaterThan(0)
  })
})

describe('deckView', () => {
  it('folds the branches nobody is looking at into decks (nothing selected)', () => {
    const v = deckView(tree(), null, true)
    expect(v.nodes).toEqual([
      { id: 'A', depends_on: ['B', 'C'] },
      { id: 'B', depends_on: ['deck:B'] },
      { id: 'C', depends_on: ['F'] },
      { id: 'deck:B', depends_on: [] },
      { id: 'F', depends_on: [] },
    ])
    expect(ids(v.decks.get('deck:B')!.members)).toEqual(['D', 'E', 'G'])
    expect(v.decks.get('deck:B')!.parentId).toBe('B')
    expect(v.decks.has('deck:C')).toBe(false) // one member: drawn as F itself
    expect([...v.hidden]).toEqual([['D', ['deck:B']], ['E', ['deck:B']], ['G', ['deck:B']]])
  })

  it('opens the path and the subtree of the selection', () => {
    const v = deckView(tree(), 'D', true)
    expect(v.nodes.map(n => n.id)).toEqual(['A', 'B', 'deck:A', 'D', 'E', 'G'])
    expect(ids(v.decks.get('deck:A')!.members)).toEqual(['C', 'F'])
    expect(v.decks.has('deck:B')).toBe(false) // only E: drawn as E
    expect(v.nodes.find(n => n.id === 'A')!.depends_on).toEqual(['B', 'deck:A'])
    expect(v.nodes.find(n => n.id === 'B')!.depends_on).toEqual(['D', 'E'])
    const b = deckView(tree(), 'B', true)
    expect(b.nodes.map(n => n.id)).toEqual(['A', 'B', 'deck:A', 'D', 'E', 'G'])
    expect(ids(b.decks.get('deck:A')!.members)).toEqual(['C', 'F'])
  })

  it('draws every node and no decks when off', () => {
    const p = tree()
    const v = deckView(p, 'D', false)
    expect(v.nodes).toEqual(p.nodes.map(n => ({ id: n.id, depends_on: n.depends_on })))
    expect(v.decks.size).toBe(0)
    expect(v.hidden.size).toBe(0)
  })

  it('puts a step reachable from two open steps in one deck only, and draws no edge from the other step into that deck', () => {
    const p = planOf(node('goal', ['x', 'y']), node('x', ['s']), node('y', ['s']), node('s', ['t']), node('t'))
    const v = deckView(p, null, true)
    expect(ids(v.decks.get('deck:x')!.members)).toEqual(['s', 't'])
    expect(v.decks.has('deck:y')).toBe(false)
    expect(v.hidden.get('s')).toEqual(['deck:x'])
    // y's need crosses into x's deck: it is not drawn, so the deck hangs from x alone
    expect(v.nodes.find(n => n.id === 'y')!.depends_on).toEqual([])
  })

  it('gives a shared step to the open step nearest to it (fewest steps away), ties to the one higher up', () => {
    // a reaches s through m (two steps), b needs s directly (one step): s and what is under it go to b
    const p = planOf(node('goal', ['a', 'b']), node('a', ['m', 'k']), node('m', ['s']), node('k'), node('b', ['s', 'r']), node('s', ['t']), node('t'), node('r'))
    const v = deckView(p, null, true)
    expect(ids(v.decks.get('deck:a')!.members)).toEqual(['m', 'k'])
    expect(ids(v.decks.get('deck:b')!.members)).toEqual(['s', 't', 'r'])
    // m's need of s crosses into b's deck: not drawn, so a's deck does not sit above b's
    expect(v.nodes.find(n => n.id === 'deck:a')!.depends_on).toEqual([])
  })

  it('draws no edge from a deck whose step needs a step of another deck: each deck hangs from its owner only', () => {
    // x and y both reach the diamond bottom z; z goes to x (tie, x first); y1's need of z is not drawn
    const p = planOf(node('goal', ['x', 'y']), node('x', ['x1', 'x2']), node('y', ['y1', 'y2']), node('x1', ['z']), node('x2'), node('y1', ['z']), node('y2'), node('z'))
    const v = deckView(p, null, true)
    expect(ids(v.decks.get('deck:x')!.members)).toEqual(['x1', 'x2', 'z'])
    expect(ids(v.decks.get('deck:y')!.members)).toEqual(['y1', 'y2'])
    expect(v.nodes.find(n => n.id === 'deck:y')!.depends_on).toEqual([])
    expect(v.nodes.find(n => n.id === 'deck:x')!.depends_on).toEqual([])
  })

  it('never draws a loop: a shared step stays in its deck, and the need into it from the other open step is not drawn', () => {
    // a needs m and d; m needs b (open), b needs d. d is in a's deck (a tie, a first), so the deck needs b; b's need of
    // d crosses into a's deck and is left out, so nothing loops and nothing opens.
    const p = planOf(node('goal', ['a', 'b']), node('a', ['m', 'd', 'q']), node('m', ['b']), node('q'), node('b', ['d']), node('d'))
    const v = deckView(p, null, true)
    expect(ids(v.decks.get('deck:a')!.members)).toEqual(['m', 'q', 'd'])
    expect(v.nodes.find(n => n.id === 'deck:a')!.depends_on).toEqual(['b'])
    expect(v.nodes.find(n => n.id === 'b')!.depends_on).toEqual([])
    expect(v.nodes.map(n => n.id).sort()).toEqual(['a', 'b', 'deck:a', 'goal'])
    const drawn = new Map(v.nodes.map(n => [n.id, n.depends_on]))
    const seen = new Set<string>()
    const onPath = new Set<string>()
    const visit = (id: string): void => {
      expect(onPath.has(id), `loop through ${id}`).toBe(false)
      if (seen.has(id)) return
      seen.add(id)
      onPath.add(id)
      for (const d of drawn.get(id) ?? []) visit(d)
      onPath.delete(id)
    }
    for (const id of drawn.keys()) visit(id)
    const sizes = [...v.decks.values()].reduce((s, d) => s + d.members.length, 0)
    expect(sizes).toBe(v.hidden.size)
  })

  it('makes a deck depend on the open nodes its members depend on', () => {
    const p = planOf(node('goal', ['a', 'b']), node('a', ['m']), node('b', ['o']), node('m', ['o']), node('o'))
    const v = deckView(p, 'b', true)
    expect(ids(v.decks.get('deck:goal')!.members)).toEqual(['a', 'm'])
    expect(v.nodes.find(n => n.id === 'deck:goal')!.depends_on).toEqual(['o'])
    expect(v.nodes.find(n => n.id === 'goal')!.depends_on).toEqual(['deck:goal', 'b'])
  })

  it('opens an unconnected root', () => {
    const p = planOf(node('goal', ['a']), node('a', ['b']), node('b'), node('lone'))
    const v = deckView(p, null, true)
    expect(v.nodes.map(n => n.id)).toEqual(['goal', 'a', 'b', 'lone'])
  })

  it('draws no deck for a node whose children are all open, and only depends on drawn nodes', () => {
    const v = deckView(tree(), 'G', true)
    expect(v.nodes.map(n => n.id)).toEqual(['A', 'B', 'deck:A', 'D', 'E', 'G'])
    expect(v.decks.has('deck:D')).toBe(false)
    const drawn = new Set(v.nodes.map(n => n.id))
    for (const n of v.nodes) for (const d of n.depends_on) expect(drawn.has(d)).toBe(true)
  })

  it('draws a would-be deck of one member as that member', () => {
    const v = deckView(planOf(node('A', ['B']), node('B', ['C']), node('C')), null, true)
    expect(v.nodes).toEqual([
      { id: 'A', depends_on: ['B'] },
      { id: 'B', depends_on: ['C'] },
      { id: 'C', depends_on: [] },
    ])
    expect(v.decks.size).toBe(0)
    expect(v.hidden.size).toBe(0)
  })

  it('a step shared by two branches counts once: what is left of the other branch may be a single step, drawn as itself', () => {
    // x's deck takes s and p; y's only step, s, is in x's deck already, so y has no deck and no drawn need
    const p = planOf(node('goal', ['x', 'y']), node('x', ['s', 'p']), node('y', ['s']), node('s'), node('p'))
    const v = deckView(p, null, true)
    expect(v.nodes.map(n => n.id)).toEqual(['goal', 'x', 'y', 'deck:x'])
    expect(ids(v.decks.get('deck:x')!.members)).toEqual(['s', 'p'])
    expect(v.nodes.find(n => n.id === 'y')!.depends_on).toEqual([])
  })
})

describe('deckParent', () => {
  it('maps a deck id to its parent and anything else to null', () => {
    expect(DECK_PREFIX).toBe('deck:')
    expect(DECK_LIST_MAX).toBe(6)
    expect(deckParent('deck:x')).toBe('x')
    expect(deckParent('x')).toBeNull()
  })
})

describe('deckLabel', () => {
  const today = '2026-10-04'
  /** `others` are steps outside the deck that members may wait on. */
  const label = (members: PlanNode[], others: PlanNode[] = []) => {
    const plan = planOf(...members, ...others, node('goal', members.map(m => m.id)))
    return deckLabel({ id: 'deck:goal', parentId: 'goal', members }, today, nodeStates(plan))
  }

  it('titles it by member count', () => {
    expect(label([node('a'), node('b'), node('c')]).title).toBe('3 steps')
  })

  it('is high (shows the high mark beside its count) when it holds a high-priority step that is not done; nothing else marks it', () => {
    expect(label([node('a', [], { priority: 'low' }), node('b'), node('c', [], { priority: 'high' })]).priority).toBe('high')
    // a high step that is done does not mark the deck; another high one that is not done still does
    expect(label([node('a', [], { priority: 'high', status: 'done' }), node('b')]).priority).toBe('normal')
    expect(label([node('a', [], { priority: 'high', status: 'done' }), node('b', [], { priority: 'high' })]).priority).toBe('high')
    // low members never mark a deck: only "holds a high step" is shown on it
    expect(label([node('a', [], { priority: 'low' }), node('b', [], { priority: 'low' })]).priority).toBe('normal')
    expect(label([node('a', [], { priority: 'low' }), node('b')]).priority).toBe('normal')
  })

  it('takes the nearest due date, ignoring members without one, and is overdue if any member is', () => {
    const v = label([node('a'), node('b', [], { due: '2026-10-10' }), node('c', [], { due: '2026-10-01' }), node('d', [], { due: '2026-12-01', status: 'done' })])
    expect(v.due?.date).toBe('2026-10-01')
    expect(v.due?.overdue).toBe(true)
    expect(label([node('a'), node('b', [], { due: '2026-10-10' }), node('c', [], { due: '2026-11-10' })]).due).toMatchObject({ date: '2026-10-10', overdue: false })
    expect(label([node('a'), node('b')]).due).toBeNull()
  })

  it('given the plan, members without a date of their own show the one they inherit, and the nearest still wins', () => {
    const members = [node('a'), node('b')]
    const plan = planOf(...members, node('goal', ['a', 'b'], { due: '2026-11-01' }))
    const v = deckLabel({ id: 'deck:goal', parentId: 'goal', members }, today, nodeStates(plan), plan).due
    expect(v).toMatchObject({ date: '2026-11-01', inherited: true, from: 'goal' })
    const own = [node('a'), node('b', [], { due: '2026-12-01' })]
    const plan2 = planOf(...own, node('goal', ['a', 'b'], { due: '2026-11-01' }))
    expect(deckLabel({ id: 'deck:goal', parentId: 'goal', members: own }, today, nodeStates(plan2), plan2).due).toMatchObject({ date: '2026-11-01', inherited: true })
  })

  it('when two members share the nearest date, shows the one whose date is its own, whichever comes first', () => {
    // a inherits 2026-11-01 from the goal; b has the same date as its own
    for (const order of [['a', 'b'], ['b', 'a']]) {
      const byId = { a: node('a'), b: node('b', [], { due: '2026-11-01' }) }
      const members = order.map(id => byId[id as 'a' | 'b'])
      const plan = planOf(...members, node('goal', ['a', 'b'], { due: '2026-11-01' }))
      const v = deckLabel({ id: 'deck:goal', parentId: 'goal', members }, today, nodeStates(plan), plan).due
      expect(v, `members in order ${order}`).toMatchObject({ date: '2026-11-01' })
      expect(v?.inherited, `members in order ${order}`).toBeUndefined()
    }
  })

  it('state is what most of its unfinished steps are, ties going ready, blocked, doing, waiting; done only when all are', () => {
    // a and c are ready (todo with nothing to wait for)
    expect(label([node('a'), node('b', [], { status: 'blocked' }), node('c')]).state).toBe('ready')
    expect(label([node('a', [], { status: 'doing' }), node('b'), node('c')]).state).toBe('ready')
    // one doing, two waiting on it: most of it waits
    const x = node('x', [], { status: 'doing' })
    expect(label([x, node('w1', ['x']), node('w2', ['x'])]).state).toBe('waiting')
    expect(label([node('a', [], { status: 'blocked' }), node('b', [], { status: 'doing' }), node('c', [], { status: 'doing' })]).state).toBe('doing')
    // ties
    expect(label([node('a'), node('w', ['x']), x]).state).toBe('ready')
    expect(label([node('a', [], { status: 'blocked' }), node('w', ['x']), x]).state).toBe('blocked')
    expect(label([node('a', [], { status: 'done' }), node('b', [], { status: 'done' })]).state).toBe('done')
  })

  it('a mostly waiting deck with a ready step or two is not painted ready: it says how many are ready instead', () => {
    const out = node('out', [], { status: 'doing' })
    const waiting = Array.from({ length: 21 }, (_, i) => node(`w${i}`, ['out']))
    const v = label([node('r1'), node('r2'), ...waiting], [out])
    expect(v).toMatchObject({ title: '23 steps', state: 'waiting', status: 'todo', breakdown: '2 ready, 21 waiting', readyInside: true })
    expect(v.mix).toEqual([{ state: 'ready', n: 2 }, { state: 'waiting', n: 21 }])
    // most of it ready: painted ready, no marker needed
    expect(label([node('r1'), node('r2'), node('w', ['out'])], [out])).toMatchObject({ state: 'ready', readyInside: false, breakdown: '2 ready, 1 waiting' })
  })

  it('the breakdown lists each state once, ready first, and is empty when every step is in the same state', () => {
    const out = node('out', [], { status: 'doing' })
    const v = label([node('d1', [], { status: 'done' }), node('w', ['out']), node('b', [], { status: 'blocked' }), node('r'), node('g', [], { status: 'doing' })], [out])
    expect(v.breakdown).toBe('1 ready, 1 blocked, 1 doing, 1 waiting, 1 done')
    expect(label([node('a'), node('b')])).toMatchObject({ breakdown: '', mix: [], state: 'ready', readyInside: false })
    expect(label([node('a', [], { status: 'done' }), node('b', [], { status: 'done' })]).breakdown).toBe('')
  })

  it('a deck with any blocked step never reads as done, however many steps are done', () => {
    const done = (id: string) => node(id, [], { status: 'done' })
    expect(label([done('a'), done('b'), done('c'), node('d', [], { status: 'blocked' })]).state).toBe('blocked')
    expect(label([done('a'), done('b'), done('c'), node('d', [], { status: 'doing' })]).state).toBe('doing')
    // waiting on a step outside the deck
    expect(label([done('a'), done('b'), node('w', ['out'])], [node('out', [], { status: 'doing' })]).state).toBe('waiting')
  })

  it('status, which colours the text, agrees with the state, which colours the fan', () => {
    const x = node('x', [], { status: 'doing' })
    const cases: [PlanNode[], string, string][] = [
      [[node('a'), node('b', [], { status: 'blocked' })], 'ready', 'todo'],
      [[node('a', [], { status: 'blocked' }), node('b', [], { status: 'done' })], 'blocked', 'blocked'],
      [[x, node('w1', ['x'])], 'doing', 'doing'],
      [[node('w1', ['out']), node('w2', ['out'])], 'waiting', 'todo'],
      [[node('a', [], { status: 'done' }), node('b', [], { status: 'done' })], 'done', 'done'],
    ]
    for (const [members, state, status] of cases) {
      const v = label(members, [node('out', [], { status: 'doing' })])
      expect([v.state, v.status]).toEqual([state, status])
    }
  })

  it('is held only when every member is held', () => {
    expect(label([node('a', [], { hold: 'x' }), node('b', [], { hold: 'y' })]).held).toBe(true)
    expect(label([node('a', [], { hold: 'x' }), node('b')]).held).toBe(false)
  })
})

describe('decks and the selected chain', () => {
  it('never fold a step of the selection\'s chain into a branch deck, so a branch deck is never on the chain and is dim whenever something is selected (with no done steps, there are no done decks)', () => {
    const plans = [
      tree(),
      planOf(node('goal', ['x', 'y']), node('x', ['s', 'p']), node('y', ['s']), node('s', ['t']), node('p'), node('t')),
      planOf(node('top1', ['mid']), node('top2', ['mid']), node('mid', ['leaf', 'other']), node('leaf'), node('other'), node('lone')),
    ]
    for (const p of plans) {
      for (const sel of p.nodes.map(n => n.id)) {
        const { hidden } = deckView(p, sel, true)
        const chain = chainOf(p, sel)
        for (const id of [sel, ...chain.upstream, ...chain.downstream]) expect(hidden.has(id), `${sel}: ${id}`).toBe(false)
      }
    }
  })
})

describe('done decks (a selection, Group on)', () => {
  const done = (id: string, depends_on: string[] = []) => node(id, depends_on, { status: 'done' })
  /** Every edge of the view ends at a drawn node, and no node depends on itself. */
  const wellFormed = (v: ReturnType<typeof deckView>) => {
    const drawn = new Set(v.nodes.map(n => n.id))
    for (const n of v.nodes)
      for (const d of n.depends_on) {
        expect(drawn.has(d), `${n.id} -> ${d}`).toBe(true)
        expect(d).not.toBe(n.id)
      }
  }

  // The owner's picture: an area over ten needs, two not done; the eight done ones and three rows below them are done,
  // with links across; a sibling branch beside the area.
  const area = () =>
    planOf(
      node('goal', ['area', 'other']),
      node('area', ['n1', 'n2', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8']),
      node('n1'),
      node('n2', ['e2']),
      done('d1', ['e1', 'e2']),
      done('d2', ['e2', 'e3']),
      done('d3', ['e3']),
      done('d4', ['e4']),
      done('d5'),
      done('d6', ['e4', 'e1']),
      done('d7'),
      done('d8', ['e5']),
      done('e1', ['f1']),
      done('e2', ['f1', 'f2']),
      done('e3', ['f2']),
      done('e4', ['f3']),
      done('e5', ['f3']),
      done('f1', ['g1']),
      done('f2', ['g1']),
      done('f3', ['g2']),
      done('g1'),
      done('g2'),
      node('other', ['o1', 'o2']),
      node('o1'),
      node('o2'),
    )

  it("folds the selection's done needs into one deck under it, the deeper done steps with them, each counted once", () => {
    const v = deckView(area(), 'area', true)
    // n2 needs e2, which is done and also under d1 and d2: it is in the area's deck, once; n2 is under the area, so its
    // line to that deck is left out (the deck hangs from the area alone) and its label says so
    expect(v.nodes.map(n => n.id)).toEqual(['goal', 'area', 'n1', 'n2', 'deck:area', 'deck:goal'])
    const deck = v.decks.get('deck:area')!
    expect(deck.parentId).toBe('area')
    expect(deck.done).toBe(true)
    const members = ids(deck.members)
    expect(members).toEqual(['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'e1', 'e2', 'e3', 'e4', 'e5', 'f1', 'f2', 'f3', 'g1', 'g2'])
    expect(new Set(members).size).toBe(members.length)
    for (const m of members) expect(v.hidden.get(m)).toEqual(['deck:area'])
    expect(v.nodes.find(n => n.id === 'area')!.depends_on).toEqual(['n1', 'n2', 'deck:area'])
    expect(v.nodes.find(n => n.id === 'n2')!.depends_on).toEqual([])
    expect(v.elsewhere.get('n2')).toEqual(['e2'])
    expect(v.nodes.find(n => n.id === 'deck:area')!.depends_on).toEqual([])
    // the sibling branch is the deck it always was, not a done deck
    expect(v.decks.get('deck:goal')!.done).toBeUndefined()
    wellFormed(v)
  })

  it('keeps a done step drawn when a step that is not done sits below it, so the path to that step reads', () => {
    // sel -> d1 (done) -> n (todo); d1 also needs two done steps; sel needs two more done steps
    const p = planOf(node('sel', ['d1', 'x1', 'x2']), done('d1', ['n', 'y1', 'y2']), node('n'), done('y1'), done('y2'), done('x1'), done('x2'))
    const v = deckView(p, 'sel', true)
    expect(v.nodes.map(n => n.id)).toEqual(['sel', 'd1', 'n', 'deck:d1', 'deck:sel'])
    expect(ids(v.decks.get('deck:sel')!.members)).toEqual(['x1', 'x2'])
    expect(ids(v.decks.get('deck:d1')!.members)).toEqual(['y1', 'y2'])
    expect(v.nodes.find(n => n.id === 'd1')!.depends_on).toEqual(['n', 'deck:d1'])
    expect(v.hidden.has('n')).toBe(false)
    wellFormed(v)
  })

  it('never hides a step that is not done, wherever it sits', () => {
    const plans = [
      area(),
      planOf(node('sel', ['d1', 'd2']), done('d1', ['d3']), done('d2', ['d3']), done('d3', ['n']), node('n', ['d4', 'd5']), done('d4'), done('d5')),
      planOf(node('sel', ['a', 'b']), done('a', ['c']), node('b', ['c', 'e']), done('c', ['f']), done('e'), node('f', [], { status: 'blocked' })),
    ]
    for (const p of plans)
      for (const sel of p.nodes.map(n => n.id)) {
        const v = deckView(p, sel, true)
        for (const n of p.nodes) if (n.status !== 'done' || n.id === sel) expect(v.decks.get(v.hidden.get(n.id)?.[0] ?? '')?.done, `${sel}: ${n.id}`).toBeFalsy()
        wellFormed(v)
      }
  })

  it('puts a done step that several drawn steps need in one deck only, and points the others at it', () => {
    // sel needs d1 and n1; n1 needs d2; d1 needs d2 and d3: d2 is in the selection's deck, once; that deck hangs from
    // the selection alone, so the lines there from n1 and from a step above are left out (said as drawn elsewhere)
    const top = planOf(node('top', ['sel', 'd2']), node('sel', ['d1', 'n1']), done('d1', ['d2', 'd3']), node('n1', ['d2']), done('d2'), done('d3'))
    expect(deckView(top, 'sel', true).nodes.find(n => n.id === 'top')!.depends_on).toEqual(['sel'])
    expect(deckView(top, 'sel', true).elsewhere.get('top')).toEqual(['d2'])
    const p = planOf(node('sel', ['d1', 'n1']), done('d1', ['d2', 'd3']), node('n1', ['d2', 'd4', 'd5']), done('d2'), done('d3'), done('d4'), done('d5'))
    const v = deckView(p, 'sel', true)
    expect(ids(v.decks.get('deck:sel')!.members)).toEqual(['d1', 'd2', 'd3'])
    expect(ids(v.decks.get('deck:n1')!.members)).toEqual(['d4', 'd5'])
    expect(v.hidden.get('d2')).toEqual(['deck:sel'])
    expect(v.nodes.find(n => n.id === 'n1')!.depends_on).toEqual(['deck:n1'])
    expect(v.elsewhere.get('n1')).toEqual(['d2'])
    wellFormed(v)
  })

  it("hangs the selected step's done deck from the selected step: a step drawn under it that also needs a step in that deck has that need left out", () => {
    // sel needs n1 (open) and d1..d3 (done); n1 -> p1 -> q1, and q1 needs d1 too: without this rule the deck would sit
    // below q1, three rows under sel, where the selection's frame does not reach (done-deck-off-screen)
    const p = planOf(
      node('goal', ['sel']),
      node('sel', ['n1', 'd1', 'd2', 'd3']),
      node('n1', ['p1']),
      node('p1', ['q1']),
      node('q1', ['d1', 'x']),
      node('x'),
      done('d1'),
      done('d2'),
      done('d3'),
    )
    const v = deckView(p, 'sel', true)
    expect(ids(v.decks.get('deck:sel')!.members)).toEqual(['d1', 'd2', 'd3'])
    expect(v.nodes.find(n => n.id === 'sel')!.depends_on).toEqual(['n1', 'deck:sel'])
    // q1's line to the deck is left out, and its label says a need is drawn elsewhere
    expect(v.nodes.find(n => n.id === 'q1')!.depends_on).toEqual(['x'])
    expect(v.elsewhere.get('q1')).toEqual(['d1'])
    // laid out, the deck sits in the row right under the selected step
    const layout = drawnLayout(p, 'sel', true, '2026-10-06').layout
    expect(layout.nodes.get('deck:sel')!.layer).toBe(layout.nodes.get('sel')!.layer + 1)
    wellFormed(v)
  })

  it("leaves out the lines into the selected step's done deck from the steps above it as from the steps under it", () => {
    const p = planOf(node('top', ['sel', 'd1']), node('sel', ['d1', 'd2', 'n']), node('n', ['d2']), done('d1'), done('d2'))
    const v = deckView(p, 'sel', true)
    expect(v.nodes.find(n => n.id === 'top')!.depends_on).toEqual(['sel'])
    expect(v.elsewhere.get('top')).toEqual(['d1'])
    expect(v.nodes.find(n => n.id === 'n')!.depends_on).toEqual([])
    expect(v.elsewhere.get('n')).toEqual(['d2'])
  })

  it("leaves out a line from another done deck under the selected step into the selected step's own", () => {
    // n1 (open need of sel) has its own done deck (f1, f2); f1 needs e1, which is in sel's deck
    const p = planOf(node('sel', ['n1', 'd1', 'd2']), node('n1', ['f1', 'f2']), done('f1', ['e1']), done('f2'), done('d1', ['e1']), done('d2'), done('e1'))
    const v = deckView(p, 'sel', true)
    expect(ids(v.decks.get('deck:n1')!.members)).toEqual(['f1', 'f2'])
    expect(v.nodes.find(n => n.id === 'deck:n1')!.depends_on).toEqual([])
    const layout = drawnLayout(p, 'sel', true, '2026-10-06').layout
    expect(layout.nodes.get('deck:sel')!.layer).toBe(layout.nodes.get('sel')!.layer + 1)
    wellFormed(v)
  })

  it('hangs every done deck from its owner alone: done decks that share finished steps do not stack under one another', () => {
    // the goal is selected; area A is finished (its steps fold into the goal's deck); areas B and C are open, each with
    // finished needs of their own (their decks) that share finished steps with A's
    const p = planOf(
      node('goal', ['A', 'B', 'C']),
      done('A', ['a1', 'a2']),
      done('a1', ['s1']),
      done('a2'),
      done('s1'),
      node('B', ['b1', 'b2', 'bo']),
      done('b1', ['s1']),
      done('b2'),
      node('bo', ['a2']),
      node('C', ['c1', 'c2']),
      done('c1', ['b2']),
      done('c2'),
    )
    const v = deckView(p, 'goal', true)
    expect(ids(v.decks.get('deck:goal')!.members)).toEqual(['A', 'a1', 'a2', 's1'])
    expect(ids(v.decks.get('deck:B')!.members)).toEqual(['b1', 'b2'])
    expect(ids(v.decks.get('deck:C')!.members)).toEqual(['c1', 'c2'])
    // no line from one done deck into another, nor from a drawn step into a done deck it does not own
    for (const id of ['deck:goal', 'deck:B', 'deck:C']) expect(v.nodes.find(n => n.id === id)!.depends_on, id).toEqual([])
    expect(v.nodes.find(n => n.id === 'bo')!.depends_on).toEqual([])
    expect(v.elsewhere.get('bo')).toEqual(['a2'])
    // laid out, each done deck sits in the row right under its owner
    const layout = drawnLayout(p, 'goal', true, '2026-10-06').layout
    for (const [deck, owner] of [['deck:goal', 'goal'], ['deck:B', 'B'], ['deck:C', 'C']])
      expect(layout.nodes.get(deck)!.layer, deck).toBe(layout.nodes.get(owner)!.layer + 1)
    wellFormed(v)
  })

  it('draws a lone done need as itself, like any deck of one', () => {
    const p = planOf(node('sel', ['n', 'd1']), node('n'), done('d1'))
    const v = deckView(p, 'sel', true)
    expect(v.nodes.map(n => n.id)).toEqual(['sel', 'n', 'd1'])
    expect(v.decks.size).toBe(0)
  })

  it('always draws the selected step, done or not, and folds its own done needs the same way', () => {
    const v = deckView(area(), 'd2', true)
    expect(v.hidden.has('d2')).toBe(false)
    expect(v.nodes.some(n => n.id === 'd2')).toBe(true)
    expect(ids(v.decks.get('deck:d2')!.members)).toEqual(['e2', 'e3', 'f1', 'f2', 'g1'])
    expect(v.decks.get('deck:d2')!.done).toBe(true)
    // the path up is drawn as before
    expect(v.nodes.some(n => n.id === 'area')).toBe(true)
    wellFormed(v)
  })

  it('a step on the path up that needs a folded done step says it is drawn elsewhere, in the deck under the selection', () => {
    const p = planOf(node('top', ['sel', 'd1']), node('sel', ['d1', 'd2']), done('d1'), done('d2'))
    const v = deckView(p, 'sel', true)
    expect(ids(v.decks.get('deck:sel')!.members)).toEqual(['d1', 'd2'])
    expect(v.nodes.find(n => n.id === 'top')!.depends_on).toEqual(['sel'])
    expect(v.elsewhere.get('top')).toEqual(['d1'])
    wellFormed(v)
  })

  it('draws the members of an opened done deck one by one', () => {
    const v = deckView(area(), 'area', true, new Set(['deck:area']))
    expect(v.decks.has('deck:area')).toBe(false)
    for (const m of ['d1', 'e2', 'g2']) expect(v.hidden.has(m)).toBe(false)
    expect(v.nodes.find(n => n.id === 'n2')!.depends_on).toEqual(['e2'])
    wellFormed(v)
  })

  it('changes nothing with nothing selected or with Group off', () => {
    const p = area()
    expect([...deckView(p, null, true).decks.values()].some(d => d.done)).toBe(false)
    const off = deckView(p, 'area', false)
    expect(off.nodes).toEqual(p.nodes.map(n => ({ id: n.id, depends_on: n.depends_on })))
    expect(off.decks.size).toBe(0)
  })

  it('a done deck reads as done', () => {
    const p = area()
    const v = deckView(p, 'area', true)
    expect(deckLabel(v.decks.get('deck:area')!, '2026-10-04', nodeStates(p), p)).toMatchObject({ title: '18 steps', state: 'done', status: 'done' })
  })
})

describe('every folded step is in exactly one deck', () => {
  /** A small seeded generator (mulberry32), so the random plans are the same on every run. */
  const rng = (seed: number) => () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  /** A random acyclic plan: step i needs only steps after it; about half are done, a few in progress or blocked. */
  const randomPlan = (seed: number, n: number): Plan => {
    const r = rng(seed)
    const nodes: PlanNode[] = []
    for (let i = 0; i < n; i++) {
      const needs = new Set<string>()
      const k = Math.floor(r() * 4)
      for (let j = 0; j < k && i + 1 < n; j++) needs.add(`s${i + 1 + Math.floor(r() * Math.min(8, n - i - 1))}`)
      const roll = r()
      const status = roll < 0.45 ? 'done' : roll < 0.85 ? 'todo' : roll < 0.93 ? 'doing' : 'blocked'
      nodes.push(node(`s${i}`, [...needs], { status }))
    }
    return planOf(...nodes)
  }

  /**
   * The invariants of a view: sizes add up, one deck per folded step, edges end at drawn nodes, no loops, needs kept
   * except those that cross into another branch deck (or deck of one), and each of those is needed by its owner only.
   */
  const check = (p: Plan, sel: string | null, why: string, opened: ReadonlySet<string> = new Set()) => {
    const v = deckView(p, sel, true, opened)
    const drawn = new Map(v.nodes.map(n => [n.id, n.depends_on]))
    let total = 0
    for (const d of v.decks.values()) {
      total += d.members.length
      expect(d.members.length, `${why}: ${d.id} is a deck of one`).toBeGreaterThan(1)
      expect(drawn.has(d.id), `${why}: ${d.id} is drawn`).toBe(true)
      for (const m of d.members) expect(v.hidden.get(m.id), `${why}: ${m.id}`).toEqual([d.id])
    }
    expect(total, why).toBe(v.hidden.size)
    for (const id of v.hidden.keys()) expect(drawn.has(id), `${why}: ${id} both drawn and folded`).toBe(false)
    for (const [id, deps] of drawn)
      for (const d of deps) {
        expect(drawn.has(d), `${why}: ${id} -> ${d}`).toBe(true)
        expect(d, why).not.toBe(id)
      }
    const mark = new Map<string, 1 | 2>()
    const visit = (id: string) => {
      expect(mark.get(id), `${why}: loop through ${id}`).not.toBe(1)
      if (mark.get(id) === 2) return
      mark.set(id, 1)
      for (const d of drawn.get(id) ?? []) visit(d)
      mark.set(id, 2)
    }
    for (const id of drawn.keys()) visit(id)
    // A deck of either kind, or a closed step drawn as itself (a deck of one), hangs from one drawn step only: its owner.
    const open = openSet(p, sel)
    const hangs = (id: string) => v.decks.has(id) || (drawn.has(id) && !open.has(id))
    for (const id of drawn.keys())
      if (hangs(id)) {
        const needers = [...drawn].filter(([, deps]) => deps.includes(id)).map(([k]) => k)
        expect(needers.length, `${why}: ${id} is needed by ${needers}`).toBe(1)
        if (v.decks.has(id)) expect(needers, why).toEqual([v.decks.get(id)!.parentId])
        expect(v.decks.has(needers[0]), `${why}: ${id} hangs from a deck`).toBe(false)
      }
    // any other need between two steps shows as an edge between whatever draws them, unless one deck draws both, or
    // it runs into something that hangs from another step (left out; a step drawn as itself says a need of its own that
    // lands in a done deck is drawn elsewhere)
    const at = (id: string) => (drawn.has(id) ? id : v.hidden.get(id)?.[0])
    let crossed = 0
    for (const n of p.nodes)
      for (const d of n.depends_on) {
        const from = at(n.id)
        const to = at(d)
        if (from === undefined || to === undefined || from === to) continue
        if (hangs(to) && !drawn.get(from)!.includes(to)) {
          if (from === n.id && v.decks.get(to)?.done) expect(v.elsewhere.get(from), `${why}: ${n.id} says ${d} is drawn elsewhere`).toContain(d)
          crossed++
          continue
        }
        expect(drawn.get(from), `${why}: ${n.id} -> ${d} as ${from} -> ${to}`).toContain(to)
      }
    return Object.assign(v, { crossed })
  }

  it('on diamonds', () => {
    const wide = planOf(
      node('g', ['p', 'q', 'r', 's']),
      ...['p', 'q', 'r', 's'].map(x => node(x, [`${x}1`, `${x}2`])),
      ...['p', 'q', 'r', 's'].flatMap(x => [node(`${x}1`, ['floor']), node(`${x}2`)]),
      node('floor', ['f1', 'f2']),
      node('f1'),
      node('f2'),
    )
    const diamonds = [
      planOf(node('g', ['a', 'b']), node('a', ['a1']), node('b', ['b1']), node('a1', ['m']), node('b1', ['m']), node('m', ['m1', 'm2']), node('m1'), node('m2')),
      planOf(node('g', ['a', 'b']), node('a', ['c']), node('b', ['c']), node('c', ['d', 'e']), node('d', ['f']), node('e', ['f']), node('f', ['h', 'i']), node('h'), node('i')),
      wide,
    ]
    for (const [i, p] of diamonds.entries()) for (const sel of [null, ...p.nodes.map(n => n.id)]) check(p, sel, `diamond ${i}, ${sel}`)
    // nothing selected: g and its four children are drawn, the other eleven steps fold, each counted once
    const v = deckView(wide, null, true)
    expect([...v.decks.values()].reduce((s, d) => s + d.members.length, 0)).toBe(wide.nodes.length - 5)
  })

  it('on random plans (fixed seeds), for every selection and none', () => {
    let branch = 0
    let done = 0
    let shared = 0
    for (let seed = 1; seed <= 40; seed++) {
      const p = randomPlan(seed, 18 + (seed % 5) * 6)
      for (const sel of [null, ...p.nodes.map(n => n.id)]) {
        const v = check(p, sel, `seed ${seed}, ${sel}`)
        done += [...v.decks.values()].filter(d => d.done).length
        branch += [...v.decks.values()].filter(d => !d.done).length
        // needs that cross into another deck: once they were drawn (and stretched the layout), now they are left out
        shared += v.crossed
      }
    }
    // the plans are rich enough to prove something: decks of both kinds, and many needs that cross between decks
    expect(branch).toBeGreaterThan(100)
    expect(done).toBeGreaterThan(20)
    expect(shared).toBeGreaterThan(50)
  })

  // Several goals: with a selection, every other goal stays drawn at the top and its own tree folds under it by the same
  // rules, so nothing in the plan is left out of the view.
  it('with a selection in a plan of two roots, the other root is drawn and the steps only it reaches fold into its deck', () => {
    // A -> a1 -> a2 and B -> b1 -> b2, with B also needing the shared a2
    const p = planOf(node('A', ['a1']), node('a1', ['a2']), node('a2'), node('B', ['b1', 'a2']), node('b1', ['b2']), node('b2'))
    for (const sel of ['A', 'a1']) {
      const v = check(p, sel, `two roots, ${sel}`)
      const drawn = new Set(v.nodes.map(n => n.id))
      for (const id of ['A', 'a1', 'a2', 'B']) expect(drawn.has(id), `${sel}: ${id} drawn`).toBe(true)
      for (const id of ['b1', 'b2']) expect(v.hidden.get(id), `${sel}: ${id} folded`).toEqual(['deck:B'])
      expect([...v.decks.keys()]).toEqual(['deck:B'])
      // B still needs the drawn a2, and its deck hangs from B
      expect(v.nodes.find(n => n.id === 'B')!.depends_on).toEqual(['deck:B', 'a2'])
    }
    // selecting the shared step opens every path up from it, B's too: B's own branch is then a deck under B
    const shared = check(p, 'a2', 'two roots, a2')
    expect(shared.nodes.some(n => n.id === 'B')).toBe(true)
    expect(shared.hidden.get('b1')).toEqual(['deck:B'])
    expect(shared.hidden.get('b2')).toEqual(['deck:B'])
    // with nothing selected both roots are open, so nothing is left out
    const none = deckView(p, null, true)
    for (const n of p.nodes) expect(none.nodes.some(d => d.id === n.id) || none.hidden.has(n.id), n.id).toBe(true)
  })

  it("with a selection, the other goals come after the selection's own goal in the view, so they are laid out to its right", () => {
    // the served plan is in id order, so the other goal (hire) comes first in the plan
    const p = planOf(
      node('deploy', ['host']), node('docs', ['guide', 'api']), node('guide'), node('api'), node('hire', ['role', 'post', 'host']), node('host'),
      node('launch', ['site', 'docs']), node('pages'), node('post', ['board']), node('board'), node('role', ['scope']), node('scope'), node('site', ['pages', 'deploy']),
    )
    const x = (sel: string, id: string) => drawnLayout(p, sel, true, '2026-10-05').layout.nodes.get(id)!.x
    expect(x('deploy', 'hire')).toBeGreaterThan(x('deploy', 'launch'))
    expect(x('hire', 'launch')).toBeGreaterThan(x('hire', 'hire'))
    // only the other root moves: the view is the one of the plan with that root listed last
    const last = planOf(...p.nodes.filter(n => n.id !== 'hire'), p.nodes.find(n => n.id === 'hire')!)
    expect(deckView(p, 'deploy', true).nodes).toEqual(deckView(last, 'deploy', true).nodes)
    // with nothing selected the plan's order stands
    const none = deckView(p, null, true).nodes.map(n => n.id)
    expect(none.indexOf('hire')).toBeLessThan(none.indexOf('launch'))
  })

  it('a step two goals need at the same distance goes to the goal earlier in the plan', () => {
    // A -> a1; B and C both need s directly, s -> t; a1 selected: B comes before C, so s and t are in B's deck
    const p = planOf(node('A', ['a1']), node('a1'), node('B', ['s', 'b1']), node('C', ['s', 'c1']), node('s', ['t']), node('t'), node('b1'), node('c1'))
    const v = check(p, 'a1', 'tie')
    expect(ids(v.decks.get('deck:B')!.members)).toEqual(['s', 't', 'b1'])
    expect(v.decks.has('deck:C')).toBe(false) // only c1 is left: drawn as itself
    expect(v.nodes.find(n => n.id === 'C')!.depends_on).toEqual(['c1'])
    // the other order of the plan gives them to C
    const q = planOf(node('A', ['a1']), node('a1'), node('C', ['s', 'c1']), node('B', ['s', 'b1']), node('s', ['t']), node('t'), node('b1'), node('c1'))
    expect(ids(check(q, 'a1', 'tie, reversed').decks.get('deck:C')!.members)).toEqual(['s', 't', 'c1'])
  })

  it('a finished goal off the chain is drawn as itself with its done tree in a done deck, which a click opens in place', () => {
    const done = { status: 'done' as const }
    // A is open; D is done with everything under it done; f is a done need of the selected a1 and also needed by D
    const p = planOf(
      node('A', ['a1', 'a2']), node('a1', ['f', 'g']), node('a2'), node('f', [], done), node('g', [], done),
      node('D', ['d1', 'd2', 'f'], done), node('d1', ['d3'], done), node('d2', [], done), node('d3', [], done),
    )
    const v = check(p, 'a1', 'finished goal')
    expect(v.decks.get('deck:a1')).toMatchObject({ done: true })
    expect(ids(v.decks.get('deck:a1')!.members)).toEqual(['f', 'g'])
    // D's own done steps fold into a done deck under D; f stays in the selection's deck, which hangs from a1 alone, so
    // D's line to it is left out and D says that need is drawn elsewhere
    expect(v.decks.get('deck:D')).toMatchObject({ parentId: 'D', done: true })
    expect(ids(v.decks.get('deck:D')!.members)).toEqual(['d1', 'd2', 'd3'])
    expect(v.nodes.find(n => n.id === 'D')!.depends_on).toEqual(['deck:D'])
    expect(v.elsewhere.get('D')).toEqual(['f'])
    expect(v.decks.size).toBe(2)
    // opened, its steps are drawn one by one, and the view keeps every invariant
    const opened = check(p, 'a1', 'finished goal, opened', new Set(['deck:D']))
    expect(opened.decks.has('deck:D')).toBe(false)
    for (const id of ['d1', 'd2', 'd3']) expect(opened.nodes.some(n => n.id === id), id).toBe(true)
    expect(opened.nodes.find(n => n.id === 'd1')!.depends_on).toEqual(['d3'])
    // a done goal with unfinished work under it keeps an ordinary branch deck
    const q = planOf(node('A', ['a1']), node('a1'), node('D', ['d1', 'd2'], done), node('d1', [], done), node('d2'))
    expect(check(q, 'a1', 'done goal, work left').decks.get('deck:D')!.done).toBeUndefined()
  })

  it('in plans of several goals, for every selection and none: the steps drawn one by one and the decks add up to the plan, each step once', () => {
    const plans: [string, Plan][] = [
      ['two roots', planOf(node('A', ['a1']), node('a1', ['a2']), node('a2'), node('B', ['b1', 'a2']), node('b1', ['b2']), node('b2'))],
      ['three goals and a lone step', planOf(
        node('g1', ['x', 'y']), node('x', ['x1', 'x2']), node('y', ['s']), node('x1'), node('x2', ['s']), node('s', ['t']), node('t'),
        node('g2', ['p', 'q']), node('p', ['p1', 'p2']), node('q', ['s']), node('p1'), node('p2'),
        node('g3', ['r']), node('r', ['r1', 'r2', 'r3']), node('r1'), node('r2', [], { status: 'done' }), node('r3', [], { status: 'done' }),
        node('lone'),
      )],
      ['goals over a shared done floor', planOf(
        node('G', ['a', 'b']), node('a', ['d1', 'd2']), node('b', ['d2', 'n']), node('n'),
        node('H', ['h1', 'h2', 'd1']), node('h1', ['d2']), node('h2'),
        node('d1', [], { status: 'done' }), node('d2', ['d3'], { status: 'done' }), node('d3', [], { status: 'done' }),
      )],
      ['the tree beside a second goal', planOf(...tree().nodes, node('Z', ['z1', 'z2', 'E']), node('z1', ['z3']), node('z2'), node('z3'))],
      ['a finished goal beside an open one', planOf(
        node('A', ['a1', 'a2']), node('a1', ['f']), node('a2'), node('f', [], { status: 'done' }),
        node('D', ['d1', 'd2', 'f'], { status: 'done' }), node('d1', ['d3'], { status: 'done' }), node('d2', [], { status: 'done' }), node('d3', [], { status: 'done' }),
        node('E', ['d2'], { status: 'done' }),
      )],
      ['a done goal with work left under it', planOf(
        node('A', ['a1']), node('a1'),
        node('D', ['d1', 'd2'], { status: 'done' }), node('d1', ['d3'], { status: 'done' }), node('d2'), node('d3', [], { status: 'done' }),
      )],
      ['a held goal', planOf(
        node('A', ['a1', 'a2']), node('a1'), node('a2', ['s']), node('s'),
        node('H', ['h1', 'h2', 's'], { hold: 'waiting on the budget' }), node('h1', ['h3']), node('h2'), node('h3'),
      )],
    ]
    for (const [name, p] of plans)
      for (const sel of [null, ...p.nodes.map(n => n.id)]) {
        const v = check(p, sel, `${name}, ${sel}`)
        const placed: string[] = v.nodes.filter(n => !v.decks.has(n.id)).map(n => n.id)
        for (const d of v.decks.values()) placed.push(...d.members.map(m => m.id))
        expect(new Set(placed).size, `${name}, ${sel}: a step placed twice`).toBe(placed.length)
        expect([...placed].sort(), `${name}, ${sel}`).toEqual(p.nodes.map(n => n.id).sort())
        // every goal is drawn as itself, at the top
        for (const n of p.nodes) if (!p.nodes.some(o => o.depends_on.includes(n.id))) expect(v.hidden.has(n.id), `${name}, ${sel}: goal ${n.id}`).toBe(false)
      }
  })

  // The test above runs check() on these same plans for every selection with done decks folded; this one adds the
  // views with them opened. Twenty seeds keep it well inside the timeout when the whole suite runs in parallel.
  it('on random plans of several goals (fixed seeds), for every selection, with its done decks folded and opened: each step placed once', () => {
    let roots = 0
    let opened = 0
    for (let seed = 1; seed <= 20; seed++) {
      const p = randomPlan(seed, 18 + (seed % 5) * 6)
      const all = p.nodes.map(n => n.id).sort()
      roots += p.nodes.filter(n => !p.nodes.some(o => o.depends_on.includes(n.id))).length
      for (const sel of p.nodes.map(n => n.id)) {
        const folded = deckView(p, sel, true)
        const doneDecks = new Set([...folded.decks.values()].filter(d => d.done).map(d => d.id))
        const views = [folded]
        if (doneDecks.size) {
          views.push(check(p, sel, `seed ${seed}, ${sel}, opened`, doneDecks))
          opened++
        }
        for (const v of views) {
          const placed = v.nodes.filter(n => !v.decks.has(n.id)).map(n => n.id)
          for (const d of v.decks.values()) placed.push(...d.members.map(m => m.id))
          expect(new Set(placed).size, `seed ${seed}, ${sel}: a step placed twice`).toBe(placed.length)
          expect(placed.sort(), `seed ${seed}, ${sel}`).toEqual(all)
        }
      }
    }
    // the random plans have many goals each, and many selections have done decks to open, so the check means something
    expect(roots).toBeGreaterThan(40)
    expect(opened).toBeGreaterThan(20)
  })
})

describe('a cross-linked plan (one goal, four areas, 48 features, many needed by two or three areas)', () => {
  const sorted = (xs: Iterable<string>) => [...xs].sort()
  const rows = (sel: string | null) => new Set([...drawnLayout(crossLinkedPlan, sel, true, '2026-10-05').layout.nodes.values()].map(n => n.layer)).size
  /** The steps drawn one by one (decks aside). */
  const steps = (v: ReturnType<typeof deckView>) => v.nodes.filter(n => !v.decks.has(n.id)).map(n => n.id)

  it('with nothing selected draws the goal, the four areas and one deck under each: three rows, no feature drawn', () => {
    const v = deckView(crossLinkedPlan, null, true)
    expect(sorted(steps(v))).toEqual(sorted([CROSS_GOAL, ...CROSS_AREAS]))
    expect(sorted(v.decks.keys())).toEqual(sorted(CROSS_AREAS.map(a => DECK_PREFIX + a)))
    for (const a of CROSS_AREAS) {
      expect(v.nodes.find(n => n.id === a)!.depends_on, a).toEqual([DECK_PREFIX + a])
      expect(v.nodes.find(n => n.id === DECK_PREFIX + a)!.depends_on, a).toEqual([])
    }
    // every feature is in one deck: the decks add up to the 48
    expect([...v.decks.values()].reduce((s, d) => s + d.members.length, 0)).toBe(crossLinkedPlan.nodes.length - 5)
    expect(rows(null)).toBe(3)
  })

  // What the graph drew before decks took one owner each (steps drawn one by one), for the same selection.
  const BEFORE: Record<string, string[]> = {
    'view-the-graph': ['depgraph', 'partial-deck', 'ready-now-list', 'view-the-graph', 'titles-never-collide', 'inherited-size-cap', 'deck-honest-counts', 'narrow-panel-overlay'],
    camera: [
      'arrow-key-walk', 'camera', 'closer-is-larger', 'depgraph', 'due-dates', 'edit-selected-step', 'fit-all-key', 'inherited-due', 'jump-to-step',
      'review-accept-all', 'view-the-graph', 'shape-the-plan', 'think-aloud', 'frame-follows-edits', 'resize-reframes',
    ],
  }

  it('with an area selected draws its path and its open needs, and folds the rest into one deck under it and one under the goal', () => {
    const v = deckView(crossLinkedPlan, 'view-the-graph', true)
    expect(sorted(v.nodes.map(n => n.id))).toEqual(sorted([...BEFORE['view-the-graph'], 'deck:view-the-graph', 'deck:depgraph']))
    // three rows: its done deck sits right under it, beside its open needs, not under narrow-panel-overlay (which
    // shares finished steps with it) a row lower
    expect(rows('view-the-graph')).toBe(3)
    // the two open needs that share finished work with that deck say a need is drawn elsewhere
    expect([...v.elsewhere.keys()].sort()).toEqual(['partial-deck', 'ready-now-list'])
  })

  it('with a feature inside an area selected draws no more than before, apart from a deck of one under its owner', () => {
    const v = deckView(crossLinkedPlan, 'camera', true)
    expect(sorted(v.nodes.map(n => n.id))).toEqual(
      sorted([
        'arrow-key-walk', 'camera', 'closer-is-larger', 'depgraph', 'fit-all-key', 'inherited-due', 'jump-to-step', 'node-folders', 'review-accept-all',
        'view-the-graph', 'shape-the-plan', 'think-aloud', 'resize-reframes',
        'deck:camera', 'deck:depgraph', 'deck:view-the-graph', 'deck:shape-the-plan', 'deck:think-aloud',
      ]),
    )
    const open = openSet(crossLinkedPlan, 'camera')
    for (const id of steps(v)) if (!BEFORE.camera.includes(id)) expect(open.has(id), `${id} is new and not a deck of one`).toBe(false)
    // node-folders is the only step its owner's deck would hold: drawn as itself, hanging from that owner alone
    expect(v.nodes.filter(n => n.depends_on.includes('node-folders')).map(n => n.id)).toEqual(['inherited-due'])
    expect(rows('camera')).toBeLessThanOrEqual(6)
  })

  it('for every selection (none, and each step): the decks and the steps drawn one by one add up to the plan, and no step is in two decks', () => {
    const total = crossLinkedPlan.nodes.length
    for (const sel of [null, ...crossLinkedPlan.nodes.map(n => n.id)]) {
      const v = deckView(crossLinkedPlan, sel, true)
      const seen = new Map<string, string>()
      for (const d of v.decks.values())
        for (const m of d.members) {
          expect(seen.get(m.id), `${sel}: ${m.id} is in ${seen.get(m.id)} and ${d.id}`).toBeUndefined()
          seen.set(m.id, d.id)
        }
      const folded = [...v.decks.values()].reduce((s, d) => s + d.members.length, 0)
      const drawn = steps(v)
      for (const id of drawn) expect(seen.has(id), `${sel}: ${id} both drawn and folded`).toBe(false)
      expect(folded + drawn.length, `${sel}`).toBe(total)
    }
  })

  it("a shared step's branch deck is decided by the selection alone: the same every time, and it moves only when the open set changes", () => {
    // Branch decks only: a done deck follows the selected step itself (what it needs that is finished), so two selections
    // with the same open set may fold different done steps; which branch deck takes a closed step depends on the open set.
    const owners = (sel: string | null) => {
      const v = deckView(crossLinkedPlan, sel, true)
      return new Map([...v.hidden].filter(([, [deck]]) => !v.decks.get(deck)!.done).map(([id, [deck]]) => [id, deck]))
    }
    // shared steps: needed by two or more steps
    const needers = new Map<string, number>()
    for (const n of crossLinkedPlan.nodes) for (const d of n.depends_on) needers.set(d, (needers.get(d) ?? 0) + 1)
    const shared = [...needers].filter(([, k]) => k > 1).map(([id]) => id)
    expect(shared.length).toBeGreaterThan(5)
    const sels = [null, ...crossLinkedPlan.nodes.map(n => n.id)]
    const openKey = (sel: string | null) => sorted(openSet(crossLinkedPlan, sel)).join(',')
    const byOpen = new Map<string, Map<string, string>>()
    let compared = 0
    let placed = 0
    for (const sel of sels) {
      const a = owners(sel)
      // the same selection gives the same decks every time, also after other selections were drawn in between
      expect(owners(sel), `${sel}`).toEqual(a)
      // two selections with the same open set put every shared closed step in the same branch deck
      const key = openKey(sel)
      const before = byOpen.get(key)
      if (before) {
        compared++
        for (const id of shared) expect(a.get(id), `${sel}: ${id}`).toBe(before.get(id))
      } else byOpen.set(key, a)
      for (const id of shared) if (a.has(id)) placed++
    }
    // the check means something: selections that share an open set, and shared steps placed in branch decks
    expect(compared).toBeGreaterThan(0)
    expect(placed).toBeGreaterThan(50)
    // the plan's own order of steps, not the order the selections were tried in, breaks ties: reversed, nothing moves
    for (const sel of [...sels].reverse()) {
      const a = owners(sel)
      const first = byOpen.get(openKey(sel))!
      for (const id of shared) expect(a.get(id), `${sel} (reversed): ${id}`).toBe(first.get(id))
    }
  })
})
