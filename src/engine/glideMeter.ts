/**
 * Times the graph's transitions frame by frame: the glide from the old layout to the new one (`layout`), a new layout
 * drawn at once (`snap`), and the camera glide that frames it (`camera`), joined into one recording from the last frame
 * at rest to the next one. Graph.tsx feeds it and writes each finished recording to `data-glide` on the
 * graph's root (JSON, for the e2e specs and the dev tools, in production builds too). It only adds up numbers it is
 * handed: a few `performance.now()` reads a frame, at rest as well (where adding up is skipped and nothing is
 * allocated), and one small record per frame while a transition runs.
 */

/** What a frame of a transition is spent on, each timed where it runs (Graph.tsx). */
export const GLIDE_PARTS = [
  /** the nodes moved to this frame's place (tween) */
  'tween',
  /** the edges moved to this frame's shape (tweenEdge, and what draws them) */
  'edges',
  /** the camera put on this frame's step (useCameraGlide) */
  'camera',
  /** the WebGL drawing of the circles' lines and arrows */
  'render',
  /** the CSS2D label layer putting every label where its node is drawn */
  'labels',
  /** the title fit's share of the graph's frame (on a glide: the selected brackets and plate) */
  'titleFit',
  /** the rest of the graph's frame: the cards' scale, the edge cues, the plate's holes, an open deck list */
  'overlay',
] as const
export type GlidePart = (typeof GLIDE_PARTS)[number]
export type GlideKind = 'layout' | 'snap' | 'camera'
/**
 * Layouts computed for the change that started the recording (and their ms), and node and edge objects built by the
 * graph library since the last frame at rest.
 */
export type GlideCount = 'layouts' | 'layoutMs' | 'nodeObjects' | 'edgeObjects'

export interface GlideSummary {
  /** 1 for the first recording of this graph, and so on. */
  seq: number
  kinds: GlideKind[]
  /** Frames drawn while something moved. */
  frames: number
  /** From the last frame at rest to the first one at rest after it, ms. */
  durationMs: number
  /**
   * Time between frames, ms: the first from the last frame at rest (it holds the change's own commit), the last to the
   * first frame at rest after it (it holds the last frame's work).
   */
  interval: { mean: number; p95: number; max: number }
  /** Each part's ms per frame: its mean over the frames, its median frame (nearest rank) and its longest frame. */
  parts: Record<GlidePart, { mean: number; p50: number; max: number }>
  counts: Record<GlideCount, number>
}

const zeroCounts = (): Record<GlideCount, number> => ({ layouts: 0, layoutMs: 0, nodeObjects: 0, edgeObjects: 0 })
const round = (n: number) => Math.round(n * 100) / 100
/** The nearest-rank `q` quantile of `sorted` (ascending), 0 when empty. */
const rank = (sorted: number[], q: number) => (sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)] : 0)

export function glideMeter(keep = 20) {
  let seq = 0
  let open = false
  let kinds: GlideKind[] = []
  // the last frame seen at rest, where a recording's first interval and its duration start
  let restAt = NaN
  // one record per frame: its time and each part's ms
  let frames: { at: number; ms: Float64Array }[] = []
  let counts = zeroCounts()
  // work done outside an animation frame (a glide's first step, applied as it starts), for the next frame drawn
  const carried = new Float64Array(GLIDE_PARTS.length)
  let carrying = false
  const zero = () => {
    if (counts.layouts || counts.layoutMs || counts.nodeObjects || counts.edgeObjects) counts = zeroCounts()
  }
  // layouts computed and not yet drawn: a render may come a frame or more before its commit starts the transition
  let laid = { n: 0, ms: 0 }
  const done: GlideSummary[] = []

  const summarize = (endAt: number): GlideSummary => {
    const intervals: number[] = []
    let prev = restAt
    for (const at of [...frames.map(f => f.at), endAt]) {
      if (Number.isFinite(prev)) intervals.push(at - prev)
      prev = at
    }
    const sorted = [...intervals].sort((a, b) => a - b)
    const n = frames.length
    const parts = {} as GlideSummary['parts']
    GLIDE_PARTS.forEach((p, i) => {
      const each = frames.map(f => f.ms[i]).sort((a, b) => a - b)
      const sum = each.reduce((a, b) => a + b, 0)
      parts[p] = { mean: round(n ? sum / n : 0), p50: round(rank(each, 0.5)), max: round(n ? each[n - 1] : 0) }
    })
    const first = Number.isFinite(restAt) ? restAt : (frames[0]?.at ?? 0)
    return {
      seq,
      kinds,
      frames: n,
      durationMs: round(n ? endAt - first : 0),
      interval: {
        mean: round(intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : 0),
        p95: round(rank(sorted, 0.95)),
        max: round(sorted.length ? sorted[sorted.length - 1] : 0),
      },
      parts,
      counts: { ...counts, layoutMs: round(counts.layoutMs) },
    }
  }

  return {
    /** A transition of this kind starts (a later one while it runs joins it). */
    begin(kind: GlideKind) {
      if (!open) {
        open = true
        kinds = []
        frames = []
        carried.fill(0)
        carrying = false
      }
      if (!kinds.includes(kind)) kinds.push(kind)
      if (kind !== 'camera') {
        counts.layouts += laid.n
        counts.layoutMs += laid.ms
        laid = { n: 0, ms: 0 }
      }
    },
    /** `ms` spent on `part` in the frame drawn at `at` (its animation frame time); nothing while at rest. */
    add(part: GlidePart, ms: number, at: number) {
      if (!open) return
      let f = frames[frames.length - 1]
      if (!f || f.at !== at) {
        f = { at, ms: new Float64Array(GLIDE_PARTS.length) }
        if (carrying) {
          for (let i = 0; i < carried.length; i++) f.ms[i] += carried[i]
          carried.fill(0)
          carrying = false
        }
        frames.push(f)
      }
      f.ms[GLIDE_PARTS.indexOf(part)] += ms
    },
    /**
     * `ms` spent on `part` outside any animation frame (a glide's first step, applied in the effect that starts it):
     * it counts toward the next frame drawn, not as a frame of its own; nothing while at rest.
     */
    carry(part: GlidePart, ms: number) {
      if (!open) return
      carried[GLIDE_PARTS.indexOf(part)] += ms
      carrying = true
    },
    count(what: GlideCount, by = 1) {
      counts[what] += by
    },
    /**
     * Runs `lay` (a layout of the drawn graph) and hands back what it returns; it counts, with its ms, toward the next
     * `layout` or `snap` transition to begin (layouts, layoutMs).
     */
    layout<T>(lay: () => T): T {
      const t0 = performance.now()
      const out = lay()
      laid = { n: laid.n + 1, ms: laid.ms + performance.now() - t0 }
      return out
    },
    /** The layouts computed so far start no transition (nothing moves, or it is the first): they count toward none. */
    forgetLayouts() {
      laid = { n: 0, ms: 0 }
    },
    recording: () => open,
    /**
     * Once a frame, at its time `at`: `busy` while anything still moves. The first frame found at rest ends the
     * recording (its parts are not counted, the wait for it is) and hands back its summary; null otherwise.
     */
    settle(busy: boolean, at: number): GlideSummary | null {
      if (busy && open) return null
      if (!open) {
        restAt = at
        zero()
        return null
      }
      if (frames.length && frames[frames.length - 1].at === at) frames.pop()
      open = false
      seq++
      const s = summarize(at)
      done.push(s)
      if (done.length > keep) done.shift()
      restAt = at
      counts = zeroCounts()
      frames = []
      carried.fill(0)
      carrying = false
      return s
    },
    /** The last `keep` recordings, oldest first. */
    history: (): readonly GlideSummary[] => done,
  }
}
export type GlideMeter = ReturnType<typeof glideMeter>
