import { watch } from 'chokidar'
import { GraphError, loadGraphFile, type LoadResult } from './loader.js'

/** One loaded graph and when it was read. */
export type Snapshot = { result: LoadResult; generatedAt: string }

export type LiveEvent = { type: 'reload'; generatedAt: string } | { type: 'error'; message: string }

/** Where the server reads the current graph from; `on` returns an unsubscribe function. */
export interface GraphSource {
  current(): Snapshot
  on(listener: (e: LiveEvent) => void): () => void
  close(): Promise<void>
}

/** The graph at `jsonPath`, loaded once; never emits. Throws GraphError on a bad file. */
export function staticSource(jsonPath: string): GraphSource {
  const snapshot: Snapshot = { result: loadGraphFile(jsonPath), generatedAt: new Date().toISOString() }
  return {
    current: () => snapshot,
    on: () => () => {},
    close: async () => {},
  }
}

/** `e` for the page: a GraphError's own text; anything else only by its code, since I/O messages carry absolute paths. */
function pageMessage(e: unknown, what: string): string {
  if (e instanceof GraphError) return e.message
  const code = (e as NodeJS.ErrnoException | null)?.code
  return `could not ${what}${typeof code === 'string' ? ` (${code})` : ''}`
}

/** A source that follows its files; `ready` resolves once the watcher is live. */
export interface WatchedSource extends GraphSource {
  ready(): Promise<void>
}

/** The JSON file, every node's md file and every node folder (chokidar watches a folder recursively). */
function watchList(jsonPath: string, result: LoadResult): Set<string> {
  return new Set([jsonPath, ...Object.values(result.mdFiles), ...Object.values(result.folders)])
}

/**
 * The graph at `jsonPath`, loaded once (throws GraphError on a bad file) and reloaded `debounceMs` after
 * the last change to its files. A good reload replaces the snapshot and sends `reload`; a bad one keeps
 * the snapshot and sends `error`. The reload is synchronous, so a change that lands while it runs is
 * queued behind it and restarts the timer: exactly one more reload, never a pile-up.
 */
export function watchedSource(jsonPath: string, debounceMs = 150): WatchedSource {
  let snapshot: Snapshot = { result: loadGraphFile(jsonPath), generatedAt: new Date().toISOString() }
  let watched = watchList(jsonPath, snapshot.result)
  const listeners = new Set<(e: LiveEvent) => void>()
  const emit = (e: LiveEvent) => {
    for (const listener of [...listeners]) listener(e)
  }
  let timer: NodeJS.Timeout | undefined
  let closed = false

  const watcher = watch([...watched], { ignoreInitial: true, followSymlinks: false })
  let live = false
  const ready = new Promise<void>(resolve => watcher.once('ready', () => {
    live = true
    resolve()
  }))

  const reload = () => {
    timer = undefined
    if (closed) return
    let result: LoadResult
    try {
      result = loadGraphFile(jsonPath)
    } catch (e) {
      return emit({ type: 'error', message: pageMessage(e, 'reload the graph') })
    }
    snapshot = { result, generatedAt: new Date().toISOString() }
    const next = watchList(jsonPath, result)
    const gone = [...watched].filter(p => !next.has(p))
    const added = [...next].filter(p => !watched.has(p))
    if (gone.length) watcher.unwatch(gone)
    if (added.length) watcher.add(added)
    watched = next
    emit({ type: 'reload', generatedAt: snapshot.generatedAt })
  }

  // Before `ready`, chokidar reports a symlink in a watched folder as `add` despite ignoreInitial.
  watcher.on('all', () => {
    if (closed || !live) return
    clearTimeout(timer)
    timer = setTimeout(reload, debounceMs)
  })
  watcher.on('error', e => {
    if (!closed) emit({ type: 'error', message: pageMessage(e, 'watch the graph files') })
  })

  return {
    current: () => snapshot,
    on: listener => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    ready: () => ready,
    close: async () => {
      if (closed) return
      closed = true
      clearTimeout(timer)
      listeners.clear()
      await watcher.close()
    },
  }
}
