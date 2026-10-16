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
import { useMediaQuery } from './hooks/useMediaQuery.js'
import { useToday } from './hooks/useToday.js'
import { searchWithStep } from '../engine/pageUrl.js'
import { countStates, nodeStates } from '../engine/readiness.js'
import type { GlideSummary } from '../engine/glideMeter.js'

/**
 * The viewer: the served plan as a full-window graph (its root at the window's 0,0, so Graph's insets are window px),
 * with the toolbar and search top left, the selected step's panel, the legend bottom left, a banner for a reload the
 * server rejected, and the loader's warnings in a collapsed footer. The selection is mirrored in `?step=`.
 *
 * The panel is as tall as its content (it scrolls past the room it has). On a window at least SIDE_SHEET_MIN_W wide, or
 * a landscape one at least SIDE_SHEET_LANDSCAPE_W wide (a phone on its side, a short browser window), it
 * is a side sheet at the right, a third of the width at most (SIDE_SHEET_W), and the graph is framed in the room left of
 * it; narrower (a tablet in portrait, a narrow pane, a phone) it is a bottom sheet across the window, at most half its
 * height and always below the toolbar, and the graph is framed above it.
 */
/** The narrowest window that takes the panel as a side sheet; narrower, it is a bottom sheet. */
export const SIDE_SHEET_MIN_W = 860
/** A landscape window this wide takes the side sheet too: a bottom sheet of half its height would leave a sliver. */
export const SIDE_SHEET_LANDSCAPE_W = 600
const SIDE_SHEET_QUERY = `(min-width: ${SIDE_SHEET_MIN_W}px), (orientation: landscape) and (min-width: ${SIDE_SHEET_LANDSCAPE_W}px)`
/** Narrower than this the toolbar (up to 28rem) and the side sheet do not fit side by side: the sheet starts below it. */
const BESIDE_TOOLBAR_W = 800
/** Narrower than this an open panel leaves no room for the legend beside the graph: it steps aside while one is open. */
const LEGEND_BESIDE_PANEL_W = 900
/** The side sheet's width: a third of the window, never narrower than 18rem nor wider than 24rem. */
const SIDE_SHEET_W = 'clamp(18rem, 32vw, 24rem)'
/** The bottom sheet's tallest: half the window. */
const BOTTOM_SHEET_MAX_H = '50dvh'

export default function ViewerPage() {
  const { data, error, dismissError } = useLiveGraph()
  const [selected, setSelected] = useState<string | null>(null)
  const [grouped, toggleGrouped] = useGrouping()
  const today = useToday()
  const side = useMediaQuery(SIDE_SHEET_QUERY)
  const besideToolbar = useMediaQuery(`(min-width: ${BESIDE_TOOLBAR_W}px)`)
  const legendRoom = useMediaQuery(`(min-width: ${LEGEND_BESIDE_PANEL_W}px)`)
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

  // How far the toolbar and the panel reach into the window, their gaps from its edges included: the side sheet from
  // the right, the bottom sheet from the bottom.
  const toolbarReach = useElementEdge('[data-testid="toolbar"]', 'top', true, 0)
  // the toolbar with the error banner under it, which a panel below the toolbar keeps clear of too
  const chromeReach = useElementEdge('[data-testid="top-chrome"]', 'top', selected !== null, 0)
  const sideReach = useElementEdge('[data-testid="panel"]', 'right', selected !== null && side, 0)
  const sheetReach = useElementEdge('[data-testid="panel"]', 'bottom', selected !== null && !side, 0)
  const insets = useMemo(
    () => ({
      top: toolbarReach ?? 0,
      right: selected && side ? sideReach ?? 0 : 0,
      bottom: selected && !side ? sheetReach ?? 0 : 0,
      left: 0,
    }),
    [toolbarReach, sideReach, sheetReach, selected, side],
  )
  // The panel's box: content-tall either way. The bottom sheet, and a side sheet on a window too narrow for it beside
  // the toolbar, stop 8 px below the toolbar (and its banner).
  const below = (chromeReach ?? toolbarReach ?? 0) + 8
  const panelBox = side
    ? besideToolbar
      ? { className: 'fixed right-4 top-4 z-20 flex max-h-[calc(100dvh-2rem)] flex-col', style: { width: SIDE_SHEET_W } }
      : { className: 'fixed right-4 z-20 flex flex-col', style: { width: SIDE_SHEET_W, top: below, maxHeight: `calc(100dvh - ${below}px - 1rem)` } }
    : {
        className: 'fixed inset-x-4 bottom-4 z-20 flex flex-col',
        style: { maxHeight: `min(${BOTTOM_SHEET_MAX_H}, calc(100dvh - ${below}px - 1rem))` },
      }

  // Each finished camera glide, as the `depgraph-view:glides` CustomEvent on window: the performance spec's probe.
  const onGlides = useCallback((glides: readonly GlideSummary[]) => {
    window.dispatchEvent(new CustomEvent('depgraph-view:glides', { detail: glides }))
  }, [])
  const focusFallback = useCallback(() => toggleRef.current, [])
  const onFit = useCallback(() => setFitAll(n => n + 1), [])
  const counts = useMemo(() => (plan ? countStates(nodeStates(plan)) : null), [plan])
  const held = useMemo(() => (plan ? plan.nodes.filter(n => n.hold).length : 0), [plan])

  const warnings = data?.warnings ?? []
  // The legend steps aside while a panel is open on a window too narrow for both beside the graph (the bottom sheet, or
  // a side sheet under 900 px), and the frames then use its room; it also steps aside while the warnings list is open
  // in its corner, a moment the frames do not follow.
  const legendFramed = !(selected !== null && (!side || !legendRoom))
  const legendShown = legendFramed && !(warningsOpen && warnings.length > 0)
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
            legend={legendFramed}
          />
        </div>
      ) : (
        !error && <p className="fixed inset-x-0 top-1/2 text-center text-sm text-white/60">loading…</p>
      )}
      {/* The toolbar with the error banner stacked under it, so the banner never covers the toolbar's controls; above
          the panel, so it can always be reached. */}
      <div data-testid="top-chrome" className="pointer-events-none fixed left-4 top-4 z-30 flex max-w-[calc(100vw-2rem)] flex-col items-start gap-2">
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
        <div data-testid="panel-sheet" data-sheet={side ? 'side' : 'bottom'} className={panelBox.className} style={panelBox.style}>
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
      {counts && legendShown && <Legend counts={counts} held={held} />}
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
