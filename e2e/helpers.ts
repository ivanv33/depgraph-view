import { expect, type Page } from '@playwright/test'

/**
 * Waits until the graph is at rest: no camera glide, no drag, no pending resize, and a title fit has measured the view
 * (Graph.tsx writes `data-still` on the graph root from its frame loop, src/lib/stillness.ts). It must also stay true
 * across two drawn frames, so a flag read just before a move starts does not pass. Replaces a fixed wait for a glide
 * or a fit to end. Call it after the action that moves the view, not before: the flag turns false within a frame of
 * the move, so a call made in the same task may still see the old true; actions that start a glide (a click on a
 * step) are covered by the two-frame hold, which lets the flag drop first.
 */
export async function waitForStill(page: Page, timeout = 15000) {
  const graph = page.locator('[data-testid="graph"][data-still="true"]')
  await expect(async () => {
    await graph.waitFor({ timeout: 1000 })
    const held = await page.evaluate(
      () =>
        new Promise<boolean>(done => {
          const still = () => document.querySelector('[data-testid="graph"]')?.getAttribute('data-still') === 'true'
          requestAnimationFrame(() => requestAnimationFrame(() => done(still())))
        }),
    )
    expect(held, 'the graph stayed still across two frames').toBe(true)
  }).toPass({ timeout })
}
