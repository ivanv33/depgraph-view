import { useCallback, useEffect, useState } from 'react'
import type { Plan } from '../../engine/schema.js'

/** What `GET /api/graph` returns. */
export type GraphPayload = {
  plan: Plan
  resources: Record<string, string[]>
  bodies: Record<string, string>
  warnings: string[]
  generatedAt: string
}

export interface LiveGraphDeps {
  fetchGraph?: () => Promise<GraphPayload>
  openEvents?: () => EventTarget & { close(): void }
}

async function fetchGraphDefault(): Promise<GraphPayload> {
  const res = await fetch('/api/graph')
  if (!res.ok) throw new Error(`GET /api/graph: ${res.status}`)
  return (await res.json()) as GraphPayload
}

const openEventsDefault = () => new EventSource('/events')

/** The message an SSE `error` event carries, or null for a bare `Event('error')` (the stream dropping; it retries). */
function messageOf(e: Event): string | null {
  if (!(e instanceof MessageEvent) || typeof e.data !== 'string') return null
  try {
    const parsed = JSON.parse(e.data) as { message?: unknown }
    return typeof parsed.message === 'string' ? parsed.message : e.data
  } catch {
    return e.data
  }
}

/**
 * The served graph, kept live: fetched once on mount and again on each `reload` event (which clears `error`). An
 * `error` event with data (a reload the server rejected) sets `error` and keeps the last good `data`; so does a failed
 * fetch. The event stream closes on unmount.
 */
export function useLiveGraph(deps: LiveGraphDeps = {}): { data: GraphPayload | null; error: string | null; dismissError: () => void } {
  const [data, setData] = useState<GraphPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The deps are read once, on mount: a caller's inline functions must not reopen the stream on every render.
  const [fetchGraph] = useState(() => deps.fetchGraph ?? fetchGraphDefault)
  const [openEvents] = useState(() => deps.openEvents ?? openEventsDefault)

  useEffect(() => {
    let live = true
    // Each load stamps a number, so a slow earlier fetch can never land over a later one.
    let seq = 0
    const load = (clearError: boolean) => {
      const mine = ++seq
      fetchGraph().then(
        next => {
          if (!live || mine !== seq) return
          setData(next)
          if (clearError) setError(null)
        },
        (err: unknown) => {
          if (!live || mine !== seq) return
          setError(err instanceof Error ? err.message : String(err))
        },
      )
    }
    const events = openEvents()
    const onReload = () => load(true)
    const onError = (e: Event) => {
      const message = messageOf(e)
      if (message !== null) setError(message)
    }
    events.addEventListener('reload', onReload)
    events.addEventListener('error', onError)
    load(false)
    return () => {
      live = false
      events.removeEventListener('reload', onReload)
      events.removeEventListener('error', onError)
      events.close()
    }
  }, [fetchGraph, openEvents])

  const dismissError = useCallback(() => setError(null), [])
  return { data, error, dismissError }
}
