import type { Box } from '../engine/deckList.js'
import type { Insets } from '../engine/frame.js'

/**
 * The host's chrome over the graph as boxes in the view, from its insets: the toolbar across the top strip, a side
 * panel down the right strip and a bottom sheet (`hud`) across the bottom strip, each only when that strip is there.
 * The edge cues and a deck's list keep clear of them.
 */
export function insetBoxes(view: { w: number; h: number }, insets: Insets): { toolbar?: Box; panel?: Box; hud?: Box } {
  const boxes: { toolbar?: Box; panel?: Box; hud?: Box } = {}
  if (insets.top > 0) boxes.toolbar = { left: 0, top: 0, right: view.w, bottom: insets.top }
  if (insets.right > 0) boxes.panel = { left: view.w - insets.right, top: 0, right: view.w, bottom: view.h }
  if (insets.bottom > 0) boxes.hud = { left: 0, top: view.h - insets.bottom, right: view.w, bottom: view.h }
  return boxes
}
