/**
 * A neighbour whose cut or hidden title is shown (the pointer on its circle, or the keyboard focus on it) is drawn under
 * the selected step, unless its shown words cross the selected step's plate or brackets: then they would be mostly
 * covered, so that neighbour is marked data-over-plate and globals.css draws it over the selected step, until the
 * pointer leaves its circle or the focus moves on; meanwhile the selected step is marked data-plate-covered. `shown` are the labels shown now; every other label loses the mark.
 * Measures the shown words, so it runs after data-hovered is set or the focus has moved (and again after a title fit,
 * as the view moves).
 */
export function markOverPlate(shown: readonly (HTMLElement | null)[], labels: Iterable<HTMLElement>) {
  const these = new Set(shown.filter((l): l is HTMLElement => !!l))
  let selected: HTMLElement | null = null
  for (const l of labels) {
    if (!these.has(l) && l.dataset.overPlate) delete l.dataset.overPlate
    if (l.dataset.selected === 'true') selected = l
  }
  const plate = selected?.querySelector('.node-label-text')?.getBoundingClientRect()
  const mark = selected?.querySelector('.node-mark')?.getBoundingClientRect()
  let covered = false
  for (const l of these) {
    const words = l.querySelector('.node-label-text')?.getBoundingClientRect()
    // only a cut or hidden title, shown by hover or by keyboard focus, is drawn over the plate (globals.css): a title shown
    // in full, or a label focused by a click, draws nothing over it, so it must not hide the plate either
    const shownOnRequest = (l.dataset.titleFit === 'short' || l.dataset.titleFit === 'dot') && (l.dataset.hovered === 'true' || focusVisible(l))
    const over = l !== selected && shownOnRequest && !!words && [plate, mark].some(b => b && crosses(words, b))
    if (over) l.dataset.overPlate = 'true'
    else delete l.dataset.overPlate
    covered ||= over
  }
  // While shown words are drawn over it, the selected step's plate steps aside (globals.css hides it, its brackets stay),
  // so no half-covered letters of it show round their backing.
  if (selected && covered) selected.dataset.plateCovered = 'true'
  else if (selected) delete selected.dataset.plateCovered
}

/**
 * The labels whose words are shown on request now: the one whose circle the pointer is on (data-hovered) and the one
 * with the keyboard focus.
 */
export function shownLabels(labels: Iterable<HTMLElement>, active: Element | null = typeof document === 'undefined' ? null : document.activeElement): HTMLElement[] {
  return [...labels].filter(l => l.dataset.hovered === 'true' || (active !== null && l === active))
}

/** markOverPlate for the labels shown now (shownLabels): on hover, on a focus change, after a title fit. */
export function refreshOverPlate(labels: Iterable<HTMLElement>) {
  const all = [...labels]
  markOverPlate(shownLabels(all), all)
}

const focusVisible = (l: HTMLElement) => {
  try {
    return l.matches(':focus-visible')
  } catch {
    return false
  }
}

const crosses = (a: DOMRect, b: DOMRect) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
