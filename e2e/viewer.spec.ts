import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { gardenSteps, newFixtureDir, writeFixture } from './fixtureFolder.js'
import { waitForStill } from './helpers.js'
import { E2E_PORT, serve } from './serve.js'

let dir: string
let url: string
let stop: () => Promise<void>

const label = (page: Page, id: string) => page.locator(`[data-testid="node-label"][data-node-id="${id}"]`)

test.beforeAll(async () => {
  dir = newFixtureDir()
  writeFixture(dir, 'Garden', gardenSteps(), { missing: ['ghost-step'] })
  const server = await serve(dir, E2E_PORT)
  url = server.url
  stop = server.stop
})

test.afterAll(async () => {
  await stop?.()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

test('the page reaches still with every step drawn and the plan name as title', async ({ page }) => {
  await page.goto(url)
  await expect(page.getByTestId('node-label')).toHaveCount(6)
  await waitForStill(page)
  await expect(page).toHaveTitle('Garden')
})

test('search selects a step on Enter and mirrors it in ?step=', async ({ page }) => {
  await page.goto(url)
  await page.getByTestId('search').fill('build the')
  await page.getByTestId('search').press('Enter')
  await expect(label(page, 'build-bed')).toHaveAttribute('data-selected', 'true')
  await expect(page).toHaveURL(/\?step=build-bed$/)
})

test('the panel shows the body, both lists and the files', async ({ page }) => {
  await page.goto(`${url}?step=build-bed`)
  const panel = page.getByTestId('panel')
  await expect(panel.getByText('Use the spare boards.')).toBeVisible()
  await expect(panel.getByRole('img')).toHaveAttribute('src', '/files/build-bed/sketch.png')
  await expect(panel.getByTestId('depends-on').getByRole('button')).toHaveText(['Buy the boards'])
  const file = panel.getByTestId('files').getByRole('link', { name: 'cut-list.txt' })
  await expect(file).toHaveAttribute('target', '_blank')
  const r = await page.request.get(`${url}files/build-bed/cut-list.txt`)
  expect(r.status()).toBe(200)
  expect(r.headers()['x-content-type-options']).toBe('nosniff')
  await panel.getByTestId('needed-by').getByRole('button', { name: 'Sow the beans' }).click()
  await expect(label(page, 'sow-beans')).toHaveAttribute('data-selected', 'true')
})

test('editing an md file reloads and updates the title', async ({ page }) => {
  await page.goto(url)
  await waitForStill(page)
  writeFileSync(join(dir, 'nodes/water-rota.context/water-rota.md'), '---\ntitle: Water every evening\n---\n')
  await expect(label(page, 'water-rota')).toContainText('Water every evening', { timeout: 10000 })
})

test('a ?step= URL opens with that step selected', async ({ page }) => {
  await page.goto(`${url}?step=pick-seeds`)
  await expect(label(page, 'pick-seeds')).toHaveAttribute('data-selected', 'true')
  await expect(page.getByTestId('panel')).toBeVisible()
})

test('an invalid save shows a dismissible banner and keeps the graph', async ({ page }) => {
  await page.goto(url)
  const good = readFileSync(join(dir, 'graph.yaml'), 'utf8')
  writeFileSync(join(dir, 'graph.yaml'), 'name: [unclosed\n')
  try {
    await expect(page.getByTestId('error-banner')).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId('node-label')).toHaveCount(6)
    await page.getByTestId('error-banner').getByRole('button', { name: 'Dismiss' }).click()
    await expect(page.getByTestId('error-banner')).toHaveCount(0)
  } finally {
    writeFileSync(join(dir, 'graph.yaml'), good)
  }
})

test('warnings are listed in a collapsed footer', async ({ page }) => {
  await page.goto(url)
  const w = page.getByTestId('warnings')
  await expect(w).not.toHaveAttribute('open', '')
  await w.locator('summary').click()
  await expect(w).toContainText('node "ghost-step": md not found')
})

test('shift+click on a label is a plain pick without onShiftLink', async ({ page }) => {
  await page.goto(url)
  await waitForStill(page)
  await page.keyboard.down('Shift')
  await expect(page.getByTestId('graph')).not.toHaveAttribute('data-shift', 'true')
  await label(page, 'sow-beans').locator('.node-dot').click()
  await expect(label(page, 'sow-beans')).toHaveAttribute('data-selected', 'true')
  await expect(page.getByTestId('link-arrow')).toHaveCount(0)
  await label(page, 'water-rota').locator('.node-dot').click()
  await expect(label(page, 'water-rota')).toHaveAttribute('data-selected', 'true')
  await expect(page).toHaveURL(/\?step=water-rota$/)
  await page.keyboard.up('Shift')
})

test('shift+click on empty canvas deselects without onAddAt', async ({ page }) => {
  await page.goto(`${url}?step=water-rota`)
  await expect(label(page, 'water-rota')).toHaveAttribute('data-selected', 'true')
  await waitForStill(page)
  const h = page.viewportSize()!.height
  await page.keyboard.down('Shift')
  await page.mouse.click(10, Math.round(h / 2)) // left of the legend's strip, under the toolbar: empty canvas
  await page.keyboard.up('Shift')
  await expect(page.locator('[data-testid="node-label"][data-selected="true"]')).toHaveCount(0)
  await expect(page).not.toHaveURL(/\?step=/)
  await expect(page.getByTestId('node-label')).toHaveCount(6)
})
