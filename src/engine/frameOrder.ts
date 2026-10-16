type Step = (() => void) | null | undefined

/**
 * One frame of the graph (Graph.tsx zoomFrame): the reads first (an open deck list measuring its deck, then the fit's
 * share, which reads the page), then the writes that follow them (the deck list's place, the frame's --label-scale,
 * the edge cues), so nothing in the frame reads the page after it was written to. Every step runs even if one before
 * it throws, so the cards keep following the zoom; the first error (a read's before a write's) is thrown on after
 * them all.
 */
export function runFrame(reads: readonly Step[], writes: readonly Step[]): void {
  let failed: { error: unknown } | undefined
  for (const step of [...reads, ...writes]) {
    try {
      step?.()
    } catch (error) {
      failed ??= { error }
    }
  }
  if (failed) throw failed.error
}
