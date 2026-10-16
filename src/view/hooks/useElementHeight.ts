import { useEffect, useState } from 'react'

/**
 * Something measured on the element `selector` finds, while `active`, reported `delayMs` after its last change (a
 * burst of resizes, a field growing line by line, is one update). The element may mount after the hook starts, or be
 * replaced by a remount: the document is watched until it is there and for as long as the hook is active. Null until
 * found. `around` also re-measures when the element's parent changes size or the window resizes (for a position), and
 * forgets the value once inactive, since a position goes stale while nothing watches it.
 */
function useMeasured<T>(selector: string, active: boolean, delayMs: number, read: (el: HTMLElement) => T, same: (a: T, b: T) => boolean, around = false, version = ''): T | null {
  const [value, setValue] = useState<T | null>(null)
  useEffect(() => {
    if (!active) return
    let el: HTMLElement | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    const measure = () => {
      const next = el ? read(el) : null
      setValue(prev => (prev !== null && next !== null && same(prev, next) ? prev : next))
    }
    const report = () => {
      clearTimeout(timer)
      timer = setTimeout(measure, delayMs)
    }
    const sizes = new ResizeObserver(report)
    let watched: HTMLElement[] = []
    const attach = () => {
      const found = document.querySelector<HTMLElement>(selector)
      if (found === el) return
      for (const w of watched) sizes.unobserve(w)
      el = found
      watched = el ? (around && el.parentElement ? [el, el.parentElement] : [el]) : []
      for (const w of watched) sizes.observe(w)
      // a newly found element is measured at once (the debounce is for changes to it); one gone waits as before
      if (el) {
        clearTimeout(timer)
        measure()
      } else report()
    }
    const mounts = new MutationObserver(attach)
    mounts.observe(document.body, { childList: true, subtree: true })
    if (around) window.addEventListener('resize', report)
    attach()
    return () => {
      mounts.disconnect()
      sizes.disconnect()
      clearTimeout(timer)
      if (around) {
        window.removeEventListener('resize', report)
        setValue(null) // a position goes stale while unwatched: the next activation measures afresh
      }
    }
    // `read` and `same` are fixed per caller (module-level functions); `version` is in the deps only to measure afresh
    // when it changes (see useElementBox)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[selector, active, delayMs, around, version])
  return value
}

const offsetHeight = (el: HTMLElement) => el.offsetHeight
const sameNumber = (a: number, b: number) => a === b

/** The height of the element `selector` finds (see useMeasured). */
export function useElementHeight(selector: string, active: boolean, delayMs = 150): number | null {
  return useMeasured(selector, active, delayMs, offsetHeight, sameNumber)
}

const offsetWidth = (el: HTMLElement) => el.offsetWidth

/** The width of the element `selector` finds (see useMeasured). */
export function useElementWidth(selector: string, active: boolean, delayMs = 150): number | null {
  return useMeasured(selector, active, delayMs, offsetWidth, sameNumber)
}

/** Where an element ends on screen, with the window's width then. */
export type ElementCorner = { right: number; bottom: number; viewW: number }

const corner = (el: HTMLElement): ElementCorner => {
  const r = el.getBoundingClientRect()
  return { right: r.right, bottom: r.bottom, viewW: window.innerWidth }
}
const sameCorner = (a: ElementCorner, b: ElementCorner) => a.right === b.right && a.bottom === b.bottom && a.viewW === b.viewW

/** Where an element is drawn in the window. */
export type ElementBox = { left: number; top: number; right: number; bottom: number }

const box = (el: HTMLElement): ElementBox => {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
}
const sameBox = (a: ElementBox, b: ElementBox) => a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom

/**
 * The box of the element `selector` finds, in the window: measured again when it or its parent changes size, the window
 * resizes, or `version` changes (the caller's word that it moved, such as a panel opened or closed, which a size
 * observer does not see when only its place changes).
 */
export function useElementBox(selector: string, active: boolean, delayMs = 150, version = ''): ElementBox | null {
  return useMeasured(selector, active, delayMs, box, sameBox, true, version)
}

/**
 * The bottom right corner of the element `selector` finds, in the window, and the window's width: measured again when
 * it or its parent (the column it is stacked in, which grows when something above it wraps) changes size, or the
 * window resizes.
 */
export function useElementCorner(selector: string, active: boolean, delayMs = 150): ElementCorner | null {
  return useMeasured(selector, active, delayMs, corner, sameCorner, true)
}
