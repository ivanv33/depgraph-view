import type { Box } from '../engine/deckList.js'
import type { Insets } from '../engine/frame.js'

/** The host's chrome over the graph as boxes in the view, in window px: `chip` is a small box (a "ready" chip) no inset describes. */
export type HostChrome = { toolbar?: Box; panel?: Box; hud?: Box; chip?: Box }

/**
 * The host's chrome over the graph as boxes in the view, from its insets: the toolbar across the top strip, a side
 * panel down the right strip and a bottom sheet (`hud`) across the bottom strip, each only when that strip is there.
 * A box the host gives in `chrome` replaces the one derived from the insets, and its `chip` is passed through.
 * The edge cues and a deck's list keep clear of them.
 */
export function insetBoxes(view: { w: number; h: number }, insets: Insets, chrome: HostChrome = {}): HostChrome {
  const boxes: HostChrome = {}
  if (insets.top > 0) boxes.toolbar = { left: 0, top: 0, right: view.w, bottom: insets.top }
  if (insets.right > 0) boxes.panel = { left: view.w - insets.right, top: 0, right: view.w, bottom: view.h }
  if (insets.bottom > 0) boxes.hud = { left: 0, top: view.h - insets.bottom, right: view.w, bottom: view.h }
  if (chrome.toolbar) boxes.toolbar = chrome.toolbar
  if (chrome.panel) boxes.panel = chrome.panel
  if (chrome.hud) boxes.hud = chrome.hud
  if (chrome.chip) boxes.chip = chrome.chip
  return boxes
}
