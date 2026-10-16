import { expect, test, type Page } from '@playwright/test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { bigPlan } from './bigPlan.js'
import { newFixtureDir, writeFixture, type FixtureStep } from './fixtureFolder.js'
import { waitForStill } from './helpers.js'
import { E2E_PORT, serve } from './serve.js'

/**
 * The graph's transitions on a big plan are timed frame by frame (glideMeter.ts, written to data-glide on the graph's
 * root when one ends). On a made-up plan of 327 steps, at a laptop window and a phone: steps added under the selected
 * step (the new layout drawn at once, the camera framing it), a deck unfolded and folded (Group on, its area selected
 * and closed again), and Group on then off. Each recording has its shape, the layout is computed once per change, and
 * the frames keep under a bound with room to spare on a loaded machine running a software GPU.
 *
 * GLIDE_OUT=<file> appends every recording as a line of JSON; GLIDE_SHOTS=<dir> saves each transition mid-glide and at
 * rest. Neither is set in a normal run.
 */

const OUT = process.env.GLIDE_OUT
const SHOTS = process.env.GLIDE_SHOTS

/**
 * The longest frame a transition may take on this suite's software GPU, ms (seen up to ~800, the frame a big view
 * change commits in), and the WebGL draw per frame of all its frames but the slowest, ms. One frame may compile a
 * line's shaders once (a look not drawn before, ~500); the others must not. While the lines' shaders were compiled
 * again whenever the library rebuilt them, that was 24-526 over 84 recordings (on F and on steps added only one or two
 * frames compiled, so the median frame mostly drew in 1-10 and does not tell the two apart); with them compiled once, 0.2-3
 * over 84.
 */
const MAX_FRAME_MS = 1500
const RENDER_REST_MS = 15

/** The WebGL draw per frame, ms, of every frame of `s` but its slowest. */
const renderBarSlowest = (s: Summary) => (s.frames > 1 ? (s.parts.render.mean * s.frames - s.parts.render.max) / (s.frames - 1) : 0)

type Summary = {
  seq: number
  kinds: string[]
  frames: number
  durationMs: number
  interval: { mean: number; p95: number; max: number }
  parts: Record<string, { mean: number; p50: number; max: number }>
  counts: Record<string, number>
}

const PLAN_NAME = 'Big made-up plan'

let dir: string
let url: string
let stop: () => Promise<void>

/** Each test serves a fresh folder of the 327-step plan through the CLI. */
test.beforeEach(async () => {
  dir = newFixtureDir()
  writeFixture(dir, PLAN_NAME, bigPlan().nodes as FixtureStep[])
  const server = await serve(dir, E2E_PORT + 1)
  url = server.url
  stop = server.stop
})
test.afterEach(async () => {
  await stop?.()
  if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/** The last recording, on the graph's root. */
const lastGlide = (page: Page) =>
  page.evaluate(() => {
    const raw = document.querySelector<HTMLElement>('[data-testid="graph"]')?.dataset.glide
    return raw ? (JSON.parse(raw) as Summary) : null
  })
/**
 * The first recording numbered after `seq` (the graph hands its last 20 out in `depgraph-view:glides` events, which
 * open() keeps on the test's own window.__seenGlides).
 */
const firstGlideAfter = (page: Page, seq: number) =>
  page.evaluate(n => ((window as { __seenGlides?: Summary[] }).__seenGlides ?? []).find(g => g.seq > n) ?? null, seq)

/**
 * Runs `act` and hands back the recording of the transition it starts, once the graph is still again. A shot mid-glide
 * and one at rest are saved under GLIDE_SHOTS.
 */
async function timed(page: Page, name: string, vp: { width: number; height: number }, act: () => Promise<unknown>): Promise<Summary> {
  const before = (await lastGlide(page))?.seq ?? 0
  await act()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-${vp.width}x${vp.height}-mid.png` })
  await expect.poll(async () => (await lastGlide(page))?.seq ?? 0, { timeout: 30000 }).toBeGreaterThan(before)
  await waitForStill(page, 30000)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-${vp.width}x${vp.height}-rest.png` })
  // the recording of this action: the first after `before` (a whole-plan fit that lands later is one more)
  const s = (await firstGlideAfter(page, before))!
  if (OUT) await writeFile(OUT, JSON.stringify({ name, vp: `${vp.width}x${vp.height}`, ...s }) + '\n', { flag: 'a' })
  return s
}

/** Layouts computed for one change: one (the CLI serves a production Vite build, no React StrictMode). */
const LAYOUTS = 1

const PARTS = ['tween', 'edges', 'camera', 'render', 'labels', 'titleFit', 'overlay']

function checkShape(s: Summary, what: string) {
  expect(s.frames, `${what}: frames drawn`).toBeGreaterThan(0)
  expect(Object.keys(s.parts).sort(), what).toEqual([...PARTS].sort())
  for (const p of PARTS) {
    expect(s.parts[p].mean, `${what}: ${p} mean`).toBeGreaterThanOrEqual(0)
    expect(s.parts[p].max, `${what}: ${p} max`).toBeGreaterThanOrEqual(s.parts[p].mean)
    expect(s.parts[p].max, `${what}: ${p} max`).toBeGreaterThanOrEqual(s.parts[p].p50)
    expect(s.parts[p].p50, `${what}: ${p} median`).toBeGreaterThanOrEqual(0)
  }
  expect(s.interval.max, what).toBeGreaterThanOrEqual(s.interval.p95)
  expect(s.interval.p95, what).toBeGreaterThan(0)
  expect(s.durationMs, what).toBeGreaterThan(0)
  expect(s.counts, what).toEqual(expect.objectContaining({ layouts: expect.any(Number), layoutMs: expect.any(Number), nodeObjects: expect.any(Number), edgeObjects: expect.any(Number) }))
}

function checkBound(s: Summary, what: string) {
  expect(s.interval.max, `${what}: longest frame ${JSON.stringify(s)}`).toBeLessThan(MAX_FRAME_MS)
  expect(renderBarSlowest(s), `${what}: WebGL draw per frame but the slowest ${JSON.stringify(s)}`).toBeLessThan(RENDER_REST_MS)
}

async function open(page: Page, vp: { width: number; height: number }) {
  await page.addInitScript(() => {
    localStorage.setItem('depgraph.group', '0')
    window.addEventListener('depgraph-view:glides', e => {
      ;(window as { __seenGlides?: unknown }).__seenGlides = (e as CustomEvent<unknown>).detail
    })
  })
  await page.setViewportSize(vp)
  await page.goto(url)
  await expect(page.getByTestId('node-label')).toHaveCount(327, { timeout: 30000 })
  await waitForStill(page, 30000)
}

const label = (page: Page, id: string) => page.locator(`[data-testid="node-label"][data-node-id="${id}"]`)

for (const vp of [
  { width: 1280, height: 720 },
  { width: 390, height: 844 },
]) {
  test.describe(`at ${vp.width}x${vp.height}`, () => {
    test('F, a camera glide alone over the whole plan: no step built again, and it glides over several frames', async ({ page }) => {
      test.setTimeout(180000)
      await open(page, vp)
      await label(page, 'a3-2').dispatchEvent('click')
      await expect(label(page, 'a3-2')).toHaveAttribute('data-selected', 'true')
      await waitForStill(page, 30000)
      // dispatched, not clicked: at 390x844 the open panel covers the toolbar's Fit button
      const s = await timed(page, 'fit', vp, () => page.getByTestId('fit-plan').dispatchEvent('click'))
      checkShape(s, 'F')
      expect(s.kinds, 'only the camera moves').toEqual(['camera'])
      expect(s.counts.nodeObjects, 'no step is built again for a camera move').toBe(0)
      expect(s.frames, 'the glide is drawn, not jumped').toBeGreaterThan(1)
      checkBound(s, 'F')
    })

    test('eight steps added under the selected step: drawn at once, framed by one camera glide, the layout computed once', async ({ page }) => {
      test.setTimeout(180000)
      await open(page, vp)
      await label(page, 'a0-0').dispatchEvent('click')
      await expect(label(page, 'a0-0')).toHaveAttribute('data-selected', 'true')
      await waitForStill(page, 30000)
      const s = await timed(page, 'add', vp, async () => {
        // the eight new md files first, then graph.json naming them (the shape writeFixture writes)
        const plan = bigPlan(8)
        for (const step of plan.nodes.filter(n => /^n\d+$/.test(n.id))) {
          await mkdir(join(dir, 'nodes', step.id), { recursive: true })
          await writeFile(join(dir, 'nodes', step.id, `${step.id}.md`), `---\ntitle: ${step.title}\nstatus: ${step.status}\n---\n`)
        }
        const nodes = plan.nodes.map(n => ({ id: n.id, md: `nodes/${n.id}/${n.id}.md`, dir: `nodes/${n.id}`, depends_on: n.depends_on }))
        await writeFile(join(dir, 'graph.json'), JSON.stringify({ name: PLAN_NAME, nodes }, null, 2))
        await expect(page.getByTestId('node-label')).toHaveCount(335, { timeout: 30000 })
      })
      checkShape(s, 'add')
      expect(s.kinds, 'a new plan structure is drawn at once').toContain('snap')
      expect(s.counts.layouts, 'one layout for the change').toBe(LAYOUTS)
      checkBound(s, 'add')
    })

    test('a deck unfolded and folded again (Group on, its area selected, then closed)', async ({ page }) => {
      test.setTimeout(180000)
      await open(page, vp)
      const on = await timed(page, 'group-on-start', vp, () => page.getByTestId('group-toggle').click())
      checkShape(on, 'group on')
      await expect(page.getByTestId('group-toggle')).toHaveAttribute('aria-pressed', 'true')
      await expect(label(page, 'deck:a0')).toHaveCount(1)
      const unfold = await timed(page, 'unfold', vp, () => label(page, 'a0').dispatchEvent('click'))
      checkShape(unfold, 'unfold')
      expect(unfold.kinds, 'the deck glides open').toContain('layout')
      expect(unfold.counts.layouts, 'one layout for the change').toBe(LAYOUTS)
      await expect(label(page, 'a0-0-0')).toHaveCount(1)
      checkBound(unfold, 'unfold')
      const fold = await timed(page, 'fold', vp, () => page.keyboard.press('Escape'))
      checkShape(fold, 'fold')
      expect(fold.kinds, 'the deck glides shut').toContain('layout')
      expect(fold.counts.layouts, 'one layout for the change').toBe(LAYOUTS)
      await expect(label(page, 'deck:a0')).toHaveCount(1)
      checkBound(fold, 'fold')
    })

    test('Group on, then off: the whole plan glides into decks and back out', async ({ page }) => {
      test.setTimeout(180000)
      await open(page, vp)
      const on = await timed(page, 'group-on', vp, () => page.getByTestId('group-toggle').click())
      await expect(page.getByTestId('group-toggle')).toHaveAttribute('aria-pressed', 'true')
      checkShape(on, 'group on')
      expect(on.kinds, 'the steps glide into their decks').toContain('layout')
      expect(on.counts.layouts, 'one layout for the change').toBe(LAYOUTS)
      checkBound(on, 'group on')
      const off = await timed(page, 'group-off', vp, () => page.getByTestId('group-toggle').click())
      await expect(page.getByTestId('group-toggle')).toHaveAttribute('aria-pressed', 'false')
      checkShape(off, 'group off')
      expect(off.kinds, 'the steps glide out of their decks').toContain('layout')
      expect(off.counts.layouts, 'one layout for the change').toBe(LAYOUTS)
      checkBound(off, 'group off')
    })
  })
}

test.beforeAll(async () => {
  if (SHOTS) await mkdir(SHOTS, { recursive: true })
})
