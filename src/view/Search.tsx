import { useEffect, useId, useMemo, useState } from 'react'
import { STATE_NAME, STATE_SWATCH } from './Legend.js'
import PriorityMark from './PriorityMark.js'
import { shortDate } from '../engine/due.js'
import { nodeStates } from '../engine/readiness.js'
import type { Plan } from '../engine/schema.js'
import { searchSteps } from '../engine/search.js'

export interface SearchProps {
  plan: Plan
  today: string
  /** Selects the step (the camera frames it). */
  onPick: (id: string) => void
}

/**
 * Jump to a step by its title or id: an always-visible box. Typing filters the plan's steps (see searchSteps);
 * Up / Down move the highlight, Enter or a click picks that step and clears the box, Escape clears the box. The
 * results hide while the focus is elsewhere and the text stays for when it comes back.
 * Nothing in the plan changes.
 */
export default function Search({ plan, today, onPick }: SearchProps) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  // The results hide while the focus is elsewhere (the text stays) and come back when the box takes it again.
  const [away, setAway] = useState(false)
  const listId = useId()
  const states = useMemo(() => nodeStates(plan), [plan])
  // Every match is listed; the list scrolls, about eight rows tall.
  const matches = useMemo(() => searchSteps(plan, query), [plan, query])
  const shown = away ? [] : matches
  const at = Math.min(active, Math.max(0, shown.length - 1))
  const optionId = (i: number) => `${listId}-opt-${i}`
  // The highlighted result stays in view as Up / Down move past the visible rows.
  useEffect(() => {
    document.getElementById(`${listId}-opt-${at}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [listId, at, shown.length])

  const clear = () => {
    setQuery('')
    setActive(0)
  }
  const pick = (id: string) => {
    onPick(id)
    clear()
  }

  // Said politely to a screen reader as it changes, and shown under the list.
  const hinted = !!query.trim() && !away
  const status = shown.length === 0 ? 'No step matches' : shown.length === 1 ? '1 step matches' : `${shown.length} steps match`

  return (
    <div data-testid="search-box" className="w-[min(20rem,calc(100vw-2rem))]">
      <input
        data-testid="search"
        role="combobox"
        aria-label="Search steps"
        aria-expanded={shown.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={shown.length ? optionId(at) : undefined}
        placeholder="Find a step…"
        spellCheck={false}
        autoComplete="off"
        className="w-full rounded-md border border-white/10 bg-black/40 px-3 py-1 text-sm max-sm:min-h-9"
        value={query}
        onFocus={() => setAway(false)}
        onBlur={() => setAway(true)}
        onChange={e => {
          setAway(false)
          setQuery(e.target.value)
          setActive(0)
        }}
        onKeyDown={e => {
          if (e.key === 'Escape') {
            if (!query) return
            e.preventDefault()
            e.stopPropagation()
            clear()
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            if (shown.length) setActive(Math.max(0, Math.min(shown.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1))))
          } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault()
            if (shown[at]) pick(shown[at].id)
          }
        }}
      />
      <ul
        id={listId}
        role="listbox"
        aria-label="Matching steps"
        // a pointer down on a result or the list's scrollbar keeps the focus in the field
        onMouseDown={e => e.preventDefault()}
        className={shown.length ? 'mt-1 max-h-[min(16.5rem,50vh)] overflow-y-auto' : 'hidden'}
      >
        {shown.map((n, i) => {
          const state = states.get(n.id) ?? 'waiting'
          return (
            <li
              key={n.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === at}
              data-testid="search-option"
              data-node-id={n.id}
              className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm ${i === at ? 'bg-white/15 text-white' : 'text-white/80 hover:bg-white/5'}`}
              // only a pointer that moves takes the highlight: a list scrolled under a still pointer leaves it with the keys
              onMouseMove={() => i !== at && setActive(i)}
              onClick={() => pick(n.id)}
            >
              <span aria-hidden data-state-dot className="inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/25" style={{ background: STATE_SWATCH[state] }} />
              {/* a column as wide as the mark on every row, so titles line up; empty for normal */}
              <span data-priority-col className="inline-flex w-[var(--mark-w)] shrink-0 items-center">
                <PriorityMark priority={n.priority} />
              </span>
              <span className="min-w-0 flex-1 truncate" title={n.title || n.id}>
                {n.title || n.id}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-white/50">
                {STATE_NAME[state]}
                {n.due ? ` · ${shortDate(n.due, today)}` : ''}
              </span>
            </li>
          )
        })}
      </ul>
      {/* Always in the page: a screen reader announces changes only to a live region it already saw. */}
      <p data-testid="search-hint" role="status" aria-live="polite" className={hinted ? 'mt-1 px-1 text-[11px] text-white/40' : 'sr-only'}>
        {hinted ? status : ''}
      </p>
      {hinted && <p className="mt-0.5 px-1 text-[11px] text-white/40">↑↓ choose · Enter selects · Esc clears</p>}
    </div>
  )
}
