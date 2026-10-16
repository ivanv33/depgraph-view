import { daysUntil, dueView, dueViewOf, type DueView } from './due.js'
import type { NodeState } from './readiness.js'
import type { Plan, PlanNode, Priority, Status } from './schema.js'

export const DECK_PREFIX = 'deck:'
/** How many member titles a deck lists beside its fan. */
export const DECK_LIST_MAX = 6

export interface Deck {
  id: string
  parentId: string
  members: PlanNode[]
  /** A done deck: finished needs of the selection's chain folded under the drawn step they hang from (see doneFolds). */
  done?: true
}
export interface DeckView {
  /** Nodes to lay out and draw: the open nodes plus one entry per deck, in plan order (a deck sits where its parent's first hidden child was). */
  nodes: Array<Pick<PlanNode, 'id' | 'depends_on'>>
  decks: Map<string, Deck>
  /** member id -> the deck it is in (always one: a step folds into one deck only) */
  hidden: Map<string, string[]>
  /**
   * A step drawn as itself -> its needs that no line from it stands for, in plan order: each is in another step's deck
   * or drawn under another step, and the line to it is left out. Only steps with at least one; empty with Group off.
   */
  elsewhere: Map<string, string[]>
}

/** 'deck:x' -> 'x'; any other id -> null. */
export const deckParent = (id: string): string | null => (id.startsWith(DECK_PREFIX) ? id.slice(DECK_PREFIX.length) : null)

/**
 * The dependency and the dependent of a drawn edge, for a menu on it: an edge to or from a deck stands for several
 * dependencies, so there is nothing to name (null).
 */
export function edgeMenuIds(source: string, target: string): [dependencyId: string, dependentId: string] | null {
  return deckParent(source) !== null || deckParent(target) !== null ? null : [source, target]
}

/**
 * The nodes drawn individually (or, for a finished part, folded into a done deck).
 * With a selection: every path from a root down to it, its whole subtree, and every other root. Another root stays
 * drawn alone, its needs folding into its branch decks; when it is finished (done, with everything under it done),
 * its whole tree opens too, to be folded into its done deck (see otherFinishedRoots).
 * With none: the roots and their children, and then, while the last level opened is a single node (the top of the
 * plan is one column), that node's children too, down to the first node with two or more children or to a leaf.
 */
export function openSet(plan: Plan, selectedId: string | null): Set<string> {
  const byId = new Map(plan.nodes.map(n => [n.id, n]))
  const dependents = new Map<string, string[]>()
  for (const n of plan.nodes) for (const d of n.depends_on) if (byId.has(d)) dependents.set(d, [...(dependents.get(d) ?? []), n.id])
  const open = new Set<string>()
  const walk = (starts: string[], next: (id: string) => string[]) => {
    const seen = new Set<string>()
    const stack = [...starts]
    while (stack.length) {
      const id = stack.pop()!
      if (seen.has(id)) continue
      seen.add(id)
      open.add(id)
      stack.push(...next(id))
    }
  }
  const children = (id: string) => (byId.get(id)?.depends_on ?? []).filter(d => byId.has(d))
  if (selectedId !== null && byId.has(selectedId)) {
    walk([selectedId], id => dependents.get(id) ?? []) // the path up to every root
    walk([selectedId], children)
    // Every other root stays drawn, so its tree folds under it instead of dropping out of the view (with one root
    // this adds nothing: it is on the path up from every step); a finished one opens its tree for its done deck.
    for (const n of plan.nodes) if (!dependents.has(n.id)) open.add(n.id)
    for (const tree of otherFinishedRoots(byId, selectedId).values()) for (const id of tree) open.add(id)
  } else {
    let level: string[] = []
    for (const n of plan.nodes) {
      if (dependents.has(n.id)) continue
      open.add(n.id)
      for (const c of children(n.id)) if (!open.has(c)) level.push(c)
      for (const c of children(n.id)) open.add(c)
    }
    // the last level opened is one step: open its children too, until a level has two or more steps (or none)
    while (level.length === 1) {
      level = children(level[0]).filter(c => !open.has(c))
      for (const c of level) open.add(c)
    }
  }
  return open
}

/** The step and every step under it. */
function subtreeOf(byId: Map<string, PlanNode>, id: string): Set<string> {
  const out = new Set<string>()
  for (const stack = [id]; stack.length; ) {
    const k = stack.pop()!
    if (out.has(k) || !byId.has(k)) continue
    out.add(k)
    stack.push(...byId.get(k)!.depends_on)
  }
  return out
}

/** The roots (steps nothing needs) that are not the selection nor above it, in plan order. */
function otherRoots(byId: Map<string, PlanNode>, selectedId: string): string[] {
  const dependents = new Map<string, string[]>()
  for (const n of byId.values()) for (const d of n.depends_on) if (byId.has(d)) dependents.set(d, [...(dependents.get(d) ?? []), n.id])
  const above = new Set<string>()
  for (const stack = [selectedId]; stack.length; ) {
    const id = stack.pop()!
    if (above.has(id)) continue
    above.add(id)
    stack.push(...(dependents.get(id) ?? []))
  }
  return [...byId.keys()].filter(id => !dependents.has(id) && !above.has(id))
}

/**
 * The roots off the selection's chain (not the selection, nor above it) that are finished: done, with every step under
 * them done. Each maps to the steps under it, in plan order.
 */
function otherFinishedRoots(byId: Map<string, PlanNode>, selectedId: string): Map<string, string[]> {
  const needs = (id: string) => (byId.get(id)?.depends_on ?? []).filter(d => byId.has(d))
  const out = new Map<string, string[]>()
  for (const root of otherRoots(byId, selectedId).map(id => byId.get(id)!)) {
    const under = new Set<string>()
    for (const stack = needs(root.id); stack.length; ) {
      const id = stack.pop()!
      if (under.has(id) || id === root.id) continue
      under.add(id)
      stack.push(...needs(id))
    }
    if (root.status === 'done' && [...under].every(id => byId.get(id)!.status === 'done'))
      out.set(root.id, [...byId.keys()].filter(id => under.has(id)))
  }
  return out
}

/**
 * The finished part of the selection's needs, folded into done decks: owner (a drawn step) -> the done steps under it.
 * A need of the selection folds when it is done and everything below it is done too; a done step with an unfinished
 * step anywhere below it stays drawn, so the path down to that step reads step by step. The drawn steps are visited
 * from the selection down, a level at a time; each takes into its deck the folded steps it reaches through folded
 * steps only, unless an earlier one took them already: a step needed from several places is in one deck, once. The
 * selected step is always drawn. A deck in `opened`, or of a single step, is not made: its steps are drawn.
 */
function doneFolds(byId: Map<string, PlanNode>, selectedId: string, opened: ReadonlySet<string>): Map<string, PlanNode[]> {
  const needs = (id: string) => (byId.get(id)?.depends_on ?? []).filter(d => byId.has(d))
  const below = new Set<string>()
  for (const stack = needs(selectedId); stack.length; ) {
    const id = stack.pop()!
    if (below.has(id) || id === selectedId) continue
    below.add(id)
    stack.push(...needs(id))
  }
  // Whether a step is done with everything below it done (memoised; a plan is acyclic, a guard keeps a bad one finite).
  const finished = new Map<string, boolean>()
  const isFinished = (id: string): boolean => {
    const known = finished.get(id)
    if (known !== undefined) return known
    finished.set(id, false)
    const v = byId.get(id)!.status === 'done' && needs(id).every(isFinished)
    finished.set(id, v)
    return v
  }
  const folds = (id: string) => id !== selectedId && below.has(id) && isFinished(id)

  const owner = new Map<string, string>() // folded step -> the drawn step whose deck took it
  const order: string[] = []
  const seen = new Set([selectedId])
  for (let level = [selectedId]; level.length; ) {
    const next: string[] = []
    for (const k of level) {
      order.push(k)
      for (const stack = needs(k).filter(folds); stack.length; ) {
        const id = stack.pop()!
        if (owner.has(id)) continue
        owner.set(id, k)
        stack.push(...needs(id).filter(folds))
      }
      for (const d of needs(k)) if (!folds(d) && !seen.has(d)) {
        seen.add(d)
        next.push(d)
      }
    }
    level = next
  }
  const out = new Map<string, PlanNode[]>()
  for (const k of order) {
    const members = [...byId.values()].filter(n => owner.get(n.id) === k)
    if (members.length > 1 && !opened.has(DECK_PREFIX + k)) out.set(k, members)
  }
  return out
}

/**
 * What to lay out and draw. With the flag on, only the open nodes are drawn; the closed steps fold into branch decks,
 * each into the deck of the open step nearest to it (branchOwners), so every folded step is in one deck and the decks'
 * sizes add up to the folded steps; a deck of a single step is drawn as that step. A deck hangs from its owner only: a
 * need that crosses from one deck (or drawn step) into another deck is not drawn, so it never stretches the layout.
 * With a selection, the finished part of its needs folds into done decks too (see doneFolds), and so does the tree
 * of a finished root off its chain (see otherFinishedRoots), except the decks in `opened`. The plan is never changed.
 */
export function deckView(plan: Plan, selectedId: string | null, enabled: boolean, opened: ReadonlySet<string> = new Set()): DeckView {
  const decks = new Map<string, Deck>()
  const hidden = new Map<string, string[]>()
  const elsewhere = new Map<string, string[]>()
  if (!enabled) return { nodes: plan.nodes.map(n => ({ id: n.id, depends_on: n.depends_on })), decks, hidden, elsewhere }

  const byId = new Map(plan.nodes.map(n => [n.id, n]))
  const open = openSet(plan, selectedId)
  // Folded done steps are open (on the selection's chain, or under a finished root off it) but drawn as their done deck.
  const folded = new Map<string, string>() // folded step -> its done deck
  const doneAnchors = new Map<string, string[]>()
  if (selectedId !== null && byId.has(selectedId)) {
    for (const [k, members] of doneFolds(byId, selectedId, opened)) {
      const id = DECK_PREFIX + k
      decks.set(id, { id, parentId: k, members, done: true })
      for (const m of members) {
        folded.set(m.id, id)
        hidden.set(m.id, [id])
      }
      const first = byId.get(k)!.depends_on.find(d => members.some(m => m.id === d))!
      doneAnchors.set(first, [...(doneAnchors.get(first) ?? []), id])
    }
    // A finished root off the chain: its done tree folds into one done deck under it, apart from the steps the
    // selection's subtree draws or folds already (and a step another such root, earlier in the plan, took).
    const chainPart = subtreeOf(byId, selectedId)
    const taken = new Set<string>()
    for (const [root, tree] of otherFinishedRoots(byId, selectedId)) {
      const members = tree.filter(m => !chainPart.has(m) && !taken.has(m)).map(m => byId.get(m)!)
      for (const m of members) taken.add(m.id)
      const id = DECK_PREFIX + root
      if (members.length < 2 || opened.has(id)) continue
      decks.set(id, { id, parentId: root, members, done: true })
      for (const m of members) {
        folded.set(m.id, id)
        hidden.set(m.id, [id])
      }
      // the root needs one of them directly: any other is under a step the selection or an earlier root has
      const first = byId.get(root)!.depends_on.find(d => members.some(m => m.id === d))!
      doneAnchors.set(first, [...(doneAnchors.get(first) ?? []), id])
    }
  }
  // An open step drawn as itself, or the done deck it is folded into.
  const drawnAs = (d: string) => folded.get(d) ?? d
  // A done deck hangs from its owner alone, as a branch deck does: a line into it from any other drawn step, or from
  // another done deck, is left out (a drawn step's label says a need is drawn elsewhere). So every done deck sits in
  // the row right below its owner (the selected step's own one beside its open needs, where the selection's frame
  // reaches) and never under the deepest step, or the other done deck, that shares its finished steps.
  const intoDoneDeck = (from: string, at: string) => {
    const deck = decks.get(at)
    return !!deck?.done && deck.parentId !== from
  }
  // Fold the closed steps into branch decks, each step into one deck (see branchOwners). A deck of one is no shorter
  // than the step it hides, so that step is drawn instead, in its deck's place; nothing else opens. Ownership is
  // decided once: no rule opens steps to repair anything.
  const owner = branchOwners(plan, byId, open)
  const members = new Map<string, PlanNode[]>()
  for (const n of plan.nodes) {
    const o = owner.get(n.id)
    if (o !== undefined) members.set(o, [...(members.get(o) ?? []), n])
  }
  const lone = new Set<string>() // a closed step drawn as itself: the only member of its deck
  const anchors = new Map<string, string[]>() // the owner's first need in its deck -> decks to draw in its place
  for (const [parent, ms] of members) {
    if (ms.length === 1) {
      lone.add(ms[0].id)
      continue
    }
    const id = DECK_PREFIX + parent
    decks.set(id, { id, parentId: parent, members: ms })
    for (const m of ms) hidden.set(m.id, [id])
    const first = byId.get(parent)!.depends_on.find(d => owner.get(d) === parent)!
    anchors.set(first, [...(anchors.get(first) ?? []), id])
  }
  // Where an edge from `from` to its need `d` lands in the layout, or null when it is left out. A drawn step's need
  // lands on the need itself, or on the done deck it is folded into. A need in a branch deck (or a deck of one) lands
  // there only from that deck's owner: a need that crosses into another deck is not drawn and takes no part in the
  // layout, so every deck sits directly below its owner and no edge runs across the view. A deck's members are drawn
  // as one, so their needs inside the deck land nowhere either.
  const land = (from: string, d: string): string | null => {
    if (!byId.has(d)) return d
    if (open.has(d)) return intoDoneDeck(from, drawnAs(d)) ? null : drawnAs(d)
    const o = owner.get(d)
    if (o === undefined || o !== from) return null
    return lone.has(d) ? d : DECK_PREFIX + o
  }
  const nodes: DeckView['nodes'] = []
  // With a selection, the other roots are listed last: the layout keeps the input order where crossings allow, so
  // the selection's own goal comes first in the top row and the other goals sit to its right.
  const others = new Set(selectedId !== null && byId.has(selectedId) ? otherRoots(byId, selectedId) : [])
  for (const n of [...plan.nodes.filter(n => !others.has(n.id)), ...plan.nodes.filter(n => others.has(n.id))]) {
    if ((open.has(n.id) && !folded.has(n.id)) || lone.has(n.id)) {
      const depends_on: string[] = []
      const away: string[] = []
      for (const d of n.depends_on) {
        const at = land(n.id, d)
        if (at === null) {
          if (!away.includes(d)) away.push(d)
        }
        else if (!depends_on.includes(at)) depends_on.push(at)
      }
      nodes.push({ id: n.id, depends_on })
      // The needs left out: without them it could look like a step that needs nothing, so its label says so.
      if (away.length) elsewhere.set(n.id, away)
    }
    for (const id of [...(anchors.get(n.id) ?? []), ...(doneAnchors.get(n.id) ?? [])]) {
      const depends_on: string[] = []
      for (const m of decks.get(id)!.members)
        for (const d of m.depends_on) {
          const at = open.has(d) ? drawnAs(d) : null
          if (at !== null && at !== id && !intoDoneDeck(id, at) && !depends_on.includes(at)) depends_on.push(at)
        }
      nodes.push({ id, depends_on })
    }
  }
  return { nodes, decks, hidden, elsewhere }
}

/**
 * Which branch deck each closed step folds into: the deck of the open step nearest to it, the fewest needs away
 * through closed steps only; on a tie, the open step higher up (fewer needs from the top of the open part, then plan
 * order). So a step several branches need is in one deck only: the deck of the nearest one.
 * Every root is open, so every closed step is reached by some open step and is in a deck (or drawn as a deck of one).
 */
function branchOwners(plan: Plan, byId: Map<string, PlanNode>, open: ReadonlySet<string>): Map<string, string> {
  const closedNeeds = (id: string) => byId.get(id)!.depends_on.filter(d => byId.has(d) && !open.has(d))
  // The open steps from the top down: first those no open step needs, then a level of needs at a time.
  const needed = new Set<string>()
  for (const n of plan.nodes) if (open.has(n.id)) for (const d of n.depends_on) if (open.has(d)) needed.add(d)
  const order: string[] = []
  const placed = new Set<string>()
  for (let level = plan.nodes.filter(n => open.has(n.id) && !needed.has(n.id)).map(n => n.id); level.length; ) {
    const next: string[] = []
    for (const id of level) {
      if (placed.has(id)) continue
      placed.add(id)
      order.push(id)
      for (const d of byId.get(id)!.depends_on) if (open.has(d) && !placed.has(d)) next.push(d)
    }
    level = next
  }
  // From every open step at once, a need at a time: the first to reach a closed step takes it.
  const owner = new Map<string, string>()
  const queue: [string, string][] = order.map(id => [id, id])
  for (let i = 0; i < queue.length; i++) {
    const [id, o] = queue[i]
    for (const d of closedNeeds(id))
      if (!owner.has(d)) {
        owner.set(d, o)
        queue.push([d, o])
      }
  }
  return owner
}

/**
 * The order states are listed and ties are broken in: what can be started now first, then what needs attention, what
 * is under way, what waits, and what is finished.
 */
export const STATE_ORDER: NodeState[] = ['ready', 'blocked', 'doing', 'waiting', 'done']
/** A deck's status (which colours its text) follows its state (which colours its fan), so the two always agree. */
const STATUS_OF: Record<NodeState, Status> = { ready: 'todo', blocked: 'blocked', doing: 'doing', waiting: 'todo', done: 'done' }

export interface DeckLook {
  /** "23 steps" */
  title: string
  priority: Priority
  due: DueView | null
  state: NodeState
  status: Status
  held: boolean
  /** How many steps are in each state, in STATE_ORDER, when they are not all in one; else empty. */
  mix: { state: NodeState; n: number }[]
  /** The mix as words: "2 ready, 21 waiting" ('' when all are in one state). */
  breakdown: string
  /** Some step inside can be started now though the deck is not painted ready: it carries a small ready marker. */
  readyInside: boolean
}

/**
 * A deck's state: done only when every step in it is; otherwise what most of its unfinished steps are, a tie going to
 * the state first in STATE_ORDER. So a mostly waiting deck is not painted ready for the one step in it that is (that
 * step shows as a marker and in the breakdown), and a few done steps never make unfinished work look finished.
 */
function deckState(memberStates: NodeState[]): NodeState {
  const open = memberStates.filter(s => s !== 'done')
  if (!open.length) return 'done'
  let best: NodeState = 'done'
  let most = 0
  for (const s of STATE_ORDER) {
    const n = open.filter(x => x === s).length
    if (n > most) {
      best = s
      most = n
    }
  }
  return best
}

/** The look of a deck, derived from its members; `states` is `nodeStates` of the plan. */
export function deckLabel(
  deck: Deck,
  today: string,
  states: Map<string, NodeState>,
  /** The whole plan: with it, a member without a date of its own counts with the one it inherits (see effectiveDue). */
  plan?: Plan,
): DeckLook {
  const { members } = deck
  const memberStates = members.map(m => states.get(m.id) ?? 'waiting')
  const state = deckState(memberStates)
  const status = STATUS_OF[state]
  const counts = STATE_ORDER.map(s => ({ state: s, n: memberStates.filter(x => x === s).length })).filter(c => c.n > 0)
  const mix = counts.length > 1 ? counts : []
  const breakdown = mix.map(c => `${c.n} ${c.state}`).join(', ')
  const readyInside = state !== 'ready' && memberStates.includes('ready')
  // The deck shows the high mark beside its count when it holds a high-priority step that is not done; nothing else
  // marks it (its member rows carry their own marks). Only a stored priority counts: none is guessed.
  const priority: Priority = members.some((m, i) => m.priority === 'high' && memberStates[i] !== 'done') ? 'high' : 'normal'

  let due: DueView | null = null
  let nearest = Infinity
  for (const m of members) {
    const v = plan ? dueViewOf(plan, m, today) : dueView(m, today)
    if (!v) continue
    const days = daysUntil(v.date, today)
    // On a tie the member whose date is its own wins over one that only inherits it.
    if (days < nearest || (days === nearest && due?.inherited && !v.inherited)) {
      nearest = days
      due = v
    }
  }
  return { title: `${members.length} steps`, priority, due, state, status, held: members.every(m => !!m.hold), mix, breakdown, readyInside }
}
