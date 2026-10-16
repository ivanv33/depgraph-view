import { rmSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { gardenSteps, newFixtureDir, writeFixture } from './fixtureFolder.js'
import { waitForStill } from './helpers.js'
import { E2E_PORT, serve } from './serve.js'

// The panel's layout rules: a content-tall side sheet of at most a third of the window on desktop, the graph framed
// in the room beside it; a bottom sheet of at most half the window under the toolbar on a tablet or phone.

let dir: string
let url: string
let stop: () => Promise<void>

const LONG = Array.from({ length: 40 }, (_, i) => `Line ${i + 1} of the rota: water the beans in the evening.`).join('\n\n')

test.beforeAll(async () => {
  dir = newFixtureDir()
  const steps = gardenSteps().map(s => (s.id === 'water-rota' ? { ...s, body: LONG } : s))
  writeFixture(dir, 'Garden', steps)
  const server = await serve(dir, E2E_PORT)
  url = server.url
  stop = server.stop
})

test.afterAll(async () => {
  await stop?.()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

const box = async (page: Page, testId: string) => {
  const b = await page.getByTestId(testId).boundingBox()
  if (!b) throw new Error(`${testId} has no box`)
  return b
}
const labelBox = async (page: Page, id: string) => {
  const b = await page.locator(`[data-testid="node-label"][data-node-id="${id}"] .node-dot`).boundingBox()
  if (!b) throw new Error(`${id} has no circle`)
  return b
}

for (const width of [1440, 1100]) {
  test(`at ${width}x900 the panel is a side sheet of at most a third of the window, the step framed beside it`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(`${url}?step=build-bed`)
    await expect(page.getByTestId('panel-sheet')).toHaveAttribute('data-sheet', 'side')
    await waitForStill(page)
    const panel = await box(page, 'panel')
    expect(panel.width, 'the panel is at most a third of the width').toBeLessThanOrEqual(width * 0.34)
    expect(panel.x, 'the graph keeps at least 60% of the width').toBeGreaterThanOrEqual(width * 0.6)
    expect(panel.height, 'a short step makes a short panel').toBeLessThan(900 * 0.6)
    const dot = await labelBox(page, 'build-bed')
    expect(dot.x + dot.width, 'the selected step is left of the panel').toBeLessThan(panel.x)
  })
}

for (const [width, height] of [[768, 1024], [390, 844]] as const) {
  test(`at ${width}x${height} the panel is a bottom sheet under the toolbar, which stays usable`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await page.goto(`${url}?step=build-bed`)
    await expect(page.getByTestId('panel-sheet')).toHaveAttribute('data-sheet', 'bottom')
    await waitForStill(page)
    const panel = await box(page, 'panel')
    const toolbar = await box(page, 'toolbar')
    expect(panel.height, 'at most half the window').toBeLessThanOrEqual(height * 0.5 + 1)
    expect(panel.y, 'below the toolbar').toBeGreaterThan(toolbar.y + toolbar.height)
    const dot = await labelBox(page, 'build-bed')
    expect(dot.y + dot.height, 'the selected step is above the sheet').toBeLessThan(panel.y)
    expect(dot.y, 'and below the toolbar').toBeGreaterThan(toolbar.y + toolbar.height)
    // the toolbar's controls take real clicks with the panel open
    await page.getByTestId('fit-plan').click()
    await page.getByTestId('search').fill('sow')
    await page.getByTestId('search').press('Enter')
    await expect(page).toHaveURL(/\?step=sow-beans$/)
    await expect(page.getByTestId('panel').getByRole('heading', { level: 2 })).toHaveText('Sow the beans')
  })
}

for (const [width, height] of [[844, 390], [667, 375]] as const) {
  test(`at ${width}x${height} (a phone on its side) the panel is a side sheet that leaves the graph its height`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await page.goto(`${url}?step=build-bed`)
    await expect(page.getByTestId('panel-sheet')).toHaveAttribute('data-sheet', 'side')
    await waitForStill(page)
    const panel = await box(page, 'panel')
    const toolbar = await box(page, 'toolbar')
    expect(panel.width, 'a third of the width, or its 18rem floor').toBeLessThanOrEqual(Math.max(288, width * 0.34))
    expect(panel.x, 'the graph keeps more than half the width').toBeGreaterThan(width * 0.5)
    const overlaps = panel.x < toolbar.x + toolbar.width && panel.y < toolbar.y + toolbar.height
    expect(overlaps, 'the panel stays clear of the toolbar').toBe(false)
    expect(panel.y + panel.height, 'inside the window').toBeLessThanOrEqual(height - 15)
    const dot = await labelBox(page, 'build-bed')
    expect(dot.x + dot.width, 'the selected step is left of the panel').toBeLessThan(panel.x)
    expect(dot.y, 'below the toolbar').toBeGreaterThan(toolbar.y + toolbar.height)
    await expect(page.getByTestId('legend'), 'no room for the legend beside the panel').toHaveCount(0)
    await page.getByTestId('fit-plan').click()
  })
}

test('a long step scrolls inside the panel, which stays inside the window', async ({ page }) => {
  for (const [width, height] of [[1100, 900], [390, 844]] as const) {
    await page.setViewportSize({ width, height })
    await page.goto(`${url}?step=water-rota`)
    const panel = page.getByTestId('panel')
    await expect(panel.getByText('Line 40 of the rota', { exact: false })).toBeAttached()
    const b = await box(page, 'panel')
    expect(b.y + b.height, `inside the window at ${width}`).toBeLessThanOrEqual(height - 15)
    const body = page.getByTestId('panel-body')
    expect(await body.evaluate(el => el.scrollHeight > el.clientHeight), `it scrolls at ${width}`).toBe(true)
    await body.evaluate(el => el.scrollTo(0, el.scrollHeight))
    await expect(page.getByTestId('panel').getByRole('button', { name: 'Close' }), 'the close button stays in view').toBeInViewport()
  }
})

test('narrowing the window with the panel open turns it into a bottom sheet; Escape closes it', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 })
  await page.goto(`${url}?step=build-bed`)
  await expect(page.getByTestId('panel-sheet')).toHaveAttribute('data-sheet', 'side')
  await page.setViewportSize({ width: 700, height: 900 })
  await expect(page.getByTestId('panel-sheet')).toHaveAttribute('data-sheet', 'bottom')
  await waitForStill(page)
  const panel = await box(page, 'panel')
  const dot = await labelBox(page, 'build-bed')
  expect(dot.y + dot.height, 'the step is framed again above the sheet').toBeLessThan(panel.y)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('panel')).toHaveCount(0)
})
