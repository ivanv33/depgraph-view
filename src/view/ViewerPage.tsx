import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Graph from './Graph.js'
import Legend from './Legend.js'
import Panel from './Panel.js'
import Search from './Search.js'
import Toolbar from './Toolbar.js'
import { initialSearch, initialStep } from './pageState.js'
import { isTypingTarget } from './typing.js'
import { useElementEdge } from './hooks/useElementHeight.js'
import { useGrouping } from './hooks/useGrouping.js'
import { useLiveGraph } from './hooks/useLiveGraph.js'
import { useToday } from './hooks/useToday.js'
import { searchWithStep } from '../engine/pageUrl.js'
import { countStates, nodeStates } from '../engine/readiness.js'
import type { GlideSummary } from '../engine/glideMeter.js'

/**
 * The viewer: the served plan as a full-window graph (its root at the window's 0,0, so Graph's insets are window px),
 * with the toolbar and search top left, the selected step's panel at the right, the legend bottom left, a banner for a
 * reload the server rejected, and the loader's warnings in a collapsed footer. The selection is mirrored in `?step=`.
 */
export default function ViewerPage() {
  const { data, error, dismissError } = useLiveGraph()
  const [selected, setSelected] = useState<string | null>(null)
  const [grouped, toggleGrouped] = useGrouping()
  const today = useToday()
  const [fitAll, setFitAll] = useState(0)
  const [warningsOpen, setWarningsOpen] = useState(false)
  const toggleRef = useRef<HTMLButtonElement>(null)
  // The selection is read from the URL once, when the first graph arrives; until then the URL is left alone.
  const started = useRef(false)

  const plan = data?.plan ?? null
  useEffect(() => {
    if (!plan) return
    if (!started.current) {
      started.current = true
      setSelected(initialStep(location.search, plan))
      // A `?step=` the plan does not have leaves the URL once (the selection effect only writes on a change).
      const search = initialSearch(location.search, plan)
      if (search !== location.search) history.replaceState(history.state, '', `${location.pathname}${search}${location.hash}`)
      return
    }
    // A reload that drops the selected step clears the selection.
    setSelected(prev => (prev !== null && !plan.nodes.some(n => n.id === prev) ? null : prev))
  }, [plan])

  useEffect(() => {
    if (!started.current) return
    const search = searchWithStep(location.search, selected)
    if (search !== location.search) history.replaceState(history.state, '', `${location.pathname}${search}${location.hash}`)
  }, [selected])

  useEffect(() => {
    if (plan) document.title = plan.name
  }, [plan])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || isTypingTarget(e.target)) return
      setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // How far the toolbar and the panel reach into the window, their gaps from its edges included.
  const toolbarReach = useElementEdge('[data-testid="toolbar"]', 'top', true, 0)
  const panelReach = useElementEdge('[data-testid="panel"]', 'right', selected !== null, 0)
  const insets = useMemo(
    () => ({ top: toolbarReach ?? 0, right: selected ? panelReach ?? 0 : 0, bottom: 0, left: 0 }),
    [toolbarReach, panelReach, selected],
  )

  // Each finished camera glide, as the `depgraph-view:glides` CustomEvent on window: the performance spec's probe.
  const onGlides = useCallback((glides: readonly GlideSummary[]) => {
    window.dispatchEvent(new CustomEvent('depgraph-view:glides', { detail: glides }))
  }, [])
  const focusFallback = useCallback(() => toggleRef.current, [])
  const onFit = useCallback(() => setFitAll(n => n + 1), [])
  const counts = useMemo(() => (plan ? countStates(nodeStates(plan)) : null), [plan])
  const held = useMemo(() => (plan ? plan.nodes.filter(n => n.hold).length : 0), [plan])

  const warnings = data?.warnings ?? []
  return (
    <>
      {plan ? (
        <div className="fixed inset-0">
          <Graph
            plan={plan}
            selected={selected}
            onSelect={setSelected}
            grouped={grouped}
            today={today}
            insets={insets}
            fitAll={fitAll}
            onGlides={onGlides}
            focusFallback={focusFallback}
          />
        </div>
      ) : (
        !error && <p className="fixed inset-x-0 top-1/2 text-center text-sm text-white/60">loading…</p>
      )}
      {/* The toolbar with the error banner stacked under it, so the banner never covers the toolbar's controls. */}
      <div className="pointer-events-none fixed left-4 top-4 z-20 flex max-w-[calc(100vw-2rem)] flex-col items-start gap-2">
        {plan && (
          <Toolbar grouped={grouped} onToggleGroup={toggleGrouped} onFit={onFit} toggleRef={toggleRef}>
            <Search plan={plan} today={today} onPick={setSelected} />
          </Toolbar>
        )}
        {error !== null && (
          <div
            data-testid="error-banner"
            role="alert"
            className="glass pointer-events-auto flex max-w-[min(32rem,100%)] items-start gap-3 rounded-lg !border-red-400/40 px-3 py-2 text-sm text-red-100"
          >
            <span className="min-w-0 break-words">{error}</span>
            <button type="button" className="shrink-0 rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-xs hover:bg-white/10" onClick={dismissError}>
              Dismiss
            </button>
          </div>
        )}
      </div>
      {data && selected !== null && (
        <div className="fixed bottom-4 right-4 top-4 z-20 w-[min(26rem,calc(100vw-2rem))]">
          <Panel
            key={selected}
            plan={data.plan}
            id={selected}
            body={data.bodies[selected] ?? ''}
            files={data.resources[selected] ?? []}
            today={today}
            onSelect={setSelected}
            onClose={() => setSelected(null)}
          />
        </div>
      )}
      {counts && !(warningsOpen && warnings.length > 0) && <Legend counts={counts} held={held} />}
      {warnings.length > 0 && (
        // Opened, the list rises above the summary (which stays where it is) into the legend's corner, so the legend
        // steps aside until it closes.
        <details
          data-testid="warnings"
          className="glass fixed bottom-4 left-4 z-10 rounded-lg px-3 py-1.5 text-xs text-amber-100/80"
          open={warningsOpen}
          onToggle={e => setWarningsOpen(e.currentTarget.open)}
        >
          <summary className="cursor-pointer select-none">
            {warnings.length} {warnings.length === 1 ? 'warning' : 'warnings'}
          </summary>
          <ul className="glass absolute bottom-full left-0 mb-2 max-h-48 w-max max-w-[min(36rem,calc(100vw-2rem))] list-disc space-y-0.5 overflow-y-auto rounded-lg py-2 pl-7 pr-3 font-mono">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </>
  )
}
