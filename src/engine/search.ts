import type { Plan, PlanNode, Priority } from './schema.js'

/** The tie-break inside a rank: high first, low last. */
const PRIO_ORDER: Record<Priority, number> = { high: 0, normal: 1, low: 2 }

/** Whether `word` starts a word of `text`: at its start or right after a character that is not a letter or digit. */
function startsWord(text: string, word: string): boolean {
  for (let i = text.indexOf(word); i >= 0; i = text.indexOf(word, i + 1)) {
    if (i === 0 || !/[\p{L}\p{N}]/u.test(text[i - 1])) return true
  }
  return false
}

/**
 * The steps whose title holds every word of `query` (case-insensitive, anywhere, in any order; a step without a
 * title is matched by its id), or whose id holds the query (spaces read as `-`). Best first: the title starts with the
 * query, then every query word starts a word of the title, then the rest of the title matches, then the id-only
 * matches. Within a rank the stored priority breaks the tie (high, then normal, then low), then plan order. Priority
 * never lifts a step above a better match. An empty query finds nothing.
 */
export function searchSteps(plan: Plan, query: string): PlanNode[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!q) return []
  const words = q.split(' ')
  const ranked: { node: PlanNode; rank: number; prio: number; i: number }[] = []
  plan.nodes.forEach((node, i) => {
    const text = (node.title || node.id).toLowerCase().replace(/\s+/g, ' ')
    const inTitle = words.every(w => text.includes(w))
    if (!inTitle && !node.id.includes(q.replace(/ /g, '-'))) return
    const rank = !inTitle ? 3 : text.startsWith(q) ? 0 : words.every(w => startsWord(text, w)) ? 1 : 2
    ranked.push({ node, rank, prio: PRIO_ORDER[node.priority ?? 'normal'], i })
  })
  return ranked.sort((a, b) => a.rank - b.rank || a.prio - b.prio || a.i - b.i).map(r => r.node)
}
