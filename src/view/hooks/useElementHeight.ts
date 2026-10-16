import { useEffect, useState } from 'react'

/**
 * Something measured on the element `selector` finds, while `active`, reported `delayMs` after its last change (a
 * burst of resizes is one update). The element may mount after the hook starts, or be replaced by a remount: the
 * document is watched until it is there and for as long as the hook is active. Null until found. `around` (the
 * default) also re-measures when the element's parent changes size or the window resizes (it is a position), and
 * forgets the value once inactive, since a position goes stale while nothing watches it; without it only the element
 * is watched and the last value is kept.
 */
function useMeasured<T>(selector: string, active: boolean, delayMs: number, read: (el: HTMLElement) => T, same: (a: T, b: T) => boolean, around = true): T | null {
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
    // `read` and `same` are fixed per caller (module-level functions)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selector, active, delayMs, around])
  return value
}

const sameNumber = (a: number, b: number) => a === b
const offsetHeight = (el: HTMLElement) => el.offsetHeight

/** The height of the element `selector` finds (see useMeasured): only the element is watched, and the last height is kept once inactive. */
export function useElementHeight(selector: string, active: boolean, delayMs = 150): number | null {
  return useMeasured(selector, active, delayMs, offsetHeight, sameNumber, false)
}

/** Which window edge an overlay hangs from, for useElementEdge. */
export type WindowEdge = 'top' | 'right' | 'bottom'

const reachTop = (el: HTMLElement) => el.getBoundingClientRect().bottom
const reachRight = (el: HTMLElement) => window.innerWidth - el.getBoundingClientRect().left
const reachBottom = (el: HTMLElement) => window.innerHeight - el.getBoundingClientRect().top
const REACH = { top: reachTop, right: reachRight, bottom: reachBottom } as const

/**
 * How far into the window the element `selector` finds reaches from `edge`, in window px, its gap from that edge
 * included: from the top, its bottom; from the right, the window's width less its left; from the bottom, the window's
 * height less its top. Measured again when it or its
 * parent changes size or the window resizes (see useMeasured); forgotten once inactive. For a host's insets.
 */
export function useElementEdge(selector: string, edge: WindowEdge, active: boolean, delayMs = 150): number | null {
  return useMeasured(selector, active, delayMs, REACH[edge], sameNumber)
}
