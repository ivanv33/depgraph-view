/**
 * A big made-up plan for timing the graph's transitions (transition-performance.spec.ts): generic titles, nothing real.
 *
 * The goal over nine areas. Areas a0..a6 each need seven steps, each of those four leaves (a0-0 needs a0-0-0 ..
 * a0-0-3); in a1 the leaves of a1-0..a1-3 are done, so selecting a1 folds them into done decks. Area a7 needs thirty
 * steps that need nothing (a block of wrapped needs). Area a8 needs six steps of six leaves each, and three of a8's
 * leaves are also needed by a step in a0 (lines across branches). 327 steps in all.
 */

const VERBS = ['Sort', 'Fix', 'Paint', 'Order', 'Label', 'Move', 'Check', 'Replace', 'Plant', 'Ask about', 'Measure', 'Clear', 'Write', 'Book', 'Price']
const THINGS = ['the shelf', 'the gate', 'the back fence', 'seed trays', 'every jar', 'the compost bins', 'the water butt', 'the hinge', 'the early beans', 'the hedge', 'the shed floor', 'the gutter', 'the calendar', 'the van', 'the paint']
const TAILS = ['', '', ' before the first frost', ' with the spare boards', ' and note what is missing', ' once the rain stops', ' for the north bed', '']

let n = 0
const title = () => {
  const i = n++
  return `${VERBS[i % VERBS.length]} ${THINGS[(i * 7) % THINGS.length]}${TAILS[(i * 3) % TAILS.length]}`
}

type Step = { id: string; title: string; description: string; status: string; tags: string[]; depends_on: string[] }
const step = (id: string, depends_on: string[], status = 'todo'): Step => ({ id, title: title(), description: '', status, tags: [], depends_on })
const range = (k: number) => Array.from({ length: k }, (_, i) => i)

/** The plan, with `added` more steps that a0-0 needs (n0, n1, ...): "a step expanded into new steps". */
export function bigPlan(added = 0) {
  n = 0
  const areas = range(9).map(a => `a${a}`)
  const nodes: Step[] = [step('goal', areas)]
  for (let a = 0; a < 7; a++) {
    const needs = range(7).map(k => `a${a}-${k}`)
    nodes.push(step(`a${a}`, needs))
    for (let k = 0; k < 7; k++) {
      const leaves = range(4).map(j => `a${a}-${k}-${j}`)
      const extra = a === 0 && k === 6 ? ['a8-0-0', 'a8-1-0', 'a8-2-0'] : []
      const more = a === 0 && k === 0 ? range(added).map(i => `n${i}`) : []
      nodes.push(step(`a${a}-${k}`, [...leaves, ...extra, ...more]))
      for (const leaf of leaves) nodes.push(step(leaf, [], a === 1 && k < 4 ? 'done' : 'todo'))
    }
  }
  const block = range(30).map(k => `a7-${k}`)
  nodes.push(step('a7', block))
  for (const id of block) nodes.push(step(id, []))
  const mids = range(6).map(k => `a8-${k}`)
  nodes.push(step('a8', mids))
  for (const m of mids) {
    const leaves = range(6).map(j => `${m}-${j}`)
    nodes.push(step(m, leaves))
    for (const leaf of leaves) nodes.push(step(leaf, []))
  }
  for (const i of range(added)) nodes.push(step(`n${i}`, []))
  return { name: 'Big made-up plan', nodes }
}
