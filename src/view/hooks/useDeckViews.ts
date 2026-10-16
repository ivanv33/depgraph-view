import { useCallback, useEffect, useMemo, type RefObject } from 'react'
import { chainOf } from '../../engine/chain.js'
import { DECK_LIST_MAX, deckLabel, type DeckView } from '../../engine/grouping.js'
import { deckListed, type LabelNode } from '../../engine/nodeLabel.js'
import type { NodeState } from '../../engine/readiness.js'
import type { Plan } from '../../engine/schema.js'

/**
 * Each deck drawn as one node whose look comes from its members, by deck id. A deck lists as many member titles as fit
 * its row's room at the size its words draw (`scale`: deckScale, the cards' scale and the boost); only those counts are
 * kept from it, so a zoom step that lists as many members as before returns the very same map and re-renders no label.
 * `keyAtRef`, when given, is kept set to what those counts are at a scale, so the graph passes a new `scale` only when they
 * change (a zoom step that lists as many re-renders nothing).
 */
export function useDeckViews(
  plan: Plan,
  view: DeckView,
  today: string,
  states: Map<string, NodeState>,
  selectedId: string | null,
  scale: number,
  keyAtRef?: RefObject<(scale: number) => string>,
): Map<string, LabelNode> {
  // Each deck as its label says it (its date's scale, which the list's room is counted at), once per plan or date change.
  const labels = useMemo(() => [...view.decks.values()].map(deck => deckLabel(deck, today, states, plan)), [plan, view, today, states])
  const keyOf = useCallback(
    (s: number) => [...view.decks.values()].map((d, i) => deckListed(d.members.length, DECK_LIST_MAX, s, labels[i].due?.scale ?? 1)).join(','),
    [view, labels],
  )
  useEffect(() => {
    if (keyAtRef) keyAtRef.current = keyOf
  }, [keyAtRef, keyOf])
  const listedKey = keyOf(scale)
  return useMemo(() => {
    const chain = chainOf(plan, selectedId)
    const counts = listedKey === '' ? [] : listedKey.split(',').map(Number)
    return new Map(
      [...view.decks.values()].map((deck, i) => {
        const shown = deck.members.slice(0, counts[i])
        const label = labels[i]
        const onChain = deck.members.some(m => chain.upstream.has(m.id) || chain.downstream.has(m.id))
        const v: LabelNode = {
          id: deck.id,
          ...label,
          due: label.due ?? undefined,
          // A deck is on the selection's chain when it holds a step of it: a done deck of the chain's finished needs
          // does. A branch deck never does (the chain is always open), nor does the done deck of a finished goal off
          // the chain: with a selection, those are dim.
          chain: onChain ? 'up' : '',
          dim: !onChain && selectedId !== null,
          selected: false,
          deck: {
            ids: shown.map(m => m.id),
            titles: shown.map(m => m.title),
            priorities: shown.map(m => m.priority ?? 'normal'),
            done: shown.map(m => states.get(m.id) === 'done'),
            more: deck.members.length - shown.length,
            count: deck.members.length,
            mix: label.mix,
            readyInside: label.readyInside,
          },
        }
        return [deck.id, v] as const
      }),
    )
  }, [plan, view, states, selectedId, listedKey, labels])
}
