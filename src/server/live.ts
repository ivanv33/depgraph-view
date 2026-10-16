import { loadGraphFile, type LoadResult } from './loader.js'

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
