import { useMemo } from 'react'
import Markdown from './Markdown.js'
import PriorityMark from './PriorityMark.js'
import { STATE_NAME, STATE_SWATCH } from './Legend.js'
import { fileUrl } from './files.js'
import { shortDate } from '../engine/due.js'
import { PRIORITY_NAME } from '../engine/priorityMark.js'
import { nodeStates } from '../engine/readiness.js'
import type { Plan, PlanNode } from '../engine/schema.js'

export interface PanelProps {
  plan: Plan
  /** The selected step. */
  id: string
  /** The markdown body of the step's file, below its frontmatter. */
  body: string
  /** The step's folder files, as paths relative to the folder. */
  files: string[]
  today: string
  onSelect: (id: string) => void
  onClose: () => void
}

const label = (n: PlanNode) => n.title || n.id

function StepList({ testId, heading, steps, onSelect }: { testId: string; heading: string; steps: PlanNode[]; onSelect: (id: string) => void }) {
  if (steps.length === 0) return null
  return (
    <section data-testid={testId} className="mt-4">
      <h3 className="mb-1 font-mono text-[11px] uppercase tracking-wide text-white/50">{heading}</h3>
      <ul className="space-y-0.5">
        {steps.map(s => (
          <li key={s.id}>
            <button
              type="button"
              className="w-full truncate rounded-md px-2 py-1 text-left text-sm text-white/80 hover:bg-white/10 hover:text-white"
              onClick={() => onSelect(s.id)}
            >
              {label(s)}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** The selected step: its title and marks, its markdown body, the steps it needs and that need it, and its files. */
export default function Panel({ plan, id, body, files, today, onSelect, onClose }: PanelProps) {
  const states = useMemo(() => nodeStates(plan), [plan])
  const node = plan.nodes.find(n => n.id === id)
  if (!node) return null
  const byId = new Map(plan.nodes.map(n => [n.id, n]))
  const dependsOn = node.depends_on.flatMap(d => byId.get(d) ?? [])
  const neededBy = plan.nodes.filter(n => n.depends_on.includes(id))
  const state = states.get(id) ?? 'waiting'
  return (
    <aside data-testid="panel" className="glass flex h-full flex-col overflow-y-auto rounded-xl p-4 text-white/90">
      <div className="flex items-start gap-2">
        <h2 className="min-w-0 flex-1 break-words text-lg font-semibold">{label(node)}</h2>
        <button
          type="button"
          aria-label="Close"
          className="shrink-0 rounded-md px-2 py-0.5 text-white/60 hover:bg-white/10 hover:text-white max-sm:min-h-9"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-white/70">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full ring-1 ring-white/25" style={{ background: STATE_SWATCH[state] }} />
          <span data-testid="panel-status">{STATE_NAME[state]}</span>
        </span>
        {node.priority && (
          <span data-testid="panel-priority" className="inline-flex items-center gap-1.5">
            <PriorityMark priority={node.priority} decorative />
            {PRIORITY_NAME[node.priority]}
          </span>
        )}
        {node.due && <span data-testid="panel-due">Due {shortDate(node.due, today)}</span>}
      </div>
      {node.tags.length > 0 && (
        <ul data-testid="panel-tags" className="mt-2 flex flex-wrap gap-1">
          {node.tags.map(t => (
            <li key={t} className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-white/70">
              {t}
            </li>
          ))}
        </ul>
      )}
      {body.trim() && (
        <div className="mt-4 text-sm">
          <Markdown markdown={body} nodeId={id} />
        </div>
      )}
      <StepList testId="depends-on" heading="Depends on" steps={dependsOn} onSelect={onSelect} />
      <StepList testId="needed-by" heading="Needed by" steps={neededBy} onSelect={onSelect} />
      {files.length > 0 && (
        <section data-testid="files" className="mt-4">
          <h3 className="mb-1 font-mono text-[11px] uppercase tracking-wide text-white/50">Files</h3>
          <ul className="space-y-0.5">
            {files.map(f => (
              <li key={f}>
                <a
                  href={fileUrl(id, f)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate rounded-md px-2 py-1 font-mono text-xs text-sky-300 hover:bg-white/10"
                >
                  {f}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  )
}
