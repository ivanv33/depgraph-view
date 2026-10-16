import { PRIORITY_MARK, PRIORITY_NAME, markBars } from '../engine/priorityMark.js'
import type { Priority } from '../engine/schema.js'

export interface PriorityMarkProps {
  /** The stored priority; normal or none draws nothing. */
  priority?: Priority
  className?: string
  /** Hidden from screen readers, for a place whose words already say the priority (the Priority chip). */
  decorative?: boolean
  /** Draw normal as the bare glyph, every bar unlit (the Low / Normal / High buttons); decorative places only. */
  unlitNormal?: boolean
}

/**
 * The priority mark for React places (search results, the bottom card, the panel header, the chip, the legend): the
 * same bars as the graph labels draw (src/lib/priorityMark.ts). Sized by the `priority-mark` class in globals.css, in
 * em, so it follows the text beside it.
 */
export default function PriorityMark({ priority, className, decorative = false, unlitNormal = false }: PriorityMarkProps) {
  const bars = markBars(priority, { unlitNormal: unlitNormal && decorative })
  if (!bars) return null
  const a11y = decorative ? { 'aria-hidden': true as const } : { role: 'img', 'aria-label': PRIORITY_NAME[priority as 'high' | 'low'] }
  return (
    <svg
      className={className ? `priority-mark ${className}` : 'priority-mark'}
      viewBox={`0 0 ${PRIORITY_MARK.w} ${PRIORITY_MARK.h}`}
      shapeRendering="crispEdges"
      data-priority={priority ?? 'normal'}
      {...a11y}
    >
      {bars.map(b => (
        <rect key={b.x} x={b.x} y={b.y} width={b.width} height={b.height} fill={b.fill} />
      ))}
    </svg>
  )
}
