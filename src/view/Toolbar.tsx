import type { ReactNode, Ref } from 'react'

export interface ToolbarProps {
  /** Only the path to the selection and its subtree are drawn open; every other branch is a deck. */
  grouped: boolean
  onToggleGroup: () => void
  /** Frames the whole plan, keeping the selection. */
  onFit: () => void
  /** The group toggle, for a page that needs to hand the focus to it. */
  toggleRef?: Ref<HTMLButtonElement>
  /** Shown first in the bar (the search). */
  children?: ReactNode
}

// Under 640 px (Tailwind's sm) the controls are at least 36 px tall, so a finger can hit them.
const btn =
  'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium transition-colors hover:bg-white/10 max-sm:min-h-9'

export default function Toolbar({ grouped, onToggleGroup, onFit, toggleRef, children }: ToolbarProps) {
  return (
    <div data-testid="toolbar" className="pointer-events-auto flex max-w-full flex-wrap items-start gap-2 glass rounded-xl p-2">
      {children}
      <button
        ref={toggleRef}
        type="button"
        data-testid="group-toggle"
        aria-pressed={grouped}
        title="Collapse branches you are not looking at"
        className={`${btn} ${grouped ? 'bg-white/20' : ''}`}
        onClick={onToggleGroup}
      >
        Group
      </button>
      <button type="button" data-testid="fit-plan" aria-label="Fit the whole plan" title="Show the whole plan" className={btn} onClick={onFit}>
        Fit
      </button>
    </div>
  )
}
