// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import PriorityMark from './PriorityMark.js'
import { createPriorityMark } from '../engine/priorityMark.js'

afterEach(cleanup)

describe('PriorityMark', () => {
  it('draws the same bars as the graph labels, named for screen readers', () => {
    for (const p of ['high', 'low'] as const) {
      const { container, unmount } = render(<PriorityMark priority={p} />)
      const svg = container.querySelector('svg')!
      const dom = createPriorityMark(document, p)!
      expect(screen.getByRole('img', { name: p === 'high' ? 'High priority' : 'Low priority' })).toBe(svg)
      expect(svg.getAttribute('viewBox')).toBe(dom.getAttribute('viewBox'))
      expect(svg.getAttribute('class')).toContain('priority-mark')
      expect(svg.getAttribute('data-priority')).toBe(p)
      expect(svg.innerHTML).toBe(dom.innerHTML)
      unmount()
    }
  })

  it('draws nothing for normal or no priority', () => {
    expect(render(<PriorityMark priority="normal" />).container.innerHTML).toBe('')
    expect(render(<PriorityMark />).container.innerHTML).toBe('')
  })

  it('takes extra classes and can be hidden from screen readers where words already say it', () => {
    const { container } = render(<PriorityMark priority="high" className="x" decorative />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('class')).toBe('priority-mark x')
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.hasAttribute('role')).toBe(false)
    expect(svg.hasAttribute('aria-label')).toBe(false)
  })
})
