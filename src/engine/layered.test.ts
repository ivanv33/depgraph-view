import { describe, expect, it } from 'vitest'
import { countCrossings, LAYOUT, layoutPlan, layoutRuns, type Layout } from './layered.js'
import { WRAP } from './wrapRows.js'
import { edgeCurve } from './edgePath.js'
import { DOT } from './nodeLabel.js'

type In = { id: string; depends_on: string[] }
const n = (id: string, ...deps: string[]): In => ({ id, depends_on: deps })
const pitch = LAYOUT.cardH + LAYOUT.rowGap

/** Seeded PRNG (mulberry32) so the generated DAGs are the same on every run. */
function prng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A random DAG: each node depends on up to `maxDeps` earlier nodes, then the list is shuffled. */
function randomDag(seed: number, count: number, maxDeps = 3): In[] {
  const rnd = prng(seed)
  const nodes: In[] = []
  for (let i = 0; i < count; i++) {
    const deps = new Set<string>()
    const k = i === 0 ? 0 : Math.floor(rnd() * (maxDeps + 1))
    for (let j = 0; j < k; j++) deps.add(`n${Math.floor(rnd() * i)}`)
    nodes.push(n(`n${i}`, ...deps))
  }
  for (let i = nodes.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[nodes[i], nodes[j]] = [nodes[j], nodes[i]]
  }
  return nodes
}

/** Every slot (real card or virtual lane) per layer, as [centre x, width]. */
function slotsByLayer(layout: Layout) {
  const rows = new Map<number, [number, number][]>()
  const add = (layer: number, x: number, w: number) => {
    const row = rows.get(layer) ?? []
    row.push([x, w])
    rows.set(layer, row)
  }
  for (const node of layout.nodes.values()) add(node.layer, node.x, LAYOUT.cardW)
  for (const e of layout.edges) {
    if (e.redundant) continue
    const from = layout.nodes.get(e.source)!.layer
    e.points.slice(1, -1).forEach((p, i) => add(from - 1 - i, p.x, LAYOUT.laneW))
  }
  return rows
}

const json = (l: Layout) => JSON.stringify({ nodes: [...l.nodes.entries()], edges: l.edges, width: l.width, height: l.height })

describe('layoutPlan', () => {
  it('places a single node at the origin with the size of one card', () => {
    const l = layoutPlan([n('a')])
    expect(l.nodes.get('a')).toEqual({ id: 'a', layer: 0, order: 0, x: 0, y: 0 })
    expect(l.edges).toEqual([])
    expect(l.width).toBe(LAYOUT.cardW)
    expect(l.height).toBe(LAYOUT.cardH)
  })

  it('stacks a chain vertically with the goal on top, one layer per step, at equal x', () => {
    const l = layoutPlan([n('c', 'b'), n('b', 'a'), n('a')])
    const [a, b, c] = ['a', 'b', 'c'].map(id => l.nodes.get(id)!)
    expect([c.layer, b.layer, a.layer]).toEqual([0, 1, 2])
    expect([c.y, b.y, a.y]).toEqual([0, pitch, 2 * pitch])
    expect(b.x).toBe(a.x)
    expect(c.x).toBe(a.x)
    expect(l.height).toBe(2 * pitch + LAYOUT.cardH)
  })

  it('gives a node taller than a card (a deck with its list) the room it needs: the rows around it move apart', () => {
    // goal over d (200 tall) and s; d and s over a leaf each; a second goal needs b, so its edge skips the middle row
    const l = layoutPlan([n('goal', 'd', 's'), { id: 'd', depends_on: ['a'], h: 200 }, n('s', 'b'), n('a'), n('b'), n('top2', 'b')])
    const at = (id: string) => l.nodes.get(id)!
    const half = LAYOUT.cardH / 2
    const row1 = half + LAYOUT.rowGap + 100
    const row2 = row1 + 100 + LAYOUT.rowGap + half
    expect([at('goal').y, at('d').y, at('s').y, at('a').y, at('b').y]).toEqual([0, row1, row1, row2, row2])
    expect(l.height).toBe(row2 + LAYOUT.cardH)
    // edges still meet the dots, and a lane through the tall row runs at that row's centre
    const edge = l.edges.find(e => e.source === 'a')!
    expect(edge.points).toEqual([{ x: at('a').x, y: row2 - half }, { x: at('d').x, y: row1 + half }])
    const long = l.edges.find(e => e.target === 'top2')!
    expect(long.points.map(p => p.y)).toEqual([row2 - half, row1, half])
    // a height no taller than a card changes nothing
    const plain = layoutPlan([n('c', 'b'), { id: 'b', depends_on: ['a'], h: 10 }, n('a')])
    expect(plain.nodes.get('a')!.y).toBe(2 * pitch)
  })

  it('gives a node wider than a card (a deck) its room on both sides: its neighbours in the row move apart', () => {
    const row = (w?: number) => layoutPlan([n('goal', 'a', 'd', 'b'), n('a'), { id: 'd', depends_on: [], w }, n('b')])
    const plain = row()
    const wide = row(300)
    const gap = (l: Layout, x: string, y: string) => l.nodes.get(y)!.x - l.nodes.get(x)!.x
    const pitch = LAYOUT.cardW + LAYOUT.colGap
    expect(gap(plain, 'a', 'd')).toBe(pitch)
    // centre to centre: half a card, the gap, half the wide slot
    expect(gap(wide, 'a', 'd')).toBe(LAYOUT.cardW / 2 + LAYOUT.colGap + 150)
    expect(gap(wide, 'd', 'b')).toBe(LAYOUT.cardW / 2 + LAYOUT.colGap + 150)
    // a width no wider than a card changes nothing
    expect(json(row(100))).toBe(json(plain))
  })

  it('gives a node with a tail (a step drawn larger for its date) extra room on its right only', () => {
    const row = (tail?: number) => layoutPlan([n('goal', 'a', 'd', 'b'), n('a'), { id: 'd', depends_on: [], tail }, n('b')])
    const plain = row()
    const tailed = row(50)
    const gap = (l: Layout, x: string, y: string) => l.nodes.get(y)!.x - l.nodes.get(x)!.x
    const pitch = LAYOUT.cardW + LAYOUT.colGap
    expect(gap(tailed, 'a', 'd')).toBe(pitch)
    expect(gap(tailed, 'd', 'b')).toBe(pitch + 50)
    // no tail, or none to speak of, changes nothing
    expect(json(row(0))).toBe(json(plain))
  })

  it('keeps a single-child / single-parent pair straight inside a busier graph', () => {
    // p has one child q and q has one parent p; the rest pulls on their neighbours
    const l = layoutPlan([n('r'), n('p', 'r'), n('s', 'r'), n('q', 'p'), n('t', 's'), n('u', 'q', 't')])
    expect(l.nodes.get('q')!.x).toBeCloseTo(l.nodes.get('p')!.x, 6)
    expect(l.nodes.get('t')!.x).toBeCloseTo(l.nodes.get('s')!.x, 6)
  })

  it('puts every sink in the top row and every prerequisite below each of its dependents', () => {
    const l = layoutPlan([n('g1', 'a'), n('g2', 'b'), n('a', 'c'), n('b', 'c'), n('c'), n('lone')])
    for (const id of ['g1', 'g2', 'lone']) expect(l.nodes.get(id)!.layer, id).toBe(0)
    for (const seed of [11, 12, 13]) {
      const input = randomDag(seed, 30)
      const r = layoutPlan(input)
      const hasDependents = new Set(input.flatMap(x => x.depends_on))
      for (const x of input) {
        if (!hasDependents.has(x.id)) expect(r.nodes.get(x.id)!.layer, x.id).toBe(0)
        for (const d of x.depends_on) expect(r.nodes.get(d)!.y, `${d} below ${x.id}`).toBeGreaterThan(r.nodes.get(x.id)!.y)
      }
    }
  })

  it('draws edges upward from the top-centre of the prerequisite to the bottom-centre of the dependent', () => {
    const l = layoutPlan([n('a'), n('b', 'a')])
    expect(l.edges).toEqual([
      {
        source: 'a',
        target: 'b',
        redundant: false,
        points: [
          { x: 0, y: pitch - LAYOUT.cardH / 2 },
          { x: 0, y: LAYOUT.cardH / 2 },
        ],
      },
    ])
  })

  it('lays out a diamond symmetrically with no crossings', () => {
    const l = layoutPlan([n('a'), n('b', 'a'), n('c', 'a'), n('d', 'b', 'c')])
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(id => l.nodes.get(id)!)
    expect(a.x).toBeCloseTo(0, 6)
    expect(d.x).toBeCloseTo(0, 6)
    expect(b.x).toBeCloseTo(-c.x, 6)
    expect(Math.abs(c.x - b.x)).toBeGreaterThanOrEqual(LAYOUT.cardW + LAYOUT.colGap - 1e-6)
    expect(countCrossings(l)).toBe(0)
  })

  it('reorders a row whose input order has crossings', () => {
    // input order puts c under a and d under b, but c needs b and d needs a
    const l = layoutPlan([n('a'), n('b'), n('c', 'b'), n('d', 'a')])
    expect(countCrossings(l)).toBe(0)
    const x = (id: string) => l.nodes.get(id)!.x
    expect(x('a') < x('b')).toBe(x('d') < x('c'))
  })

  it('removes the crossings from a busier graph whose input order has them', () => {
    const input = [n('r1'), n('r2'), n('r3'), n('x', 'r3'), n('y', 'r1'), n('z', 'r2'), n('w', 'z', 'x'), n('v', 'y')]
    expect(countCrossings(layoutPlan(input))).toBe(0)
  })

  it('never puts two slots in a row closer than the minimum separation', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const l = layoutPlan(randomDag(seed, 30))
      for (const row of slotsByLayer(l).values()) {
        row.sort((p, q) => p[0] - q[0])
        for (let i = 1; i < row.length; i++) {
          const [x0, w0] = row[i - 1]
          const [x1, w1] = row[i]
          expect(x1 - x0).toBeGreaterThanOrEqual(w0 / 2 + LAYOUT.colGap + w1 / 2 - 1e-6)
        }
      }
    }
  })

  it('routes a long edge through one virtual point per skipped layer, clear of every card', () => {
    // y0 <- y1 <- y2 <- y3 <- x is a chain of prerequisites; the goal t also needs x, so x -> t skips layers 3..1
    const l = layoutPlan([n('t', 'x'), n('y0', 'y1'), n('y1', 'y2'), n('y2', 'y3'), n('y3', 'x'), n('x')])
    const edge = l.edges.find(e => e.source === 'x' && e.target === 't')!
    expect(edge.redundant).toBe(false)
    const from = l.nodes.get('x')!
    const to = l.nodes.get('t')!
    expect(from.layer - to.layer).toBe(4)
    expect(edge.points).toHaveLength(2 + 3)
    expect(edge.points[0]).toEqual({ x: from.x, y: from.y - LAYOUT.cardH / 2 })
    expect(edge.points.at(-1)).toEqual({ x: to.x, y: to.y + LAYOUT.cardH / 2 })
    edge.points.slice(1, -1).forEach((p, i) => {
      const layer = from.layer - 1 - i
      expect(p.y).toBe(layer * pitch)
      for (const node of l.nodes.values()) {
        if (node.layer !== layer) continue
        const inside = Math.abs(p.x - node.x) <= LAYOUT.cardW / 2 && Math.abs(p.y - node.y) <= LAYOUT.cardH / 2
        expect(inside, `virtual point in layer ${layer} lies on ${node.id}`).toBe(false)
      }
    })
  })

  it('marks an edge implied by a longer path as redundant, and nothing else', () => {
    const l = layoutPlan([n('a'), n('b', 'a'), n('c', 'b', 'a')])
    const flags = Object.fromEntries(l.edges.map(e => [`${e.source}->${e.target}`, e.redundant]))
    expect(flags).toEqual({ 'a->b': false, 'b->c': false, 'a->c': true })
    const ac = l.edges.find(e => e.source === 'a' && e.target === 'c')!
    expect(ac.points).toEqual([
      { x: l.nodes.get('a')!.x, y: 2 * pitch - LAYOUT.cardH / 2 },
      { x: l.nodes.get('c')!.x, y: LAYOUT.cardH / 2 },
    ])
  })

  it('is deterministic: the same input gives byte-identical output', () => {
    for (const seed of [7, 8]) {
      const input = randomDag(seed, 40)
      expect(json(layoutPlan(input))).toBe(json(layoutPlan(structuredClone(input))))
    }
  })

  it('ignores dependencies on ids that do not exist', () => {
    const l = layoutPlan([n('a', 'ghost'), n('b', 'a', 'nobody')])
    expect(l.nodes.get('a')!.layer).toBe(1)
    expect(l.nodes.get('b')!.layer).toBe(0)
    expect(l.edges.map(e => `${e.source}->${e.target}`)).toEqual(['a->b'])
  })

  it('does not hang on a cycle: the back edge is ignored', () => {
    const l = layoutPlan([n('a', 'c'), n('b', 'a'), n('c', 'b')])
    expect(l.nodes.size).toBe(3)
    const layers = ['a', 'b', 'c'].map(id => l.nodes.get(id)!.layer)
    expect(new Set(layers).size).toBe(3)
    expect(l.edges.length).toBe(2)
  })

  it('reports the bounding box of all cards, centred on x = 0', () => {
    const l = layoutPlan([n('a'), n('b'), n('c', 'a', 'b')])
    const xs = [...l.nodes.values()].map(v => v.x)
    expect(l.width).toBeCloseTo(Math.max(...xs) - Math.min(...xs) + LAYOUT.cardW, 6)
    expect(l.height).toBe(pitch + LAYOUT.cardH)
    expect((Math.max(...xs) + Math.min(...xs)) / 2).toBeCloseTo(0, 6)
  })

  it('lays out 200 nodes quickly', () => {
    const input = randomDag(42, 200)
    layoutPlan(input) // warm up the JIT
    const t0 = performance.now()
    layoutPlan(input)
    expect(performance.now() - t0).toBeLessThan(250)
  })
})

describe('countCrossings', () => {
  it('counts an arrow from a lower row of a block in the gap above the block, and only there', () => {
    // g (row 0) needs h and u (row 1); h's block is row 2: s0 on its first row, s1 on its second (one lane point);
    // w sits beside the block in row 2 and is needed by u
    const node = (id: string, layer: number, x: number, y: number, order = 0) => [id, { id, layer, order, x, y }] as const
    const nodes = new Map([node('g', 0, 0, 0), node('h', 1, 100, 122), node('u', 1, 300, 122, 1), node('s0', 2, -40, 244), node('s1', 2, -40, 324), node('w', 2, -100, 244, 2)])
    const base: Layout = {
      nodes,
      width: 0,
      height: 0,
      edges: [
        { source: 'h', target: 'g', redundant: false, points: [{ x: 0, y: 100 }, { x: 0, y: 22 }] },
        { source: 'u', target: 'g', redundant: false, points: [{ x: 300, y: 100 }, { x: 0, y: 22 }] },
        { source: 's0', target: 'h', redundant: false, points: [{ x: -40, y: 222 }, { x: 100, y: 144 }] },
        // its last segment climbs from the lane (left of h's x) to h, in the gap between rows 2 and 1
        { source: 's1', target: 'h', redundant: false, points: [{ x: -40, y: 302 }, { x: -50, y: 244 }, { x: 100, y: 144 }] },
      ],
    }
    // nothing crosses: the lane's climb must not be compared with the arrows between rows 1 and 0 (it would cross h -> g)
    expect(countCrossings(base)).toBe(0)
    // w -> u starts left of the lane and ends right of h: it crosses both arrows into h in the gap under row 1
    const crossed: Layout = { ...base, edges: [...base.edges, { source: 'w', target: 'u', redundant: false, points: [{ x: -100, y: 222 }, { x: 300, y: 144 }] }] }
    expect(countCrossings(crossed)).toBe(2)
  })

  it('counts crossings between non-redundant edges only', () => {
    const l = layoutPlan([n('a'), n('b'), n('c', 'b'), n('d', 'a')])
    const at: Record<string, number> = { a: 0, b: 300, c: 0, d: 300 }
    const crossed: Layout = {
      ...l,
      nodes: new Map([...l.nodes].map(([id, v]) => [id, { ...v, x: at[id] }])),
      edges: [
        { source: 'b', target: 'c', redundant: false, points: [{ x: 300, y: 22 }, { x: 0, y: 100 }] },
        { source: 'a', target: 'd', redundant: false, points: [{ x: 0, y: 22 }, { x: 300, y: 100 }] },
      ],
    }
    expect(countCrossings(crossed)).toBe(1)
    crossed.edges[0].redundant = true
    expect(countCrossings(crossed)).toBe(0)
  })
})

describe('layoutPlan: many needs of one step wrap into a block', () => {
  const sub = LAYOUT.cardH + WRAP.subGap
  /** goal over side, hub and other; hub over `count` steps needing nothing; side over one step. */
  const plan = (count: number): (In & { h?: number; w?: number; tail?: number })[] => [
    n('goal', 'side', 'hub', 'other'),
    n('side', 'side1'),
    n('side1'),
    n('hub', ...Array.from({ length: count }, (_, i) => `s${i}`)),
    n('other'),
    ...Array.from({ length: count }, (_, i) => n(`s${i}`)),
  ]
  const ids = (count: number) => Array.from({ length: count }, (_, i) => `s${i}`)

  it('lays seven needs out as rows of four and three under their step, in reading order, columns aligned', () => {
    const l = layoutPlan(plan(7))
    const at = (id: string) => l.nodes.get(id)!
    const hub = at('hub')
    const s = ids(7).map(at)
    for (const v of s) expect(v.layer, v.id).toBe(hub.layer + 1)
    const top = hub.y + LAYOUT.cardH / 2 + LAYOUT.rowGap + LAYOUT.cardH / 2
    expect(s.map(v => v.y)).toEqual([top, top, top, top, top + sub, top + sub, top + sub])
    // reading order: the second row starts under the first column
    for (let i = 0; i < 3; i++) expect(s[4 + i].x).toBeCloseTo(s[i].x, 9)
    for (let i = 1; i < 4; i++) expect(s[i].x).toBeGreaterThan(s[i - 1].x + LAYOUT.cardW + LAYOUT.colGap - 1e-9)
    // the order runs through the block row by row
    expect(s.map(v => v.order)).toEqual(s.map((_, i) => s[0].order + i))
    // the step sits over its block
    expect(hub.x).toBeGreaterThan(Math.min(...s.map(v => v.x)))
    expect(hub.x).toBeLessThan(Math.max(...s.map(v => v.x)))
    // and straight over it, centred, when nothing beside it is in the way
    const alone = layoutPlan([n('hub', ...ids(7)), ...ids(7).map(id => n(id))])
    const cols = ids(4).map(id => alone.nodes.get(id)!.x)
    expect(alone.nodes.get('hub')!.x).toBeCloseTo((cols[0] + cols[3]) / 2 - WRAP.laneRoom / 2, 6)
  })

  it('is at most 0.7 of the width of the same needs in one line', () => {
    for (const count of [5, 7, 12, 20]) {
      const l = layoutPlan(plan(count))
      const s = ids(count).map(id => l.nodes.get(id)!)
      const block = Math.max(...s.map(v => v.x)) - Math.min(...s.map(v => v.x)) + LAYOUT.cardW
      const line = count * LAYOUT.cardW + (count - 1) * LAYOUT.colGap
      expect(block / line, `${count}`).toBeLessThanOrEqual(0.7)
    }
  })

  it('keeps fewer than WRAP.min needs in one line', () => {
    const l = layoutPlan(plan(WRAP.min - 1))
    const ys = new Set(ids(WRAP.min - 1).map(id => l.nodes.get(id)!.y))
    expect(ys.size).toBe(1)
    expect([...ys][0]).toBe(l.nodes.get('side1')!.y)
  })

  it('moves the rows under the block down below its last row, and leaves the steps beside it on its first row', () => {
    // side1 needs deep, so a row under the block's row holds deep
    const l = layoutPlan([...plan(12).map(x => (x.id === 'side1' ? n('side1', 'deep') : x)), n('deep')])
    const at = (id: string) => l.nodes.get(id)!
    const s = ids(12).map(at)
    const bottom = Math.max(...s.map(v => v.y))
    expect(at('side1').y).toBe(s[0].y)
    expect(bottom - s[0].y).toBe(2 * sub)
    expect(at('deep').y).toBe(bottom + LAYOUT.cardH + LAYOUT.rowGap)
    expect(l.height).toBe(at('deep').y + LAYOUT.cardH)
    // and no card of the block meets the card beside it
    for (const v of s) {
      const o = at('side1')
      const meet = Math.abs(v.x - o.x) < LAYOUT.cardW + LAYOUT.colGap && Math.abs(v.y - o.y) < LAYOUT.cardH
      expect(meet, v.id).toBe(false)
    }
  })

  it('draws a need on the first row straight to its step, and one lower down up its column lane, past the rows above it', () => {
    const l = layoutPlan(plan(12))
    const at = (id: string) => l.nodes.get(id)!
    const hub = at('hub')
    const edge = (id: string) => l.edges.find(e => e.source === id)!
    expect(edge('s1').points).toEqual([
      { x: at('s1').x, y: at('s1').y - LAYOUT.cardH / 2 },
      { x: hub.x, y: hub.y + LAYOUT.cardH / 2 },
    ])
    // s9 is the second column of the third row: its lane points sit on the two rows above it, left of that column
    const p = edge('s9').points
    expect(p).toHaveLength(4)
    expect(p[0]).toEqual({ x: at('s9').x, y: at('s9').y - LAYOUT.cardH / 2 })
    expect(p.at(-1)).toEqual({ x: hub.x, y: hub.y + LAYOUT.cardH / 2 })
    expect(p.slice(1, -1).map(q => q.y)).toEqual([at('s5').y, at('s1').y])
    for (const q of p.slice(1, -1)) {
      expect(q.x).toBe(p[1].x)
      // between the first column's words and the second column's circle
      expect(q.x).toBeLessThan(at('s1').x - LAYOUT.cardW / 2)
      expect(q.x).toBeGreaterThan(at('s0').x + LAYOUT.cardW / 2 + 20)
    }
    expect(countCrossings(l)).toBe(0)
  })

  it('every need sits below the step that needs it, and every edge ends on its two cards', () => {
    for (const count of [5, 7, 12, 20]) {
      const l = layoutPlan(plan(count))
      for (const e of l.edges) {
        const s = l.nodes.get(e.source)!
        const t = l.nodes.get(e.target)!
        expect(s.y, `${e.source} under ${e.target}`).toBeGreaterThan(t.y)
        expect(e.points[0]).toEqual({ x: s.x, y: s.y - LAYOUT.cardH / 2 })
        expect(e.points.at(-1)).toEqual({ x: t.x, y: t.y + LAYOUT.cardH / 2 })
      }
    }
  })

  it('never wraps a deck or a need another step also needs, nor a need with needs of its own too deep to wrap', () => {
    const oneRow = (l: Layout, list: string[]) => new Set(list.map(id => l.nodes.get(id)!.y)).size === 1
    // s0 is a deck (taller and wider than a card): it stays on the plan's row, and the six others still wrap
    const decked = layoutPlan(plan(7).map(x => (x.id === 's0' ? { ...x, h: 120, w: 300 } : x)))
    expect(decked.nodes.get('s0')!.y).toBe(decked.nodes.get('side1')!.y)
    expect(oneRow(decked, ids(7).slice(1))).toBe(false)
    // with only four plain needs left, nothing wraps
    expect(oneRow(layoutPlan(plan(5).map(x => (x.id === 's0' ? { ...x, h: 120 } : x))), ids(5))).toBe(true)
    expect(oneRow(layoutPlan(plan(5).map(x => (x.id === 's0' ? { ...x, w: 300 } : x))), ids(5))).toBe(true)
    // s0 also needed by another step: four left
    expect(oneRow(layoutPlan(plan(5).map(x => (x.id === 'other' ? n('other', 's0') : x))), ids(5).slice(1))).toBe(true)
    // s0 needs a chain of steps of its own, too deep to wrap with it (WRAP.wide): four left
    expect(oneRow(layoutPlan([...plan(5).map(x => (x.id === 's0' ? n('s0', 'z1') : x)), n('z1', 'z2'), n('z2', 'z3'), n('z3')]), ids(5).slice(1))).toBe(true)
  })

  it('makes room in the block for the widest date among its steps', () => {
    const plain = layoutPlan(plan(7))
    const dated = layoutPlan(plan(7).map(x => (x.id === 's2' ? { ...x, tail: 40 } : x)))
    const gap = (l: Layout) => l.nodes.get('s1')!.x - l.nodes.get('s0')!.x
    expect(gap(dated) - gap(plain)).toBe(40)
  })

  it('keeps every other arrow out of a block: one into a step beside it climbs straight up beside it, and so does a long one passing it', () => {
    const leaves = (p: string, k: number) => Array.from({ length: k }, (_, i) => `${p}${i}`)
    const cases = [
      // goal needs hub and x; hub needs 12 leaves; x needs m; m needs 8 leaves (the arrows from m's leaves into m start
      // under the hub's block)
      [n('goal', 'hub', 'x'), n('hub', ...leaves('h', 12)), n('x', 'm'), n('m', ...leaves('y', 8)), ...leaves('h', 12).map(id => n(id)), ...leaves('y', 8).map(id => n(id))],
      // the same with the goal also needing a deep step straight: its long arrow passes the hub's block row
      [n('goal', 'hub', 'x', 'deep'), n('hub', ...leaves('h', 12)), n('x', 'm'), n('m', 'deep', 'y0'), n('deep'), n('y0'), ...leaves('h', 12).map(id => n(id))],
      // two blocks side by side, a step needing both their parents' rows
      [n('goal', 'a', 'b', 'c'), n('a', ...leaves('a', 9)), n('b', ...leaves('b', 7)), n('c', 'd'), n('d', 'e'), n('e'), ...leaves('a', 9).map(id => n(id)), ...leaves('b', 7).map(id => n(id))],
    ]
    for (const input of cases) {
      const l = layoutPlan(input)
      const blocks = new Map<string, string[]>()
      for (const x of input) {
        const ws = x.depends_on.filter(d => input.find(o => o.id === d)!.depends_on.length === 0 && input.filter(o => o.depends_on.includes(d)).length === 1)
        if (ws.length >= WRAP.min) blocks.set(x.id, ws)
      }
      expect(blocks.size).toBeGreaterThan(0)
      for (const [parent, members] of blocks) {
        const at = members.map(id => l.nodes.get(id)!)
        const box = {
          left: Math.min(...at.map(v => v.x)) - LAYOUT.cardW / 2,
          right: Math.max(...at.map(v => v.x)) + LAYOUT.cardW / 2 + 20,
          top: Math.min(...at.map(v => v.y)) - LAYOUT.cardH / 2,
          bottom: Math.max(...at.map(v => v.y)) + LAYOUT.cardH / 2,
        }
        for (const e of l.edges) {
          if (members.includes(e.source) || e.redundant) continue
          const { line } = edgeCurve(e.points, { cardH: LAYOUT.cardH, cardScale: 1, arrow: 8, dx: LAYOUT.cardW / 2 - DOT.cx, reach: DOT.reach })
          for (const q of line) {
            const inside = q.x > box.left && q.x < box.right && q.y > box.top && q.y < box.bottom
            expect(inside, `${e.source} -> ${e.target} enters ${parent}'s block at (${q.x.toFixed(0)}, ${q.y.toFixed(0)})`).toBe(false)
          }
        }
      }
    }
  })

  it('is deterministic', () => {
    expect(json(layoutPlan(plan(20)))).toBe(json(layoutPlan(structuredClone(plan(20)))))
  })
})

describe('layoutPlan: needs with needs of their own wrap too', () => {
  const sub = LAYOUT.cardH + WRAP.subGap
  /** hub over `count` needs, each over `leaves` steps of its own; the goal over hub and a side step with one need. */
  const plan = (count: number, leaves = 2): In[] => [
    n('goal', 'side', 'hub'),
    n('side', 'side1'),
    n('side1'),
    n('hub', ...Array.from({ length: count }, (_, i) => `m${i}`)),
    ...Array.from({ length: count }, (_, i) => n(`m${i}`, ...Array.from({ length: leaves }, (_, k) => `m${i}-${k}`))),
    ...Array.from({ length: count }, (_, i) => Array.from({ length: leaves }, (_, k) => n(`m${i}-${k}`))).flat(),
  ]
  const mids = (count: number) => Array.from({ length: count }, (_, i) => `m${i}`)
  const under = (m: string, leaves = 2) => Array.from({ length: leaves }, (_, k) => `${m}-${k}`)

  it('lays eight needs of two needs each out as two bands of four, each need with its own needs right under it', () => {
    const l = layoutPlan(plan(8))
    const at = (id: string) => l.nodes.get(id)!
    const m = mids(8).map(at)
    // two bands, in reading order: the second band starts under the first column
    expect(new Set(m.slice(0, 4).map(v => v.y)).size).toBe(1)
    expect(new Set(m.slice(4).map(v => v.y)).size).toBe(1)
    expect(m[4].y).toBeGreaterThan(m[0].y)
    for (let i = 0; i < 4; i++) expect(m[4 + i].x).toBeCloseTo(m[i].x, 6)
    // each need's own needs sit one plan row under it, around it
    for (const v of m)
      for (const id of under(v.id)) {
        expect(at(id).y, id).toBe(v.y + LAYOUT.cardH + LAYOUT.rowGap)
        expect(Math.abs(at(id).x - v.x), id).toBeLessThan(LAYOUT.cardW + LAYOUT.colGap)
      }
    // the second band sits a block gap under the first band's lowest steps
    const bottom = Math.max(...mids(4).flatMap(id => under(id)).map(id => at(id).y))
    expect(m[4].y).toBe(bottom + sub)
    // the logical layers are kept: needs on hub's layer + 1, theirs on + 2
    for (const v of m) expect(v.layer).toBe(at('hub').layer + 1)
    for (const id of under('m5')) expect(at(id).layer).toBe(at('hub').layer + 2)
  })

  it('is at most 0.7 of the width of the same branches in one line, and nothing meets', () => {
    for (const count of [5, 8, 12]) {
      const l = layoutPlan(plan(count))
      const all = [...l.nodes.values()].filter(v => v.id.startsWith('m'))
      const span = Math.max(...all.map(v => v.x)) - Math.min(...all.map(v => v.x)) + LAYOUT.cardW
      const line = 2 * count * LAYOUT.cardW + (2 * count - 1) * LAYOUT.colGap
      expect(span / line, `${count}`).toBeLessThanOrEqual(0.7)
      const cards = [...l.nodes.values()]
      for (let i = 0; i < cards.length; i++)
        for (let j = i + 1; j < cards.length; j++) {
          const a = cards[i]
          const b = cards[j]
          const meet = Math.abs(a.x - b.x) < LAYOUT.cardW + LAYOUT.colGap - 1e-6 && Math.abs(a.y - b.y) < LAYOUT.cardH + WRAP.subGap - 1e-6
          expect(meet, `${count}: ${a.id} meets ${b.id}`).toBe(false)
        }
    }
  })

  it('every step sits below the steps that need it, and no arrow runs through a card it does not end on', () => {
    for (const count of [5, 8, 12]) {
      const l = layoutPlan(plan(count, 3))
      for (const e of l.edges) {
        const s = l.nodes.get(e.source)!
        const t = l.nodes.get(e.target)!
        expect(s.y, `${e.source} under ${e.target}`).toBeGreaterThan(t.y)
        expect(e.points[0]).toEqual({ x: s.x, y: s.y - LAYOUT.cardH / 2 })
        expect(e.points.at(-1)).toEqual({ x: t.x, y: t.y + LAYOUT.cardH / 2 })
        const { line } = edgeCurve(e.points, { cardH: LAYOUT.cardH, cardScale: 1, arrow: 8, dx: LAYOUT.cardW / 2 - DOT.cx, reach: DOT.reach })
        for (const v of l.nodes.values()) {
          if (v.id === e.source || v.id === e.target) continue
          // the card's circle and words: from just left of its circle to its right edge
          const box = { left: v.x - LAYOUT.cardW / 2 + DOT.cx - 16, right: v.x + LAYOUT.cardW / 2, top: v.y - LAYOUT.cardH / 2, bottom: v.y + LAYOUT.cardH / 2 }
          for (const q of line) {
            const inside = q.x > box.left && q.x < box.right && q.y > box.top && q.y < box.bottom
            expect(inside, `${count}: ${e.source} -> ${e.target} runs through ${v.id} at (${q.x.toFixed(0)}, ${q.y.toFixed(0)})`).toBe(false)
          }
        }
      }
    }
  })

  it('turns an arrow from a lower band toward its need well clear of the circles of the band above', () => {
    for (const count of [6, 8, 9]) {
      const l = layoutPlan(plan(count))
      const lower = mids(count).filter(id => l.nodes.get(id)!.y > l.nodes.get('m0')!.y)
      expect(lower.length, `${count}`).toBeGreaterThan(0)
      // under and right of a circle: where the arrow turns from its lane toward its need, under the band above
      // (it turned 41.9 units from their middle, 51.4 since it turns half a gap lower)
      for (const id of lower) {
        const e = l.edges.find(e => e.source === id)!
        const { line } = edgeCurve(e.points, { cardH: LAYOUT.cardH, cardScale: 1, arrow: 8, dx: LAYOUT.cardW / 2 - DOT.cx, reach: DOT.reach })
        for (const v of l.nodes.values()) {
          if (v.id === e.source || v.id === e.target) continue
          const cx = v.x - LAYOUT.cardW / 2 + DOT.cx
          const near = Math.min(...line.filter(q => q.y > v.y && q.x > cx - 1).map(q => Math.hypot(q.x - cx, q.y - v.y)))
          expect(near, `${count}: ${id}'s arrow turns ${near.toFixed(1)} from ${v.id}'s circle`).toBeGreaterThanOrEqual(50)
        }
      }
    }
  })

  it('tells a step in a row a lane runs past where every lane there is: right of its circle in the layout or not, and no lane elsewhere', () => {
    const l = layoutPlan(plan(9))
    const at = (id: string) => l.nodes.get(id)!
    const cx = (id: string) => at(id).x - LAYOUT.cardW / 2 + DOT.cx
    // the lane up column 1 runs past the first two bands' rows: their last step in column 0 has it as its nearest lane
    // right of its circle (as the layout puts it)
    const lane = l.edges.find(e => e.source === 'm4')!.points[1].x
    const nearest = (id: string) => at(id).walls!.find(w => at(id).x + w > cx(id))
    for (const id of ['m0-1', 'm3-1', 'm0', 'm3']) expect(nearest(id), id).toBeCloseTo(lane - at(id).x, 9)
    expect(lane).toBeGreaterThan(cx('m0-1'))
    expect(lane).toBeLessThan(cx('m1-0'))
    // and the steps right of it in those rows have it too, left of their circles: past the card floor a card draws
    // larger about its centre, its circle moves left on screen, and a lane just left of it in the layout is drawn right
    // of it (titleFitDom decides that at the zoom)
    for (const id of ['m1-0', 'm1']) expect(at(id).walls!.some(w => Math.abs(at(id).x + w - lane) < 1e-9), id).toBe(true)
    // each step's lanes sorted left to right, each once
    for (const v of l.nodes.values()) if (v.walls) expect(v.walls, v.id).toEqual([...new Set(v.walls)].sort((a, b) => a - b))
    // the last band has no lane past it; nor has the goal, nor a plan without a block
    for (const id of ['m6', 'm6-1', 'goal', 'hub']) expect(at(id).walls, id).toBeUndefined()
    for (const v of layoutPlan([n('a', 'b', 'c'), n('b'), n('c')]).nodes.values()) expect(v.walls).toBeUndefined()
  })

  it('lays each branch out once, however many blocks around it are tried and do not wrap: a 65-step plan in 21 runs', () => {
    // five levels: each hub needs the next hub and four steps that each need a chain of two; a block is tried at every
    // level and the level under it is tried again inside it (laid out afresh each time, this plan took 36 runs, and
    // seven levels of chains of four 196, doubling with each level)
    const levels = 5
    const steps: In[] = []
    for (let k = 0; k < levels; k++) {
      const side = Array.from({ length: 4 }, (_, i) => `a${k}-${i}`)
      steps.push(n(`h${k}`, ...(k + 1 < levels ? [`h${k + 1}`] : []), ...side))
      for (const id of side) steps.push(n(id, `${id}-0`), n(`${id}-0`, `${id}-1`), n(`${id}-1`))
    }
    expect(steps.length).toBe(65)
    layoutRuns.count = 0
    layoutPlan(steps)
    // the plan, then each level's hub branch and its four side branches once
    expect(layoutRuns.count).toBe(1 + 5 * (levels - 1))
  })

  it('runs the arrow from a need in the second band up its column lane, past the first band and its needs', () => {
    const l = layoutPlan(plan(8))
    const at = (id: string) => l.nodes.get(id)!
    const p = l.edges.find(e => e.source === 'm5')!.points
    const lane = p.slice(1, -1)
    expect(lane.length).toBeGreaterThanOrEqual(2)
    for (const q of lane) expect(q.x).toBe(lane[0].x)
    // left of the second column, right of the first column's words
    const firstCol = [at('m0'), ...under('m0').map(at)]
    expect(lane[0].x).toBeLessThan(Math.min(at('m1').x, ...under('m1').map(id => at(id).x)) - LAYOUT.cardW / 2)
    expect(lane[0].x).toBeGreaterThan(Math.max(...firstCol.map(v => v.x)) + LAYOUT.cardW / 2 + 20)
    // it climbs from half a gap under the first band's lowest row to the first band's row
    expect(lane[0].y).toBe(at('m0-0').y + WRAP.subGap / 2)
    expect(lane.at(-1)!.y).toBe(at('m1').y)
  })

  it('moves the plan rows under the block below its lowest step, with no empty row left', () => {
    const l = layoutPlan([...plan(8).map(x => (x.id === 'side1' ? n('side1', 'deep') : x)), n('deep', 'deeper'), n('deeper')])
    const at = (id: string) => l.nodes.get(id)!
    const bottom = Math.max(...[...l.nodes.values()].filter(v => v.id.startsWith('m')).map(v => v.y))
    expect(at('side1').y).toBe(at('m0').y)
    expect(at('deep').y).toBe(bottom + LAYOUT.cardH + LAYOUT.rowGap)
    expect(at('deeper').y).toBe(at('deep').y + pitch)
    expect(l.height).toBe(at('deeper').y + LAYOUT.cardH)
    // and with nothing under the block, the plan ends at the block's lowest step
    const alone = layoutPlan(plan(8))
    const low = Math.max(...[...alone.nodes.values()].map(v => v.y))
    expect(alone.height).toBe(low + LAYOUT.cardH)
  })

  it('wraps a mix of needs with and without needs of their own into one block', () => {
    const input = plan(6)
      .map(x => (x.id === 'm1' || x.id === 'm3' ? n(x.id) : x))
      .filter(x => !/^m[13]-/.test(x.id))
    const l = layoutPlan(input)
    expect(new Set(mids(6).map(id => l.nodes.get(id)!.y)).size).toBe(2)
    // four steps that need nothing and one with a need of its own: the five wrap, where the four alone would not
    const five = layoutPlan([n('hub', 's0', 's1', 's2', 's3', 's4'), n('s0', 'z'), n('z'), ...['s1', 's2', 's3', 's4'].map(id => n(id))])
    expect(new Set(['s0', 's1', 's2', 's3', 's4'].map(id => five.nodes.get(id)!.y)).size).toBe(2)
    expect(five.nodes.get('z')!.y).toBeLessThan(five.nodes.get('s3')!.y)
  })

  it('keeps branches in one line when wrapping would make the block taller than half its width', () => {
    // five needs, one a chain four deep: two bands would be about as tall as wide
    const input = [n('goal', 'a', 'b', 'c', 'd', 'e'), n('a', 'a1'), n('a1', 'a2'), n('a2', 'a3'), n('a3'), n('b'), n('c'), n('d'), n('e', 'e1'), n('e1')]
    const l = layoutPlan(input)
    expect(new Set(['a', 'b', 'c', 'd', 'e'].map(id => l.nodes.get(id)!.y)).size).toBe(1)
  })

  it('never wraps a need whose own needs are needed from outside it', () => {
    // m0-0 is also needed by side: m0 stays on the plan row beside the block, the seven others wrap
    const l = layoutPlan(plan(8).map(x => (x.id === 'side' ? n('side', 'side1', 'm0-0') : x)))
    const at = (id: string) => l.nodes.get(id)!
    const rest = mids(8).slice(1).map(at)
    expect(new Set(rest.map(v => v.y)).size).toBe(2)
    expect(at('m0').y).toBe(rest[0].y)
    expect(at('m0').y).toBe(at('side1').y)
  })

  it('never wraps two needs that share a step under them, and wraps the rest', () => {
    // m0 and m1 both need m0-0: neither branch is m0's or m1's alone, so both stay on the plan row; the six others wrap
    const l = layoutPlan(plan(8).map(x => (x.id === 'm1' ? n('m1', 'm1-0', 'm1-1', 'm0-0') : x)))
    const at = (id: string) => l.nodes.get(id)!
    const rest = mids(8).slice(2).map(at)
    expect(new Set(rest.map(v => v.y)).size).toBe(2)
    expect(at('m0').y).toBe(rest[0].y)
    expect(at('m1').y).toBe(rest[0].y)
    // the shared step is under both, on the plan's next row
    expect(at('m0-0').y).toBeGreaterThan(at('m1').y)
    expect(at('m0-0').y).toBe(at('m1-1').y)
  })

  it('wraps a block inside a branch: a need with five steps of its own wraps them under it, and its branch wraps with the rest', () => {
    // m0 needs five steps that need nothing: they wrap into two rows under m0, inside the block of m0..m5
    const input = plan(6)
      .map(x => (x.id === 'm0' ? n('m0', ...Array.from({ length: 5 }, (_, k) => `m0-${k}`)) : x))
      .concat(['m0-2', 'm0-3', 'm0-4'].map(id => n(id)))
    const l = layoutPlan(input)
    const at = (id: string) => l.nodes.get(id)!
    expect(new Set(mids(6).map(id => at(id).y)).size).toBe(2)
    const inner = Array.from({ length: 5 }, (_, k) => at(`m0-${k}`))
    expect(new Set(inner.map(v => v.y)).size).toBe(2)
    for (const v of inner) expect(v.y).toBeGreaterThan(at('m0').y)
    // the second band starts under m0's lowest step
    expect(at('m3').y).toBeGreaterThan(Math.max(...inner.map(v => v.y)))
    // m0's arrows come from its own layout, from each step's top to m0's bottom
    for (const v of inner) {
      const e = l.edges.find(e => e.source === v.id && e.target === 'm0')!
      expect(e.points[0]).toEqual({ x: v.x, y: v.y - LAYOUT.cardH / 2 })
      expect(e.points.at(-1)).toEqual({ x: at('m0').x, y: at('m0').y + LAYOUT.cardH / 2 })
    }
  })

  it('reads a block of branches in order, band by band, keeping the layers', () => {
    const l = layoutPlan(plan(8))
    const m = mids(8).map(id => l.nodes.get(id)!)
    expect(m.map(v => v.order)).toEqual(m.map((_, i) => m[0].order + i))
    const leaves = [...l.nodes.values()].filter(v => v.layer === l.nodes.get('m0-0')!.layer).sort((a, b) => a.order - b.order)
    expect(leaves.map(v => v.order)).toEqual(leaves.map((_, i) => i))
    // reading order: the first band's needs first, left to right
    expect(leaves.slice(0, 8).map(v => v.id)).toEqual(mids(4).flatMap(id => under(id)))
  })

  it('is deterministic', () => {
    expect(json(layoutPlan(plan(12)))).toBe(json(layoutPlan(structuredClone(plan(12)))))
  })
})

describe('layoutPlan: needs whose own needs are shared wrap as cards', () => {
  const sub = LAYOUT.cardH + WRAP.subGap
  const xs = (count: number) => Array.from({ length: count }, (_, i) => `x${i}`)
  /**
   * The goal over two areas: area a over `count` needs, area b over three; each need of either needs one or two of four
   * shared steps z0..z3 (so no need's branch is its own, and none needs nothing).
   */
  const plan = (count: number): In[] => [
    n('goal', 'a', 'b'),
    n('a', ...xs(count)),
    n('b', 'y0', 'y1', 'y2'),
    ...xs(count).map((id, i) => n(id, `z${i % 4}`, ...(i % 3 === 0 ? [`z${(i + 1) % 4}`] : []))),
    n('y0', 'z0'),
    n('y1', 'z1', 'z2'),
    n('y2', 'z3'),
    ...['z0', 'z1', 'z2', 'z3'].map(id => n(id)),
  ]
  const opts = { cardH: LAYOUT.cardH, cardScale: 1, arrow: 8, dx: LAYOUT.cardW / 2 - DOT.cx, reach: DOT.reach }

  it("wraps an area's nine needs into rows of three under it, the shared steps below the block", () => {
    const l = layoutPlan(plan(9))
    const at = (id: string) => l.nodes.get(id)!
    const x = xs(9).map(at)
    expect(x.map(v => v.y)).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 2].map(k => x[0].y + k * sub))
    for (let i = 3; i < 9; i++) expect(x[i].x).toBeCloseTo(x[i % 3].x, 9)
    for (const v of x) expect(v.layer).toBe(at('a').layer + 1)
    // b's three needs stay on the plan's row, beside the block's first row
    for (const id of ['y0', 'y1', 'y2']) expect(at(id).y).toBe(x[0].y)
    // the shared steps sit a plan row under the block's last row
    for (const id of ['z0', 'z1', 'z2', 'z3']) expect(at(id).y).toBe(x[8].y + LAYOUT.cardH + LAYOUT.rowGap)
    // the order reads the block row by row
    expect(x.map(v => v.order)).toEqual(x.map((_, i) => x[0].order + i))
  })

  it('is much narrower than the same needs in one line', () => {
    for (const count of [5, 9, 18]) {
      const l = layoutPlan(plan(count))
      const x = xs(count).map(id => l.nodes.get(id)!)
      const block = Math.max(...x.map(v => v.x)) - Math.min(...x.map(v => v.x)) + LAYOUT.cardW
      const line = count * LAYOUT.cardW + (count - 1) * LAYOUT.colGap
      expect(block / line, `${count}`).toBeLessThanOrEqual(0.7)
    }
  })

  it('keeps fewer than WRAP.min such needs in one line', () => {
    const l = layoutPlan(plan(WRAP.min - 1))
    expect(new Set(xs(WRAP.min - 1).map(id => l.nodes.get(id)!.y)).size).toBe(1)
  })

  it("runs an arrow from a shared step up its need's column lane, out of the block's bottom, through no card", () => {
    for (const count of [5, 9, 18]) {
      const l = layoutPlan(plan(count))
      const at = (id: string) => l.nodes.get(id)!
      for (const e of l.edges) {
        const s = at(e.source)
        const t = at(e.target)
        expect(s.y, `${count}: ${e.source} under ${e.target}`).toBeGreaterThan(t.y)
        expect(e.points[0]).toEqual({ x: s.x, y: s.y - LAYOUT.cardH / 2 })
        expect(e.points.at(-1)).toEqual({ x: t.x, y: t.y + LAYOUT.cardH / 2 })
        const { line } = edgeCurve(e.points, opts)
        for (const v of l.nodes.values()) {
          if (v.id === e.source || v.id === e.target) continue
          const box = { left: v.x - LAYOUT.cardW / 2 + DOT.cx - 16, right: v.x + LAYOUT.cardW / 2, top: v.y - LAYOUT.cardH / 2, bottom: v.y + LAYOUT.cardH / 2 }
          for (const q of line) {
            const inside = q.x > box.left && q.x < box.right && q.y > box.top && q.y < box.bottom
            expect(inside, `${count}: ${e.source} -> ${e.target} runs through ${v.id} at (${q.x.toFixed(0)}, ${q.y.toFixed(0)})`).toBe(false)
          }
        }
      }
      // into a need on the first row: straight up its column's lane, one point on each row of the block under it
      const into = l.edges.find(e => e.target === 'x0' && e.source === 'z0')!.points.slice(1, -1)
      expect(into.length, `${count}`).toBe(Math.floor(Math.sqrt(count)) - 1)
      for (const q of into) expect(q.x).toBe(into[0].x)
      expect(into[0].x).toBeLessThan(at('x0').x - LAYOUT.cardW / 2)
    }
  })

  it('tells a step left of such a lane how far its words may draw', () => {
    const l = layoutPlan(plan(9))
    const at = (id: string) => l.nodes.get(id)!
    // x4 (second row, second column): the arrow into it climbs column 1's lane past the third row, right of x6
    const lane = l.edges.find(e => e.target === 'x4' && e.source.startsWith('z'))!.points[1].x
    const cx = at('x6').x - LAYOUT.cardW / 2 + DOT.cx
    expect(at('x6').walls!.find(w => at('x6').x + w > cx)).toBeCloseTo(lane - at('x6').x, 9)
    expect(lane).toBeGreaterThan(cx)
  })

  it("tells a block's step how far its words may draw before an arrow climbing past it into a step beside the block", () => {
    // b's needs sit on the plan's row beside the block: the arrows into them climb past the block's lower rows, so a
    // block step left of one in a lower row ends its words before it (the goal over a, b and over b, a: one puts them right)
    let pairs = 0
    for (const goal of [n('goal', 'a', 'b'), n('goal', 'b', 'a')]) {
      const l = layoutPlan([goal, ...plan(9).slice(1)])
      const at = (id: string) => l.nodes.get(id)!
      for (const y of ['y0', 'y1', 'y2'].map(at)) {
        const climbX = y.x - (LAYOUT.cardW / 2 - DOT.cx)
        for (const v of xs(9).map(at))
          if (v.y > at('x0').y && v.x < y.x) {
            pairs++
            const cx = v.x - LAYOUT.cardW / 2 + DOT.cx
            expect(v.x + v.walls!.find(w => v.x + w > cx)!, `${v.id} before the climb into ${y.id}`).toBeLessThanOrEqual(climbX + 1e-9)
            // and before that circle as drawn, which a zoom past the card floor moves left of where the arrow climbs
            expect(v.x + v.wallDot!, `${v.id} before ${y.id}'s card centre`).toBeLessThanOrEqual(y.x + 1e-9)
          }
      }
    }
    expect(pairs).toBeGreaterThan(0)
  })

  it("keeps a small area's needs side by side and nearer to it than to any other area, beside the blocks of the others", () => {
    // four areas over 18, 9, 8 and 2 needs of their own, each need over one or two of six shared steps (as the e2e
    // areasPlan): the 2-need area's needs once sat one at each side of the blocks, one past the 18-need block
    const sizes = [18, 9, 8, 2]
    const needs = (a: number) => Array.from({ length: sizes[a] }, (_, k) => `a${a}-${k}`)
    const input = [
      n('goal', ...sizes.map((_, a) => `a${a}`)),
      ...sizes.map((_, a) => n(`a${a}`, ...needs(a))),
      ...sizes.flatMap((_, a) => needs(a).map((id, k) => n(id, `c${(a + k) % 6}`, ...(k % 3 === 0 ? [`c${(a + k + 3) % 6}`] : [])))),
      ...Array.from({ length: 6 }, (_, c) => n(`c${c}`, ...(c % 2 === 0 ? ['base'] : []))),
      n('base'),
    ]
    const l = layoutPlan(input)
    const at = (id: string) => l.nodes.get(id)!
    // each of its needs nearer to it than to any other area, and the two side by side in the row
    for (const id of needs(3)) {
      const own = Math.abs(at(id).x - at('a3').x)
      for (const a of [0, 1, 2]) expect(own, `${id} at ${at(id).x.toFixed(0)}: a3 at ${at('a3').x.toFixed(0)}, a${a} at ${at(`a${a}`).x.toFixed(0)}`).toBeLessThan(Math.abs(at(id).x - at(`a${a}`).x))
    }
    expect(Math.abs(at('a3-0').order - at('a3-1').order)).toBe(1)
  })

  it("keeps a climb's y-span next to its x for the steps in the two rows past its ends, which its run drawn larger may reach", () => {
    // the areas plan: the shared steps sit a row under the blocks, and zoomed out past the card floor a column lane's
    // run, drawn half a card larger past its lowest point, reaches down onto the words of a shared step under it
    const sizes = [18, 9, 8, 2]
    const needs = (a: number) => Array.from({ length: sizes[a] }, (_, k) => `a${a}-${k}`)
    const l = layoutPlan([
      n('goal', ...sizes.map((_, a) => `a${a}`)),
      ...sizes.map((_, a) => n(`a${a}`, ...needs(a))),
      ...sizes.flatMap((_, a) => needs(a).map((id, k) => n(id, `c${(a + k) % 6}`, ...(k % 3 === 0 ? [`c${(a + k + 3) % 6}`] : [])))),
      ...Array.from({ length: 6 }, (_, c) => n(`c${c}`, ...(c % 2 === 0 ? ['base'] : []))),
      n('base'),
    ])
    const pitch = LAYOUT.rowGap + LAYOUT.cardH
    let checked = 0
    for (const e of l.edges) {
      const inner = e.points.slice(1, -1)
      if (!/^a\d-\d+$/.test(e.target) || !inner.length) continue
      const lx = inner[0].x
      const lowest = Math.max(...inner.map(p => p.y))
      for (const v of l.nodes.values()) {
        if (v.y <= lowest + LAYOUT.cardH / 2 || v.y > lowest + LAYOUT.cardH / 2 + 2 * pitch) continue
        const run = (v.wallRuns ?? []).find(r => Math.abs(r.dx - (lx - v.x)) < 1e-9 && Math.abs(r.bottom - (lowest - v.y)) < 1e-9)
        expect(run, `${v.id} under the climb into ${e.target} at ${lx.toFixed(0)}`).toBeTruthy()
        expect(run!.top).toBeLessThanOrEqual(run!.bottom)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(0)
    // and a climb into a card bends from its run's top to that card's circle, which past the card floor is drawn left
    // of the lane: the words of a step in a row the run passes, its circle left of the lane, end before that circle too
    // (a1-8, beside a2's last row, under the bend of the climb from c0 into a2-4)
    const at = (id: string) => l.nodes.get(id)!
    expect(at('a1-8').wallDot).toBeLessThanOrEqual(at('a2-4').x - at('a1-8').x)
    // with that climb's span (layout units from its card's centre), which reaches its row
    const climb = at('a1-8').wallDotRun!
    expect(climb.top).toBeLessThanOrEqual(LAYOUT.cardH / 2)
    expect(climb.bottom).toBeGreaterThanOrEqual(-LAYOUT.cardH / 2)
    // and a step in a row a lane runs past keeps that lane's span next to its x as well: how far up and down it is drawn
    let passing = 0
    for (const v of l.nodes.values())
      for (const dx of v.walls ?? []) {
        const spans = (v.wallRuns ?? []).filter(r => r.dx === dx && r.top - LAYOUT.cardH / 2 <= 0 && r.bottom + LAYOUT.cardH / 2 >= 0)
        expect(spans.length, `${v.id}: the lane ${dx.toFixed(0)} right of it`).toBeGreaterThan(0)
        passing++
      }
    expect(passing).toBeGreaterThan(0)
  })

  it('wraps needs that need nothing together with needs whose needs are shared', () => {
    // a needs three leaves and three needs over shared steps: neither rule before wrapped them, now all six wrap
    const l = layoutPlan([n('goal', 'a', 'b'), n('a', 'l0', 'l1', 'l2', 'x0', 'x1', 'x2'), n('b', 'z0'), n('l0'), n('l1'), n('l2'), n('x0', 'z0'), n('x1', 'z0'), n('x2', 'z1'), n('z0'), n('z1')])
    expect(new Set(['l0', 'l1', 'l2', 'x0', 'x1', 'x2'].map(id => l.nodes.get(id)!.y)).size).toBe(2)
  })

  it('wraps a block of needs under a need in such a block', () => {
    // x0 also needs five leaves of its own: they wrap under the block, and their arrows end on x0
    const input = [...plan(9).map(x => (x.id === 'x0' ? n('x0', 'z0', 'z1', 'k0', 'k1', 'k2', 'k3', 'k4') : x)), ...['k0', 'k1', 'k2', 'k3', 'k4'].map(id => n(id))]
    const l = layoutPlan(input)
    const at = (id: string) => l.nodes.get(id)!
    const k = ['k0', 'k1', 'k2', 'k3', 'k4'].map(at)
    expect(new Set(k.map(v => v.y)).size).toBe(2)
    expect(new Set(xs(9).map(id => at(id).y)).size).toBe(3)
    for (const v of k) expect(v.y).toBeGreaterThan(at('x8').y)
    for (const e of l.edges) {
      expect(at(e.source).y, `${e.source} under ${e.target}`).toBeGreaterThan(at(e.target).y)
      expect(e.points.at(-1)).toEqual({ x: at(e.target).x, y: at(e.target).y + LAYOUT.cardH / 2 })
    }
  })

  it('is deterministic', () => {
    expect(json(layoutPlan(plan(18)))).toBe(json(layoutPlan(structuredClone(plan(18)))))
  })
})

describe('layoutPlan: needs over shared steps wrap beside a block of branches', () => {
  const sub = LAYOUT.cardH + WRAP.subGap
  const os = (count: number) => Array.from({ length: count }, (_, i) => `o${i}`)
  const ss = (count: number) => Array.from({ length: count }, (_, i) => `s${i}`)
  /**
   * The finding's shape: the goal over areas a and b; a over `own` needs whose branch is its own (o0 over a step of its
   * own, o0-0; the rest need nothing) and `shared` needs each over one or two of four steps z0..z3 the areas share; b
   * over two needs over those too. With five or more of the first, they wrap as a block of branches.
   */
  const plan = (own: number, shared: number, deep = 1): In[] => [
    n('goal', 'a', 'b'),
    n('a', ...os(own), ...ss(shared)),
    n('b', 'y0', 'y1'),
    ...os(own).map((id, i) => (i === 0 ? n(id, 'o0-0') : n(id))),
    // o0's branch: a chain `deep` steps long under it (o0-0, o0-1, ...)
    ...Array.from({ length: deep }, (_, k) => (k + 1 < deep ? n(`o0-${k}`, `o0-${k + 1}`) : n(`o0-${k}`))),
    ...ss(shared).map((id, i) => n(id, `z${i % 4}`, ...(i % 3 === 0 ? [`z${(i + 1) % 4}`] : []))),
    n('y0', 'z0'),
    n('y1', 'z1', 'z2'),
    ...['z0', 'z1', 'z2', 'z3'].map(id => n(id)),
  ]
  /** A short digest of a layout (or with `where`, of where its steps are drawn alone), to pin one byte for byte. */
  const digest = (l: Layout, where = false) => {
    // (wallRuns, the reach of lanes into the rows past their ends and their spans, and wallDotRun, the span of a climb
    // into a circle beside, came after these pins and move nothing)
    const bare = { ...l, nodes: new Map([...l.nodes].map(([id, v]) => [id, { ...v, wallRuns: undefined, wallDotRun: undefined }])) }
    const text = where ? JSON.stringify([...l.nodes.values()].map(v => [v.id, v.layer, v.order, v.x, v.y])) : json(bare)
    let h = 0x811c9dc5
    for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193)
    return (h >>> 0).toString(16)
  }

  it('wraps the twelve needs over shared steps in rows of their own beside the block of the five with steps of their own', () => {
    const l = layoutPlan(plan(5, 12))
    const at = (id: string) => l.nodes.get(id)!
    const o = os(5).map(at)
    const s = ss(12).map(at)
    // the twelve: rows of four, three rows a block's row apart, columns lined up, read row by row
    expect(s.map(v => v.y)).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2].map(k => o[0].y + k * sub))
    for (let i = 4; i < 12; i++) expect(s[i].x).toBeCloseTo(s[i % 4].x, 9)
    expect(s.map(v => v.order)).toEqual(s.map((_, i) => s[0].order + i))
    // the five still wrap with their own steps under them, as before
    expect(new Set(o.map(v => v.y)).size).toBe(2)
    expect(at('o0-0').y).toBeGreaterThan(at('o0').y)
    // side by side, neither block over the other
    const span = (vs: { x: number }[]) => [Math.min(...vs.map(v => v.x)) - LAYOUT.cardW / 2, Math.max(...vs.map(v => v.x)) + LAYOUT.cardW / 2]
    const [ol, or] = span([...o, at('o0-0')])
    const [sl, sr] = span(s)
    expect(or <= sl || sr <= ol, `blocks at ${ol.toFixed(0)}..${or.toFixed(0)} and ${sl.toFixed(0)}..${sr.toFixed(0)}`).toBe(true)
    // the shared steps a plan row under the lower block's last row
    const lowest = Math.max(...[...o, ...s, at('o0-0')].map(v => v.y))
    for (const id of ['z0', 'z1', 'z2', 'z3']) expect(at(id).y).toBe(lowest + LAYOUT.cardH + LAYOUT.rowGap)
    // b's needs stay on the plan's row, beside the blocks' first row
    for (const id of ['y0', 'y1']) expect(at(id).y).toBe(o[0].y)
  })

  it("keeps the area's row narrow: at most 0.6 of the same needs in one line", () => {
    const l = layoutPlan(plan(5, 12))
    const row = [...os(5), ...ss(12)].map(id => l.nodes.get(id)!)
    const width = Math.max(...row.map(v => v.x)) - Math.min(...row.map(v => v.x)) + LAYOUT.cardW
    const line = 17 * LAYOUT.cardW + 16 * LAYOUT.colGap
    expect(width / line).toBeLessThanOrEqual(0.6)
  })

  it('keeps both blocks within their depth limits: the branches in bands at least WRAP.wide times as wide as tall, the cards in floor(√n) rows', () => {
    for (const [own, shared] of [[5, 12], [8, 5], [6, 20]]) {
      const l = layoutPlan(plan(own, shared))
      const at = (id: string) => l.nodes.get(id)!
      const o = os(own).map(at)
      const s = ss(shared).map(at)
      expect(new Set(s.map(v => v.y)).size, `${own}+${shared}: card rows`).toBe(Math.floor(Math.sqrt(shared)))
      const bands = new Set(o.map(v => v.y)).size
      expect(bands, `${own}+${shared}: bands`).toBeGreaterThanOrEqual(2)
      expect(bands, `${own}+${shared}: bands`).toBeLessThanOrEqual(Math.floor(Math.sqrt(own)))
      const all = [...o, at('o0-0')]
      const w = Math.max(...all.map(v => v.x)) - Math.min(...all.map(v => v.x)) + LAYOUT.cardW
      const h = Math.max(...all.map(v => v.y)) - Math.min(...all.map(v => v.y)) + LAYOUT.cardH
      expect(w, `${own}+${shared}: branch block ${w} wide, ${h} tall`).toBeGreaterThanOrEqual(WRAP.wide * h - LAYOUT.cardH)
    }
  })

  it('runs every arrow from a step under a need to the need, through no card it does not end on', () => {
    const opts = { cardH: LAYOUT.cardH, cardScale: 1, arrow: 8, dx: LAYOUT.cardW / 2 - DOT.cx, reach: DOT.reach }
    const l = layoutPlan(plan(5, 12))
    const at = (id: string) => l.nodes.get(id)!
    for (const e of l.edges) {
      const s = at(e.source)
      const t = at(e.target)
      expect(s.y, `${e.source} under ${e.target}`).toBeGreaterThan(t.y)
      expect(e.points[0]).toEqual({ x: s.x, y: s.y - LAYOUT.cardH / 2 })
      expect(e.points.at(-1)).toEqual({ x: t.x, y: t.y + LAYOUT.cardH / 2 })
      const { line } = edgeCurve(e.points, opts)
      for (const v of l.nodes.values()) {
        if (v.id === e.source || v.id === e.target) continue
        const box = { left: v.x - LAYOUT.cardW / 2 + DOT.cx - 16, right: v.x + LAYOUT.cardW / 2, top: v.y - LAYOUT.cardH / 2, bottom: v.y + LAYOUT.cardH / 2 }
        for (const q of line) {
          const inside = q.x > box.left && q.x < box.right && q.y > box.top && q.y < box.bottom
          expect(inside, `${e.source} -> ${e.target} runs through ${v.id} at (${q.x.toFixed(0)}, ${q.y.toFixed(0)})`).toBe(false)
        }
      }
    }
  })

  it("climbs into a card of the block's last row up its column's lane when the block of branches beside reaches deeper, a wall to the words left of it in every row it passes", () => {
    // a climb under the circle's layout centre ran through the card's own words once the card was drawn larger than its
    // slot, past the card floor; up the column's lane it runs where the arrows into the rows above climb (near and past
    // the card floor the circle may be drawn across that lane, as across any lane: see lane-walls-on-screen)
    let between = 0
    for (const [own, deep] of [[5, 1], [7, 2]]) {
      const l = layoutPlan(plan(own, 12, deep))
      const at = (id: string) => l.nodes.get(id)!
      const deepest = Math.max(...[...os(own), ...Array.from({ length: deep }, (_, k) => `o0-${k}`)].map(id => at(id).y))
      expect(deepest, `${deep}`).toBeGreaterThan(at('s8').y)
      for (const k of [8, 9, 10, 11]) {
        const t = at(`s${k}`)
        // the column's lane, as the arrows into the first row of that column climb it
        const lane = l.edges.find(e => e.target === `s${k - 8}` && e.source.startsWith('z'))!.points[1].x
        expect(lane).toBeLessThan(t.x - LAYOUT.cardW / 2 + DOT.cx - 16)
        for (const e of l.edges.filter(e => e.target === t.id)) {
          const mid = e.points.slice(1, -1)
          expect(mid.length, `${deep}: ${e.source} -> ${e.target}`).toBeGreaterThan(0)
          for (const q of mid) expect(q.x, `${deep}: ${e.source} -> ${e.target}`).toBe(lane)
        }
        // a wall to every step left of it in the rows from the block's last row down to the deepest row it climbs from
        for (const v of l.nodes.values())
          if (v.y > t.y && v.y <= deepest && v.x < lane) {
            if (v.y > t.y + LAYOUT.cardH / 2 && v.y < deepest - LAYOUT.cardH / 2) between++
            expect(v.walls ?? [], `${deep}: ${v.id} before the climb into ${t.id}`).toContain(lane - v.x)
          }
      }
    }
    // seven needs, one over a chain two deep: its lower step sits in a row between the card block's last row and the
    // deepest one (the second band), and the wall covers it
    expect(between).toBeGreaterThan(0)
  })

  it("tells every step in a row the climb into a block's last row passes, up from a deeper block beside, where that lane is", () => {
    // a over eight steps that need nothing and four over shared steps, wrapped as cards in rows of four: only the last
    // row's needs have arrows into them, so no climb from a row above runs down this lane. b beside it over seven needs,
    // one over a chain two deep: a block of branches reaching two rows further down, its chain's lower step in a row
    // between
    const ls = Array.from({ length: 8 }, (_, i) => `l${i}`)
    const xs = Array.from({ length: 4 }, (_, i) => `x${i}`)
    const bs = Array.from({ length: 7 }, (_, i) => `b${i}`)
    const l = layoutPlan([
      n('goal', 'a', 'b'),
      n('a', ...ls, ...xs),
      n('b', ...bs),
      ...ls.map(id => n(id)),
      ...xs.map((id, i) => n(id, `z${i % 2}`)),
      ...bs.map((id, i) => (i === 0 ? n(id, 'b0-0') : n(id))),
      n('b0-0', 'b0-1'),
      n('b0-1'),
      n('z0'),
      n('z1'),
      n('side', 'z0', 'z1'),
    ])
    const at = (id: string) => l.nodes.get(id)!
    const deepest = Math.max(...bs.map(id => at(id).y))
    expect(at('b0-1').y).toBeGreaterThan(at('x0').y + LAYOUT.cardH)
    expect(at('b0-1').y).toBeLessThan(deepest - LAYOUT.cardH)
    for (const x of xs) {
      const lane = l.edges.find(e => e.target === x)!.points[1].x
      for (const v of l.nodes.values())
        if (v.y >= at(x).y && v.y <= deepest) expect(v.walls ?? [], `${v.id} in a row the climb into ${x} passes`).toContain(lane - v.x)
    }
  })

  it('keeps fewer than WRAP.min needs over shared steps in the plan row beside the block of branches', () => {
    const l = layoutPlan(plan(5, WRAP.min - 1))
    const at = (id: string) => l.nodes.get(id)!
    for (const id of ss(WRAP.min - 1)) expect(at(id).y).toBe(at('o0').y)
  })

  it('leaves a plan unchanged where no five needs over shared steps sit beside a block of branches', () => {
    // pinned on master before this rule: only own branches; four needs over shared steps beside them; the areas plan
    // (18, 9, 8 and 2 needs, all over shared steps, as the e2e areasPlan), which wraps by the cards rule alone: every
    // step where it was (its arrows into the last row of a block beside a deeper one now climb the column lane, above;
    // re-pinned when a block's cards over the same step came to link to it once: each area's needs now sit under it)
    const sizes = [18, 9, 8, 2]
    const needs = (a: number) => Array.from({ length: sizes[a] }, (_, k) => `a${a}-${k}`)
    const areas = [
      n('goal', ...sizes.map((_, a) => `a${a}`)),
      ...sizes.map((_, a) => n(`a${a}`, ...needs(a))),
      ...sizes.flatMap((_, a) => needs(a).map((id, k) => n(id, `c${(a + k) % 6}`, ...(k % 3 === 0 ? [`c${(a + k + 3) % 6}`] : [])))),
      ...Array.from({ length: 6 }, (_, c) => n(`c${c}`, ...(c % 2 === 0 ? ['base'] : []))),
      n('base'),
    ]
    expect(digest(layoutPlan(plan(8, 0)))).toBe('45679d1a')
    expect(digest(layoutPlan(plan(5, 4)))).toBe('384f3f7c')
    expect(digest(layoutPlan(areas), true)).toBe('75993275')
  })

  it('is deterministic', () => {
    expect(json(layoutPlan(plan(5, 12)))).toBe(json(layoutPlan(structuredClone(plan(5, 12)))))
  })
})
