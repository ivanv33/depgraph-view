import PriorityMark from './PriorityMark.js'
import { NODE_STATES, type NodeState } from '../engine/readiness.js'

const SWATCH: Record<NodeState, string> = {
  ready: '#6ee7a0',
  doing: '#5ac8fa',
  waiting: '#8b95a7',
  blocked: '#ff6b6b',
  done: '#3a4152',
}
const NAME: Record<NodeState, string> = { ready: 'Ready', doing: 'Doing', waiting: 'Waiting', blocked: 'Blocked', done: 'Done' }
/** The state colours and names, shared with the step search's results. */
export const STATE_SWATCH: Readonly<Record<NodeState, string>> = SWATCH
export const STATE_NAME: Readonly<Record<NodeState, string>> = NAME

/** The legend's Ready and Doing rows open the ready-now list (see ReadyList) when `list` is given. */
export interface LegendList {
  open: boolean
  onToggle: () => void
  /** The id of the list the rows open, for `aria-controls`. */
  controls: string
}

export default function Legend({ counts, held = 0, list }: { counts: Record<NodeState, number>; held?: number; list?: LegendList }) {
  return (
    <div
      data-testid="legend"
      className="glass fixed bottom-16 left-4 z-10 hidden rounded-lg px-3 py-2 font-mono text-xs text-white/70 sm:block"
    >
      <ul className="space-y-1">
        {NODE_STATES.map(s => (
          <li key={s} data-testid={`legend-state-${s}`} className="flex items-center gap-2">
            <span aria-hidden className="inline-block h-3 w-1 rounded-sm" style={{ background: SWATCH[s] }} />
            {list && (s === 'ready' || s === 'doing') ? (
              // A way in to the ready-now list: the row's name and count as one button.
              <button
                type="button"
                data-testid={`legend-open-${s}`}
                data-ready-entry={s}
                aria-expanded={list.open}
                aria-controls={list.controls}
                aria-label={`${NAME[s]}: ${counts[s]} ${counts[s] === 1 ? 'step' : 'steps'}. Show what can be worked on now`}
                title="Show what can be worked on now (R)"
                onClick={list.onToggle}
                className={`-mx-1 flex flex-1 cursor-pointer items-center gap-2 rounded px-1 text-left underline decoration-white/25 decoration-dotted underline-offset-2 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-sky-300/80 ${list.open ? 'bg-white/10 text-white' : ''}`}
              >
                <span className="flex-1">{NAME[s]}</span>
                <span data-testid={`legend-count-${s}`} className="tabular-nums text-white/90">
                  {counts[s]}
                </span>
              </button>
            ) : (
              <>
                <span className="flex-1">{NAME[s]}</span>
                <span data-testid={`legend-count-${s}`} className="tabular-nums text-white/90">
                  {counts[s]}
                </span>
              </>
            )}
          </li>
        ))}
        <li data-testid="legend-row-later" className="flex items-center gap-2">
          <span aria-hidden className="inline-block h-3 w-1 rounded-sm border border-dashed" style={{ borderColor: '#8b95a7' }} />
          <span className="flex-1">On hold</span>
          <span data-testid="legend-count-later" className="tabular-nums text-white/90">
            {held}
          </span>
        </li>
        {/* what the bars before a title mean; quiet and uncounted, normal has no mark */}
        <li data-testid="legend-priority" className="flex items-center gap-1.5 text-white/50">
          <PriorityMark priority="high" decorative />
          <span>high ·</span>{' '}
          <PriorityMark priority="low" decorative />
          <span>low priority</span>
        </li>
      </ul>
      <ul className="mt-2 space-y-1 border-t border-white/10 pt-2">
        <li data-testid="legend-edge-open" className="flex items-center gap-2">
          <span aria-hidden className="inline-block h-0.5 w-5" style={{ background: '#c9d3e6' }} />
          <span>needs (not done yet)</span>
        </li>
        <li data-testid="legend-edge-done" className="flex items-center gap-2">
          <span aria-hidden className="inline-block h-0.5 w-5" style={{ background: '#4a5266' }} />
          <span>already satisfied</span>
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden className="inline-block h-0 w-5 border-t border-dashed" style={{ borderColor: '#4a5266' }} />
          <span data-testid="legend-edge-redundant">implied by another path</span>
        </li>
      </ul>
    </div>
  )
}
