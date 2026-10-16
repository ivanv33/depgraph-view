/**
 * Layered ("Sugiyama-style") layout for a plan, read from the goal down: a node nothing depends on
 * sits in the top row, and every prerequisite sits below the nodes that need it.
 *
 * 1. Edges come from `depends_on` (missing ids and back edges of a cycle are dropped).
 * 2. An edge is redundant when a longer path already connects its ends; redundant edges are drawn
 *    but take no part in the layout.
 * 3. Layer = longest path to a sink (row 0 is the top). Edges that skip layers get one virtual slot per skipped layer,
 *    so a long edge runs in its own lane instead of through the cards in between.
 * 4. Each row is ordered by barycentre sweeps plus adjacent swaps, keeping the fewest crossings.
 *    Where crossings tie, the input order stands (it is the starting order and the tie-break).
 * 5. x: each slot is pulled toward its neighbours in the next row, holding row order and spacing
 *    (an exact weighted least-squares fit per row), then single-parent/single-child pairs are made
 *    straight and the cards are centred on x = 0.
 * 6. Wrapping: when WRAP.min or more of a step's needs need nothing, are needed by that step alone and are plain
 *    cards (not decks), they are laid out as one block of short rows (wrapRows.ts) instead of one long line. The
 *    block is a single slot of its row (ordered and placed like any card, and straight under its step when the
 *    step needs nothing else); its first row lines up with the row's other cards, and the rows under it move down
 *    past its last row, so every need is still below the step that needs it. The arrow from a step lower in the
 *    block runs up its column's lane, a narrow band left of the column's circles, past the rows above it.
 *    Needs with needs of their own wrap too, each with its whole branch (laid out on its own, under it), when nothing
 *    outside the branch needs any step in it: a band of the block then starts under the lowest step of the band above,
 *    and the arrow from a need lower down climbs its lane past the whole band. They wrap only into as many bands as
 *    keep the block WRAP.wide times as wide as tall; when even two would not, only the needs that need nothing wrap.
 *    Those wrap as cards alone together with the needs that have a step under them another step needs too: their own
 *    needs stay in the plan's rows under the block, and the arrow from one comes up out of the block's bottom, up its
 *    need's column lane past the rows of the block under that need, so a step whose many needs all reach shared steps
 *    (an area of a plan) still takes a few columns, not one long line. When the needs with branches of their own do
 *    wrap, five or more needs with a step under them another step needs too wrap the same way as cards, in a second
 *    block of their own beside that one, under the same step, so neither kind of need stays in one long line.
 *
 * Coordinates are layout units with y growing downward; a node's (x, y) is its card's centre.
 */
import { WRAP, blockShape, boxShape, type BlockShape, type NeedBox } from './wrapRows.js'
import { DOT } from './nodeLabel.js'

export const LAYOUT = { cardW: 170, cardH: 44, colGap: 36, laneW: 44, rowGap: 78 }

export type Pt = { x: number; y: number }
/**
 * `walls`, on a step in a row a block's lanes run up past: how far right of its card's centre (layout units) each lane
 * runs, left to right, each once, left of its circle in the layout or not. Which is its words' wall is decided on
 * screen at the zoom (titleFitDom laneWall): past the card floor a card draws larger than its slot about its centre, so
 * its circle moves left of where the layout puts it and a lane just left of it in the layout is drawn between the
 * circle and the words; past the ceiling it moves right. `wallDot`, on a
 * step an arrow climbs past into the circle of a step beside a block: how far right of its card's centre that step's
 * card centre is; drawn larger than its slot, that circle sits left of where the arrow climbs, and the arrow bends to
 * it, so the words end before that circle as drawn too; `wallDotRun`, that climb's y-span (as `wallRuns` has it).
 * `wallRuns`, on a step in a row such a lane runs past or in the two rows past either end of it: each lane's x as
 * `walls` has it (`dx`) with the y-span of its run (`top`, `bottom`: its highest and lowest point, layout units below
 * its card's centre, y down); drawn larger than its slot past the card floor, the run reaches half a drawn card past
 * its ends, and titleFitDom decides at the zoom whether that meets the step's words (runWalls) and how far up and down
 * the line at its wall is drawn, which every title keeps clear of there only.
 */
export type WallRun = { dx: number; top: number; bottom: number }
export type LaidNode = { id: string; layer: number; order: number; x: number; y: number; walls?: number[]; wallDot?: number; wallDotRun?: { top: number; bottom: number }; wallRuns?: WallRun[] }
export type LaidEdge = {
  source: string
  target: string
  redundant: boolean
  points: Pt[]
}
export type Layout = { nodes: Map<string, LaidNode>; edges: LaidEdge[]; width: number; height: number }

const SWEEP_ROUNDS = 12
const PLACE_ROUNDS = 10

type Edge = { s: number; t: number; redundant: boolean; lane: number[] }
/** `node`: the card's index, -1 for a long arrow's lane point, -2 for a block of wrapped needs. */
type Slot = { layer: number; width: number; tail: number; rank: number; node: number; up: number[]; down: number[] }

/**
 * `h` is how tall a node is drawn, centred on its slot, when that is more than a card (a deck with its list of
 * members): its row grows to fit it, and the rows around it move apart by the difference. `w` is how wide its slot
 * is when that is more than a card (a deck keeps room on both sides); the card sits in the middle of it. `tail` is
 * room kept on its right only (a step drawn larger for its date, whose words run past its slot).
 */
export function layoutPlan(input: LayoutInput): Layout {
  return layoutWith(input, new Map())
}

type LayoutInput = { id: string; depends_on: string[]; h?: number; w?: number; tail?: number }[]

/** How many times a layout was worked out (a plan, or a branch inside it laid out on its own): for tests. */
export const layoutRuns = { count: 0 }

/**
 * layoutPlan, sharing `sub` between a plan and the branches laid out inside it: a branch (keyed by its steps) is laid
 * out once however many times a block is tried around it, so trying a block that then does not wrap costs no more.
 */
function layoutWith(input: LayoutInput, subs: Map<string, Layout>): Layout {
  layoutRuns.count++
  const ids: string[] = []
  const tall: number[] = []
  const wide: number[] = []
  const tails: number[] = []
  const index = new Map<string, number>()
  for (const n of input) {
    if (index.has(n.id)) continue
    index.set(n.id, ids.length)
    ids.push(n.id)
    tall.push(Math.max(LAYOUT.cardH, n.h ?? 0))
    wide.push(Math.max(LAYOUT.cardW, n.w ?? 0))
    tails.push(Math.max(0, n.tail ?? 0))
  }
  const count = ids.length
  const deps: number[][] = ids.map(() => [])
  for (const n of input) {
    const t = index.get(n.id)!
    if (deps[t].length) continue // a duplicate id keeps its first entry
    for (const d of n.depends_on) {
      const s = index.get(d)
      if (s !== undefined && s !== t && !deps[t].includes(s)) deps[t].push(s)
    }
  }
  dropBackEdges(deps)

  const edges: Edge[] = []
  const children: number[][] = ids.map(() => [])
  for (let t = 0; t < count; t++) {
    for (const s of deps[t]) {
      edges.push({ s, t, redundant: false, lane: [] })
      children[s].push(t)
    }
  }

  const topo = topoOrder(deps, children)
  const below = descendants(topo, children)
  for (const e of edges) e.redundant = children[e.s].some(c => c !== e.t && below[c][e.t] === 1)

  const layer = new Array<number>(count).fill(0)
  for (let k = topo.length - 1; k >= 0; k--) {
    const v = topo[k]
    for (const c of children[v]) layer[v] = Math.max(layer[v], layer[c] + 1)
  }

  // Blocks: a step's needs that only it needs and that are plain cards, each with its whole branch under it when nothing
  // outside the branch needs a step in it; and as cards alone, its needs with a step under them that another step needs
  // too (those keep their needs in the plan's rows under the block), with its needs that need nothing when the branches
  // do not wrap (see WRAP.wide). A step can so have two blocks side by side in the row under it.
  // blockOf: the block a step is drawn in (a need of the block or a step under one); cellOf: its place among the block's
  // needs (-1 for a step under one); rel: where it is drawn, from the block's slot centre and its row's centre.
  const blockOf = new Int32Array(count).fill(-1)
  const cellOf = new Int32Array(count).fill(-1)
  const rel: Pt[] = ids.map(() => ({ x: 0, y: 0 }))
  /** `branch`: its needs are drawn with their branches under them (inner); else they are cards alone, their needs below. */
  type Block = { parent: number; members: number[]; shape: BlockShape; slot: number; inner: Map<string, Pt[]>; branch: boolean }
  const blocks: Block[] = []
  /** A need with its branch under it, laid out on its own: its steps and arrows from the need's centre, and its box. */
  const wrapBranch = (c: number, list: number[]): { box: NeedBox; nodes: [number, Pt][]; edges: LaidEdge[] } => {
    if (list.length === 1) return { box: { w: wide[c], tail: tails[c], cx: wide[c] / 2, down: tall[c] / 2 }, nodes: [[c, { x: 0, y: 0 }]], edges: [] }
    const key = list.map(v => ids[v]).join('\n')
    if (!subs.has(key)) subs.set(key, layoutWith(list.map(v => ({ id: ids[v], depends_on: deps[v].map(d => ids[d]), h: tall[v], w: wide[v], tail: tails[v] })), subs))
    const sub = subs.get(key)!
    const own = sub.nodes.get(ids[c])!
    const nodes = list.map(v => {
      const q = sub.nodes.get(ids[v])!
      return [v, { x: q.x - own.x, y: q.y - own.y }] as [number, Pt]
    })
    let left = Infinity
    let right = -Infinity
    let reach = -Infinity
    let bottom = -Infinity
    for (const [v, q] of nodes) {
      left = Math.min(left, q.x - wide[v] / 2)
      right = Math.max(right, q.x + wide[v] / 2)
      reach = Math.max(reach, q.x + wide[v] / 2 + tails[v])
      bottom = Math.max(bottom, q.y + tall[v] / 2)
    }
    const edges = sub.edges.map(e => ({ ...e, points: e.points.map(q => ({ x: q.x - own.x, y: q.y - own.y })) }))
    for (const e of edges)
      for (const q of e.points.slice(1, -1)) {
        left = Math.min(left, q.x - LAYOUT.laneW / 2)
        right = Math.max(right, q.x + LAYOUT.laneW / 2)
      }
    return { box: { w: right - left, tail: Math.max(0, reach - right), cx: -left, down: bottom }, nodes, edges }
  }
  /** c and every step under it, when only c and steps under it need them; else null. */
  const branchOf = (c: number): number[] | null => {
    const seen = new Set([c])
    const list = [c]
    for (let k = 0; k < list.length; k++)
      for (const d of deps[list[k]])
        if (!seen.has(d)) {
          seen.add(d)
          list.push(d)
        }
    return list.every(v => v === c || children[v].every(w => seen.has(w))) ? list.sort((a, b) => a - b) : null
  }
  // From the top down, so a step inside a wrapped branch is laid out with its branch, never in a block of its own here.
  // A need wrapped as a card alone is laid out here like any step, so its own needs can wrap under it too.
  for (const p of [...topo].reverse()) {
    if (blockOf[p] >= 0 && (cellOf[p] < 0 || blocks[blockOf[p]].branch)) continue
    const plain = deps[p].filter(c => children[c].length === 1 && tall[c] === LAYOUT.cardH && wide[c] === LAYOUT.cardW).sort((a, b) => a - b)
    if (plain.length < WRAP.min) continue
    const branches = plain.flatMap(c => {
      const list = branchOf(c)
      return list ? [{ c, list }] : []
    })
    // the needs wrapped with their branches, when they wrap
    const wrapped = new Set<number>()
    if (branches.length >= WRAP.min && branches.some(b => b.list.length > 1)) {
      const laid = branches.map(b => wrapBranch(b.c, b.list))
      for (let r = Math.floor(Math.sqrt(branches.length)); r >= 2 && !wrapped.size; r--) {
        const shape = boxShape(laid.map(l => l.box), r, LAYOUT)
        if (shape.width < WRAP.wide * (shape.down + LAYOUT.cardH / 2)) continue
        const inner = new Map<string, Pt[]>()
        laid.forEach((l, i) => {
          const { dx, dy } = shape.cells[i]
          const to = (q: Pt) => ({ x: dx + q.x, y: dy + q.y })
          for (const [v, q] of l.nodes) rel[v] = to(q)
          for (const e of l.edges) inner.set(`${e.source}>${e.target}`, e.points.map(to))
        })
        branches.forEach((b, i) =>
          b.list.forEach(v => {
            blockOf[v] = blocks.length
            cellOf[v] = v === b.c ? i : -1
          }),
        )
        for (const b of branches) wrapped.add(b.c)
        blocks.push({ parent: p, members: branches.map(b => b.c), shape, inner, branch: true, slot: -1 })
      }
    }
    // as cards alone, in a block of their own (beside the block of branches when one formed): the needs not wrapped
    // above that need nothing, and those whose branch is not their own (a need with a branch of its own that did not
    // wrap stays in the plan's row, with its branch under it)
    const own = new Set(branches.filter(b => b.list.length > 1).map(b => b.c))
    const members = plain.filter(c => !wrapped.has(c) && !own.has(c))
    if (members.length < WRAP.min) continue
    const shape = blockShape(members.length, Math.max(...members.map(c => tails[c])), LAYOUT)
    members.forEach((c, i) => {
      blockOf[c] = blocks.length
      cellOf[c] = i
      rel[c] = { x: shape.cells[i].dx, y: shape.cells[i].dy }
    })
    blocks.push({ parent: p, members, shape, inner: new Map(), branch: false, slot: -1 })
  }
  /** A need wrapped as a card alone: arrows from its own needs come up into its block from below. */
  const card = (v: number) => blockOf[v] >= 0 && cellOf[v] >= 0 && !blocks[blockOf[v]].branch

  // Slots: one per card, then one per skipped layer of every non-redundant long edge.
  const slots: Slot[] = ids.map((_, i) => ({ layer: layer[i], width: wide[i], tail: tails[i], rank: i, node: i, up: [], down: [] }))
  const link = (a: number, b: number) => {
    slots[a].down.push(b)
    slots[b].up.push(a)
  }
  // The dependent is the upper end; the lane runs down from it to the prerequisite. `lane` is kept in
  // source-first order (bottom to top) to match the edge's waypoints.
  // A step drawn as a card in a block hangs from its block's slot: the arrows into it reach it through the block.
  const upper = (v: number) => (card(v) ? blocks[blockOf[v]].slot : v)
  const lanes = (e: Edge) => {
    let prev = upper(e.t)
    // a block's cards that need the same step in the next row make one link from the block, not one each: else
    // ordering counts a block's many arrows as many crossings and pulls every free need in the row away from its step
    if (prev !== e.t && layer[e.s] === layer[e.t] + 1 && slots[prev].down.includes(e.s)) return
    for (let l = layer[e.t] + 1; l < layer[e.s]; l++) {
      const v = slots.length
      slots.push({ layer: l, width: LAYOUT.laneW, tail: 0, rank: e.t + 0.5, node: -1, up: [], down: [] })
      e.lane.unshift(v)
      link(prev, v)
      prev = v
    }
    link(prev, e.s)
  }
  // (the arrows into a card in a block come last, once the blocks have their slots)
  for (const e of edges) if (!e.redundant && blockOf[e.s] < 0 && !card(e.t)) lanes(e)
  // One slot per block, in its members' row, under the step they wrap under.
  for (const b of blocks) {
    const first = b.members[0]
    b.slot = slots.length
    slots.push({ layer: layer[first], width: b.shape.width, tail: b.shape.tail, rank: first, node: -2, up: [], down: [] })
  }
  for (const b of blocks) link(upper(b.parent), b.slot)
  for (const e of edges) if (!e.redundant && blockOf[e.s] < 0 && card(e.t)) lanes(e)

  const depth = count ? Math.max(...layer) + 1 : 0
  const rows: number[][] = Array.from({ length: depth }, () => [])
  for (let i = 0; i < slots.length; i++) if (i >= count || blockOf[i] < 0) rows[slots[i].layer].push(i)
  for (const row of rows) row.sort((a, b) => slots[a].rank - slots[b].rank || a - b)

  // Each row's centre: rows sit rowGap apart, measured from the tallest node of each; a block reaches down from it.
  const up = rows.map(row => Math.max(LAYOUT.cardH, ...row.filter(s => s < count).map(s => tall[s])) / 2)
  const down = [...up]
  for (const b of blocks) down[slots[b.slot].layer] = Math.max(down[slots[b.slot].layer], b.shape.down)
  // A row left empty (all its steps drawn in a block above) takes no room.
  const rowY: number[] = []
  let last = 0
  for (let l = 0; l < depth; l++) {
    if (l > 0 && rows[l].length === 0) {
      rowY.push(rowY[last])
      continue
    }
    rowY.push(l === 0 ? 0 : rowY[last] + down[last] + LAYOUT.rowGap + up[l])
    last = l
  }

  const order = orderRows(rows, slots)
  const x = placeRows(order, slots)
  const cell = (i: number) => blocks[blockOf[i]].shape.cells[cellOf[i]]
  const blockY = (b: Block) => rowY[slots[b.slot].layer]
  for (let i = 0; i < count; i++) if (blockOf[i] >= 0) x[i] = x[blocks[blockOf[i]].slot] + rel[i].x
  const nodeY = (i: number) => (blockOf[i] >= 0 ? blockY(blocks[blockOf[i]]) + rel[i].y : rowY[layer[i]])

  // Centre the cards on x = 0.
  let minX = Infinity
  let maxX = -Infinity
  for (let i = 0; i < count; i++) {
    minX = Math.min(minX, x[i] - LAYOUT.cardW / 2)
    maxX = Math.max(maxX, x[i] + LAYOUT.cardW / 2)
  }
  const shift = count ? (minX + maxX) / 2 : 0
  const at = (slot: number) => x[slot] - shift + 0 // + 0 turns -0 into 0

  // Order in each row: its steps, with a block's needs row by row where the block stands; the steps under a block's
  // needs (in a lower row) band by band and left to right, where the block stands among the steps of their row.
  const realOrder = new Map<number, number>()
  // each block's steps under its needs, by row (grouped once)
  const under = new Map<string, number[]>()
  for (let i = 0; i < count; i++)
    if (blockOf[i] >= 0 && cellOf[i] < 0) {
      const key = `${layer[i]}:${blockOf[i]}`
      const list = under.get(key)
      if (list) list.push(i)
      else under.set(key, [i])
    }
  const blockAt = new Map(blocks.map(b => [b.slot, b]))
  for (let l = 0; l < depth; l++) {
    const seq = order[l].flatMap(s => (s < count ? [s] : slots[s].node === -2 ? blockAt.get(s)!.members : []))
    blocks.forEach((b, bi) => {
      const vs = under.get(`${l}:${bi}`)
      if (!vs) return
      vs.sort((a, c) => nodeY(a) - nodeY(c) || x[a] - x[c] || a - c)
      seq.splice(seq.filter(v => x[v] < x[b.slot]).length, 0, ...vs)
    })
    seq.forEach((v, i) => realOrder.set(v, i))
  }

  const nodes = new Map<string, LaidNode>()
  for (let i = 0; i < count; i++) {
    nodes.set(ids[i], { id: ids[i], layer: layer[i], order: realOrder.get(i)!, x: at(i), y: nodeY(i) })
  }
  const endDx = LAYOUT.cardW / 2 - DOT.cx
  /** In a block, an arrow from a lower row runs up its column's lane past each row above it, bottom to top. */
  const blockLane = (s: number): Pt[] => {
    if (blockOf[s] < 0 || cellOf[s] < 0) return []
    const b = blocks[blockOf[s]]
    const { col, sub } = cell(s)
    const { bandY, bandDown } = b.shape
    const lx = at(b.slot) + b.shape.laneDx[col]
    const out: Pt[] = []
    // past a band whose needs have needs of their own: from under its lowest step (half the gap below that row,
    // so the arrow turns toward its need well under the circles there), straight up to its needs' row
    for (let k = sub - 1; k >= 0; k--) {
      if (bandDown[k] > LAYOUT.cardH / 2) out.push({ x: lx, y: blockY(b) + bandY[k] + bandDown[k] - LAYOUT.cardH / 2 + WRAP.subGap / 2 })
      out.push({ x: lx, y: blockY(b) + bandY[k] })
    }
    return out
  }
  /**
   * Into a need wrapped as a card alone, an arrow from its own needs (under the block) comes up its column's lane past
   * each row of the block under it, bottom to top, the same lane the column's lower needs climb to their step, and then
   * turns into the circle from below; into the block's last row it comes straight up.
   */
  const cardLane = (t: number): Pt[] => {
    const b = blocks[blockOf[t]]
    const { col, sub } = cell(t)
    const lx = at(b.slot) + b.shape.laneDx[col]
    const out: Pt[] = []
    for (let k = b.shape.rows.length - 1; k > sub; k--) out.push({ x: lx, y: blockY(b) + b.shape.bandY[k] })
    return out
  }
  const intoCard = (t: number): Pt[] => {
    const b = blocks[blockOf[t]]
    const lane = cardLane(t)
    // a deeper block beside this one: first straight up its column's lane to this block's last row (into the last row
    // too: under the circle's layout centre the climb would run through the card's own words once the card is drawn
    // larger than its slot, past the card floor, which moves the circle left)
    const bottom = rowY[layer[t]] + down[layer[t]] - LAYOUT.cardH / 2
    const deeper = bottom > blockY(b) + b.shape.down - LAYOUT.cardH / 2 + 1e-9
    return deeper ? [{ x: at(b.slot) + b.shape.laneDx[cell(t).col], y: bottom }, ...lane] : lane
  }
  /**
   * The run of an arrow into a card: its climb (intoCard), and into the block's last row from a deeper block beside, up
   * to that row's centre too, as `rise` does, so it is a wall in every row it passes and not only the deepest one.
   */
  const climbRun = (t: number): Pt[] => {
    const run = intoCard(t)
    return run.length && cell(t).sub === blocks[blockOf[t]].shape.rows.length - 1 ? [...run, { x: run[0].x, y: nodeY(t) }] : run
  }
  // Each lane in a block, from its lowest point to its top (each drawn half a card past it), is a wall to the words of
  // every step in a row it runs past whose circle is drawn left of it: kept for every step there (walls, with the run's
  // span in wallRuns), the circle as drawn known only at the zoom.
  // `to`: the step whose circle the run ends on, when it climbs to it straight (see wallDot)
  const runs: { lane: Pt[]; to?: number }[] = blocks
    .flatMap(b => b.members)
    // (a climb into a card bends from the run's top to its circle as drawn, past the card floor left of the lane: `to`)
    .flatMap(s => [{ lane: blockLane(s) }, ...(card(s) && deps[s].length ? [{ lane: climbRun(s), to: s }] : [])])
  // and so is an arrow climbing past a block's lower rows beside it (see climb below), into a step of the block's row
  // or in a long arrow's lane, from the row's bottom up to its centre
  const rise = (l: number, x: number, to?: number) => (down[l] > up[l] ? [{ lane: [{ x, y: rowY[l] + down[l] - LAYOUT.cardH / 2 }, { x, y: rowY[l] }], to }] : [])
  for (const e of edges) {
    if (blockOf[e.s] >= 0 && blockOf[e.s] === blockOf[e.t]) continue
    for (const v of e.lane) runs.push(...rise(slots[v].layer, at(v)))
    if (!card(e.t)) runs.push(...rise(layer[e.t], at(e.t) - endDx, e.t))
  }
  // A run is drawn half a card past its ends at the card's drawn size, which past the card floor is larger than its
  // slot: so it can reach the words of a step in a row past its ends, as far as the zoom takes it. Those steps in the
  // two rows past either end keep the run's y-span (layout units from their own centre) next to its x (wallRuns), and
  // titleFitDom decides at the zoom whether the run as drawn meets their words.
  const reach = 2 * (LAYOUT.rowGap + LAYOUT.cardH)
  for (const { lane, to } of runs) {
    if (!lane.length) continue
    const lx = lane[0].x
    const y0 = Math.min(...lane.map(q => q.y))
    const y1 = Math.max(...lane.map(q => q.y))
    const top = y0 - LAYOUT.cardH / 2
    const bottom = y1 + LAYOUT.cardH / 2
    for (const v of nodes.values()) {
      if (v.y < top || v.y > bottom) {
        if (v.y >= top - reach && v.y <= bottom + reach) {
          const runs = (v.wallRuns ??= [])
          const run = { dx: lx - v.x, top: y0 - v.y, bottom: y1 - v.y }
          if (!runs.some(r => r.dx === run.dx && r.top === run.top && r.bottom === run.bottom)) runs.push(run)
        }
        continue
      }
      ;(v.walls ??= []).push(lx - v.x)
      const passing = (v.wallRuns ??= [])
      const span = { dx: lx - v.x, top: y0 - v.y, bottom: y1 - v.y }
      if (!passing.some(r => r.dx === span.dx && r.top === span.top && r.bottom === span.bottom)) passing.push(span)
      if (to !== undefined && to !== index.get(v.id) && lx > v.x - endDx) {
        const dx = at(to) - v.x
        const run = { top: y0 - v.y, bottom: y1 - v.y }
        if (v.wallDot === undefined || dx < v.wallDot) [v.wallDot, v.wallDotRun] = [dx, run]
        else if (dx === v.wallDot && v.wallDotRun) v.wallDotRun = { top: Math.min(v.wallDotRun.top, run.top), bottom: Math.max(v.wallDotRun.bottom, run.bottom) }
      }
    }
  }
  for (const v of nodes.values()) if (v.walls) v.walls = [...new Set(v.walls)].sort((a, b) => a - b)
  /**
   * A row holding a block reaches further down than its cards: an arrow into a card of that row, or passing it in a
   * lane, first climbs straight up from the row's bottom edge, so it turns sideways in the gap below the row and never
   * through the block's lower rows. For an arrow's end the climb is at the end's own x (left of the card centre).
   */
  const climb = (l: number, x: number): Pt[] => (down[l] > up[l] ? [{ x, y: rowY[l] + down[l] - LAYOUT.cardH / 2 }] : [])
  const laid: LaidEdge[] = edges.map(e => {
    const source = ids[e.s]
    const target = ids[e.t]
    // inside a wrapped branch: as the branch's own layout drew it
    const b = blockOf[e.s] >= 0 && blockOf[e.s] === blockOf[e.t] ? blocks[blockOf[e.s]] : null
    if (b) return { source, target, redundant: e.redundant, points: b.inner.get(`${source}>${target}`)!.map(q => ({ x: at(b.slot) + q.x, y: blockY(b) + q.y })) }
    return {
      source,
      target,
      redundant: e.redundant,
      points: [
        { x: at(e.s), y: nodeY(e.s) - LAYOUT.cardH / 2 },
        ...blockLane(e.s),
        ...e.lane.flatMap(v => [...climb(slots[v].layer, at(v)), { x: at(v), y: rowY[slots[v].layer] }]),
        ...(card(e.t) ? intoCard(e.t) : climb(layer[e.t], at(e.t) - endDx)),
        { x: at(e.t), y: nodeY(e.t) + LAYOUT.cardH / 2 },
      ],
    }
  })
  return {
    nodes,
    edges: laid,
    width: count ? maxX - minX : 0,
    height: count ? up[0] + rowY[last] + down[last] : 0,
  }
}

/** Removes every dependency that closes a cycle (found by DFS in input order). */
function dropBackEdges(deps: number[][]): void {
  const state = new Uint8Array(deps.length) // 0 new, 1 on stack, 2 done
  for (let root = 0; root < deps.length; root++) {
    if (state[root]) continue
    const stack: [number, number][] = [[root, 0]]
    state[root] = 1
    while (stack.length) {
      const top = stack[stack.length - 1]
      const [v, i] = top
      if (i >= deps[v].length) {
        state[v] = 2
        stack.pop()
        continue
      }
      top[1]++
      const p = deps[v][i]
      if (state[p] === 1) {
        deps[v].splice(i, 1)
        top[1]--
      } else if (state[p] === 0) {
        state[p] = 1
        stack.push([p, 0])
      }
    }
  }
}

/** Kahn's algorithm, always taking the ready node that comes first in the input. */
function topoOrder(deps: number[][], children: number[][]): number[] {
  const waiting = deps.map(d => d.length)
  const ready: number[] = []
  for (let i = 0; i < deps.length; i++) if (waiting[i] === 0) ready.push(i)
  const out: number[] = []
  while (ready.length) {
    let best = 0
    for (let i = 1; i < ready.length; i++) if (ready[i] < ready[best]) best = i
    const v = ready.splice(best, 1)[0]
    out.push(v)
    for (const c of children[v]) if (--waiting[c] === 0) ready.push(c)
  }
  return out
}

/** below[v][w] === 1 when w is reachable from v by one or more edges. */
function descendants(topo: number[], children: number[][]): Uint8Array[] {
  const below = children.map(() => new Uint8Array(children.length))
  for (let k = topo.length - 1; k >= 0; k--) {
    const v = topo[k]
    for (const c of children[v]) {
      below[v][c] = 1
      const bc = below[c]
      const bv = below[v]
      for (let w = 0; w < bc.length; w++) if (bc[w]) bv[w] = 1
    }
  }
  return below
}

// ---------- ordering ----------

function positions(rows: number[][], size: number): Int32Array {
  const pos = new Int32Array(size)
  for (const row of rows) row.forEach((s, i) => (pos[s] = i))
  return pos
}

/** Crossings between row `l` and row `l + 1`: inversions of the lower ends, counted with a Fenwick tree. */
function crossingsBetween(upper: number[], lowerSize: number, slots: Slot[], pos: Int32Array): number {
  const ends: number[] = []
  for (const u of upper) {
    const lows = slots[u].down.map(d => pos[d]).sort((a, b) => a - b)
    for (const p of lows) ends.push(p)
  }
  const tree = new Int32Array(lowerSize + 1)
  let crossings = 0
  for (let k = 0; k < ends.length; k++) {
    // count earlier ends strictly greater than this one
    let le = 0
    for (let i = ends[k] + 1; i > 0; i -= i & -i) le += tree[i]
    crossings += k - le
    for (let i = ends[k] + 1; i <= lowerSize; i += i & -i) tree[i]++
  }
  return crossings
}

function totalCrossings(rows: number[][], slots: Slot[]): number {
  const pos = positions(rows, slots.length)
  let c = 0
  for (let l = 0; l + 1 < rows.length; l++) c += crossingsBetween(rows[l], rows[l + 1].length, slots, pos)
  return c
}

function orderRows(initial: number[][], slots: Slot[]): number[][] {
  let rows = initial.map(r => [...r])
  let best = rows.map(r => [...r])
  let bestCount = totalCrossings(rows, slots)
  const keep = () => {
    const c = totalCrossings(rows, slots)
    if (c < bestCount) {
      bestCount = c
      best = rows.map(r => [...r])
    }
  }
  for (let round = 0; round < SWEEP_ROUNDS && bestCount > 0; round++) {
    for (let l = 1; l < rows.length; l++) rows[l] = byBarycentre(rows[l], rows[l - 1], slots, 'up')
    transpose(rows, slots)
    keep()
    for (let l = rows.length - 2; l >= 0; l--) rows[l] = byBarycentre(rows[l], rows[l + 1], slots, 'down')
    transpose(rows, slots)
    keep()
  }
  rows = best
  return rows
}

function byBarycentre(row: number[], fixed: number[], slots: Slot[], side: 'up' | 'down'): number[] {
  const at = new Map<number, number>()
  fixed.forEach((s, i) => at.set(s, i))
  const scale = fixed.length / Math.max(row.length, 1)
  const key = new Map<number, number>()
  row.forEach((s, i) => {
    const ns = slots[s][side]
    key.set(s, ns.length ? ns.reduce((sum, n) => sum + at.get(n)!, 0) / ns.length : i * scale)
  })
  return [...row].sort((a, b) => key.get(a)! - key.get(b)! || slots[a].rank - slots[b].rank || a - b)
}

/** Crossings that u and v (adjacent, u left of v) make with their neighbours on both sides. */
function pairCrossings(u: number, v: number, slots: Slot[], pos: Int32Array): number {
  let c = 0
  for (const side of ['up', 'down'] as const) {
    for (const a of slots[u][side]) for (const b of slots[v][side]) if (pos[a] > pos[b]) c++
  }
  return c
}

function transpose(rows: number[][], slots: Slot[]): void {
  const pos = positions(rows, slots.length)
  for (let pass = 0; pass < 4; pass++) {
    let improved = false
    for (const row of rows) {
      for (let i = 0; i + 1 < row.length; i++) {
        const u = row[i]
        const v = row[i + 1]
        if (pairCrossings(v, u, slots, pos) < pairCrossings(u, v, slots, pos)) {
          row[i] = v
          row[i + 1] = u
          pos[v] = i
          pos[u] = i + 1
          improved = true
        }
      }
    }
    if (!improved) break
  }
}

// ---------- x placement ----------

const gap = (a: Slot, b: Slot) => a.width / 2 + a.tail + LAYOUT.colGap + b.width / 2

function placeRows(rows: number[][], slots: Slot[]): Float64Array {
  const x = new Float64Array(slots.length)
  for (const row of rows) {
    let at = 0
    row.forEach((s, i) => {
      if (i > 0) at += gap(slots[row[i - 1]], slots[s])
      x[s] = at
    })
  }
  const pull = (row: number[], sides: ('up' | 'down')[]) => {
    const want: number[] = []
    const weight: number[] = []
    for (const s of row) {
      const ns = sides.flatMap(side => slots[s][side])
      if (ns.length === 0) {
        want.push(x[s])
        weight.push(0.01)
        continue
      }
      want.push(ns.reduce((sum, n) => sum + x[n], 0) / ns.length)
      weight.push(ns.length * (slots[s].node === -1 ? 2 : 1))
    }
    fitRow(row, want, weight, slots, x)
  }
  for (let round = 0; round < PLACE_ROUNDS; round++) {
    for (let l = 1; l < rows.length; l++) pull(rows[l], ['up'])
    for (let l = rows.length - 2; l >= 0; l--) pull(rows[l], ['down'])
  }
  for (const row of rows) pull(row, ['up', 'down'])
  straighten(rows, slots, x)
  return x
}

/**
 * Exact weighted least-squares placement of one row: minimise sum w_i (x_i - want_i)^2 subject to
 * x_{i+1} - x_i >= gap_i. Substituting z_i = x_i - offset_i turns the spacing into z non-decreasing,
 * which pool-adjacent-violators solves exactly.
 */
function fitRow(row: number[], want: number[], weight: number[], slots: Slot[], x: Float64Array): void {
  const offset: number[] = []
  let acc = 0
  row.forEach((s, i) => {
    if (i > 0) acc += gap(slots[row[i - 1]], slots[s])
    offset.push(acc)
  })
  const blocks: { value: number; weight: number; size: number }[] = []
  row.forEach((_, i) => {
    blocks.push({ value: want[i] - offset[i], weight: weight[i], size: 1 })
    while (blocks.length > 1 && blocks[blocks.length - 2].value > blocks[blocks.length - 1].value) {
      const b = blocks.pop()!
      const a = blocks[blocks.length - 1]
      const w = a.weight + b.weight
      a.value = (a.value * a.weight + b.value * b.weight) / w
      a.weight = w
      a.size += b.size
    }
  })
  let i = 0
  for (const b of blocks) {
    for (let k = 0; k < b.size; k++, i++) x[row[i]] = b.value + offset[i]
  }
}

/** Puts a slot with a single parent directly under that parent when the parent has no other child, if the row has room. */
function straighten(rows: number[][], slots: Slot[], x: Float64Array): void {
  const fits = (row: number[], i: number, to: number) =>
    (i === 0 || to - x[row[i - 1]] >= gap(slots[row[i - 1]], slots[row[i]]) - 1e-9) &&
    (i === row.length - 1 || x[row[i + 1]] - to >= gap(slots[row[i]], slots[row[i + 1]]) - 1e-9)
  const rowPos = positions(rows, slots.length)
  for (let pass = 0; pass < 2; pass++) {
    for (let l = 1; l < rows.length; l++) {
      for (const c of rows[l]) {
        if (slots[c].up.length !== 1) continue
        const p = slots[c].up[0]
        if (slots[p].down.length !== 1 || x[c] === x[p]) continue
        if (fits(rows[l], rowPos[c], x[p])) x[c] = x[p]
        else if (fits(rows[l - 1], rowPos[p], x[c])) x[p] = x[c]
      }
    }
  }
}

// ---------- metrics ----------

/** Crossings between non-redundant edges, from the laid-out positions. */
export function countCrossings(layout: Layout): number {
  // Each point belongs to the row it sits in (a row starts half a gap above its centre); a segment between two rows
  // lies in the gap above the lower one, and one inside a row (up a block's lane, or a climb past a block) crosses nothing.
  const top: number[] = []
  for (const v of layout.nodes.values()) top[v.layer] = Math.min(top[v.layer] ?? Infinity, v.y)
  const rowOf = (y: number) => {
    let l = 0
    for (let k = 0; k < top.length; k++) if (top[k] !== undefined && top[k] - LAYOUT.rowGap / 2 <= y) l = k
    return l
  }
  const byGap = new Map<number, { a: Pt; b: Pt; s: string; t: string }[]>()
  for (const e of layout.edges) {
    if (e.redundant) continue
    for (let k = 0; k + 1 < e.points.length; k++) {
      const gap = rowOf(e.points[k].y)
      if (gap === rowOf(e.points[k + 1].y)) continue
      const list = byGap.get(gap) ?? []
      list.push({ a: e.points[k], b: e.points[k + 1], s: e.source, t: e.target })
      byGap.set(gap, list)
    }
  }
  let crossings = 0
  for (const list of byGap.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const p = list[i]
        const q = list[j]
        if ((p.a.x - q.a.x) * (p.b.x - q.b.x) < 0) crossings++
      }
    }
  }
  return crossings
}
