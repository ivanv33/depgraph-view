// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import Legend from './Legend.js'

afterEach(cleanup)

describe('Legend', () => {
  const counts = { ready: 3, doing: 1, waiting: 4, blocked: 0, done: 7 }

  it('shows a row per state in order with its count', () => {
    render(<Legend counts={counts} />)
    const rows = screen.getByTestId('legend').querySelectorAll('[data-testid^="legend-state-"]')
    expect([...rows].map(r => r.getAttribute('data-testid'))).toEqual([
      'legend-state-ready',
      'legend-state-doing',
      'legend-state-waiting',
      'legend-state-blocked',
      'legend-state-done',
    ])
    expect(screen.getByTestId('legend-count-ready').textContent).toBe('3')
    expect(screen.getByTestId('legend-count-doing').textContent).toBe('1')
    expect(screen.getByTestId('legend-count-waiting').textContent).toBe('4')
    expect(screen.getByTestId('legend-count-blocked').textContent).toBe('0')
    expect(screen.getByTestId('legend-count-done').textContent).toBe('7')
  })

  it('has an On hold row with the count of held nodes, zero when not given', () => {
    const { unmount } = render(<Legend counts={counts} held={2} />)
    expect(screen.getByTestId('legend').textContent).toContain('On hold')
    expect(screen.getByTestId('legend-count-later').textContent).toBe('2')
    unmount()
    render(<Legend counts={counts} />)
    expect(screen.getByTestId('legend-count-later').textContent).toBe('0')
  })

  it('names the states and the three edge kinds', () => {
    render(<Legend counts={counts} />)
    const text = screen.getByTestId('legend').textContent ?? ''
    for (const w of ['Ready', 'Doing', 'Waiting', 'Blocked', 'Done', 'needs (not done yet)', 'already satisfied', 'implied by another path']) {
      expect(text).toContain(w)
    }
    expect(screen.getByTestId('legend-edge-redundant').textContent).toBe('implied by another path')
  })

  it('has one quiet row explaining the priority mark: three bars high, one bar low, no counts', () => {
    render(<Legend counts={counts} />)
    const rows = screen.getAllByTestId('legend-priority')
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect([...row.querySelectorAll('svg.priority-mark')].map(s => s.getAttribute('data-priority'))).toEqual(['high', 'low'])
    expect(row.textContent).toBe('high · low priority')
    expect(row.textContent).not.toMatch(/\d/)
    // the words say what each mark is, so the marks are not read out twice
    expect([...row.querySelectorAll('svg')].every(s => s.getAttribute('aria-hidden') === 'true')).toBe(true)
  })

  it('is hidden under 640 px and sits bottom-left above the dev badge', () => {
    render(<Legend counts={counts} />)
    const cls = screen.getByTestId('legend').className
    expect(cls).toContain('hidden')
    expect(cls).toContain('sm:block')
    expect(cls).toContain('left-4')
    expect(cls).toContain('bottom-16')
  })
})
