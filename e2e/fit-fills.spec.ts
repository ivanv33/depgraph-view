import { rmSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { gardenSteps, newFixtureDir, writeFixture } from './fixtureFolder.js'
import { waitForStill } from './helpers.js'
import { E2E_PORT, serve } from './serve.js'

// The frames fill the free area (the window less the toolbar and an open panel, the legend's corner kept clear) and
// follow it: closing the panel and resizing the window re-fit the whole plan.

let dir: string
let url: string
let stop: () => Promise<void>

test.beforeAll(async () => {
  dir = newFixtureDir()
  writeFixture(dir, 'Garden', gardenSteps())
  const server = await serve(dir, E2E_PORT)
  url = server.url
  stop = server.stop
})

test.afterAll(async () => {
  await stop?.()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

/** The least share of the free area's width or height (the one the plan is bound by) the drawn steps span. */
const FILL = 0.65

type Fit = {
  /** The steps' drawn box (circles and words) over the free area's width and height. */
  w: number
  h: number
  /** Whether that box lies inside the free area. */
  inside: boolean
  /** Whether any step is drawn under the legend. */
  underLegend: boolean
  /** Each step's circle centre. */
  dots: Record<string, [number, number]>
}

/** The free area (the window less the toolbar and an open sheet) and how the steps `ids` (all when empty) are drawn in it. */
const fit = (page: Page, ids: string[] = []): Promise<Fit> =>
  page.evaluate(ids => {
    const rect = (s: string) => document.querySelector(s)?.getBoundingClientRect() ?? null
    const toolbar = rect('[data-testid="toolbar"]')
    const panel = rect('[data-testid="panel"]')
    const legendBox = rect('[data-testid="legend"]')
    const legend = legendBox && legendBox.width > 0 ? legendBox : null
    const sheet = document.querySelector('[data-testid="panel-sheet"]')?.getAttribute('data-sheet')
    const free = { left: 0, top: toolbar?.bottom ?? 0, right: innerWidth, bottom: innerHeight }
    if (panel && sheet === 'side') free.right = panel.left
    if (panel && sheet === 'bottom') free.bottom = panel.top
    const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }
    const dots: Record<string, [number, number]> = {}
    let underLegend = false
    for (const el of document.querySelectorAll<HTMLElement>('[data-testid="node-label"]')) {
      const id = el.dataset.nodeId ?? ''
      const dot = el.querySelector('.node-dot, .node-deck-dot')?.getBoundingClientRect()
      if (dot) dots[id] = [dot.x + dot.width / 2, dot.y + dot.height / 2]
      if (ids.length > 0 && !ids.includes(id)) continue
      const rects = dot ? [dot] : []
      const text = el.querySelector('.node-label-text')
      if (text) {
        const range = document.createRange()
        range.selectNodeContents(text)
        rects.push(...range.getClientRects())
      }
      for (const r of rects) {
        if (r.width === 0 && r.height === 0) continue
        box.left = Math.min(box.left, r.left)
        box.top = Math.min(box.top, r.top)
        box.right = Math.max(box.right, r.right)
        box.bottom = Math.max(box.bottom, r.bottom)
        if (legend && r.right > legend.left && r.left < legend.right && r.bottom > legend.top && r.top < legend.bottom) underLegend = true
      }
    }
    return {
      w: (box.right - box.left) / (free.right - free.left),
      h: (box.bottom - box.top) / (free.bottom - free.top),
      inside: box.left >= free.left && box.right <= free.right && box.top >= free.top && box.bottom <= free.bottom,
      underLegend,
      dots,
    }
  }, ids)

const expectFills = (f: Fit, what: string) => {
  expect(f.inside, `${what}: the steps lie inside the free area`).toBe(true)
  expect(f.underLegend, `${what}: no step under the legend`).toBe(false)
  expect(Math.max(f.w, f.h), `${what}: the steps span at least ${FILL} of the free area's width or height`).toBeGreaterThanOrEqual(FILL)
}

/** How far (px) the circles moved between two measures: 0 when the camera is where it was. */
const moved = (a: Fit, b: Fit) => {
  expect(Object.keys(b.dots).sort(), 'the same steps drawn in both measures').toEqual(Object.keys(a.dots).sort())
  return Math.max(...Object.keys(a.dots).map(id => Math.hypot(a.dots[id][0] - b.dots[id][0], a.dots[id][1] - b.dots[id][1])))
}

const openStep = async (page: Page, id: string) => {
  await page.locator(`[data-testid="node-label"][data-node-id="${id}"] .node-dot`).click()
  await expect(page.getByTestId('panel')).toBeVisible()
  await waitForStill(page)
}
const closePanel = async (page: Page) => {
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('panel')).toHaveCount(0)
  await waitForStill(page)
}

for (const [width, height] of [[1440, 900], [1100, 900], [880, 700], [560, 900], [390, 844]] as const) {
  test(`at ${width}x${height} the plan fills the free area on load, and closing the panel re-fits it there`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await page.goto(url)
    await waitForStill(page)
    const load = await fit(page)
    expectFills(load, 'on load')
    await openStep(page, 'build-bed')
    await closePanel(page)
    const closed = await fit(page)
    expectFills(closed, 'after the panel closed')
    expect(moved(load, closed), 'framed as on load').toBeLessThan(10)
  })
}

for (const [width, height] of [[560, 900], [390, 844]] as const) {
  test(`at ${width}x${height} a selection is framed with its neighbours above the bottom sheet, once the sheet is measured`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await page.goto(url)
    await waitForStill(page)
    await openStep(page, 'build-bed')
    const f = await fit(page, ['build-bed', 'buy-boards', 'sow-beans'])
    expect(f.inside, 'the step, the step it needs and the step that needs it lie between the toolbar and the sheet').toBe(true)
    expect(Math.max(f.w, f.h), 'and use the room there').toBeGreaterThanOrEqual(0.6)
  })
}

test('a resize re-fits the plan into the new free area, and back', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(url)
  await waitForStill(page)
  const wide = await fit(page)
  expectFills(wide, 'at 1440x900')
  for (const [width, height] of [[1100, 900], [560, 900], [1440, 600]] as const) {
    await page.setViewportSize({ width, height })
    await waitForStill(page)
    expectFills(await fit(page), `resized to ${width}x${height}`)
  }
  // At 900x900 the garden, framed as large as the window holds, would draw its long arrow into the legend's corner: it
  // is kept beside the legend instead, so only that is asserted there.
  await page.setViewportSize({ width: 900, height: 900 })
  await waitForStill(page)
  const square = await fit(page)
  expect(square.inside && !square.underLegend, 'resized to 900x900: inside the free area, clear of the legend').toBe(true)
  await page.setViewportSize({ width: 1440, height: 900 })
  await waitForStill(page)
  const back = await fit(page)
  expectFills(back, 'back at 1440x900')
  expect(moved(wide, back), 'framed as before').toBeLessThan(10)
})

test('after the user zooms, a panel opened and closed still re-fits the plan: the camera is not left the user\'s', async ({ page }) => {
  await page.setViewportSize({ width: 560, height: 900 })
  await page.goto(url)
  await waitForStill(page)
  const load = await fit(page)
  await page.mouse.move(280, 450)
  await page.mouse.wheel(0, 400)
  await waitForStill(page)
  expect(moved(load, await fit(page)), 'the wheel moved the camera').toBeGreaterThan(20)
  await openStep(page, 'build-bed')
  await closePanel(page)
  const closed = await fit(page)
  expectFills(closed, 'after the panel closed')
  expect(moved(load, closed), 'framed as on load').toBeLessThan(10)
})
