// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import Panel from './Panel.js'
import type { Plan } from '../engine/schema.js'

afterEach(cleanup)

/** A fictional three-step plan: the bed needs the boards, the beans need the bed. */
const plan: Plan = {
  name: 'Raised bed',
  nodes: [
    { id: 'buy-boards', title: 'Buy the boards', description: '', status: 'done', tags: [], depends_on: [] },
    { id: 'build-bed', title: 'Build the bed', description: '', status: 'todo', tags: ['weekend'], depends_on: ['buy-boards'], priority: 'high', due: '2026-11-01' },
    { id: 'sow-beans', title: 'Sow the beans', description: '', status: 'todo', tags: [], depends_on: ['build-bed'] },
  ],
}

describe('Panel', () => {
  it('panel shows title, body, both lists and the files, and selects through the lists', () => {
    const onSelect = vi.fn()
    render(<Panel plan={plan} id="build-bed" body={'# Notes\nwater weekly'} files={['notes.txt']} today="2026-10-16" onSelect={onSelect} onClose={() => {}} />)
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Build the bed')
    expect(screen.getByText('water weekly')).toBeTruthy()
    expect(within(screen.getByTestId('depends-on')).getByRole('button').textContent).toBe('Buy the boards')
    fireEvent.click(within(screen.getByTestId('needed-by')).getByRole('button', { name: 'Sow the beans' }))
    expect(onSelect).toHaveBeenCalledWith('sow-beans')
    fireEvent.click(within(screen.getByTestId('depends-on')).getByRole('button', { name: 'Buy the boards' }))
    expect(onSelect).toHaveBeenCalledWith('buy-boards')
    const link = within(screen.getByTestId('files')).getByRole('link', { name: 'notes.txt' })
    expect(link.getAttribute('href')).toBe('/files/build-bed/notes.txt')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })
  it('shows the status, priority, due and tags', () => {
    render(<Panel plan={plan} id="build-bed" body="" files={[]} today="2026-10-16" onSelect={() => {}} onClose={() => {}} />)
    const panel = screen.getByTestId('panel')
    expect(screen.getByTestId('panel-status').textContent).toBe('Ready')
    expect(panel.querySelector('svg.priority-mark')?.getAttribute('data-priority')).toBe('high')
    expect(panel.textContent).toContain('High priority')
    expect(screen.getByTestId('panel-due').textContent).toBe('Due Nov 1')
    expect(screen.getByTestId('panel-tags').textContent).toContain('weekend')
  })
  it('leaves out the lists a step does not have', () => {
    render(<Panel plan={plan} id="buy-boards" body="" files={[]} today="2026-10-16" onSelect={() => {}} onClose={() => {}} />)
    expect(screen.queryByTestId('depends-on')).toBeNull()
    expect(screen.queryByTestId('files')).toBeNull()
    expect(screen.getByTestId('needed-by')).toBeTruthy()
    expect(screen.queryByTestId('panel-due')).toBeNull()
  })
  it('resolves the body\'s relative images against the step', () => {
    render(<Panel plan={plan} id="build-bed" body={'![plan](plan.png)'} files={[]} today="2026-10-16" onSelect={() => {}} onClose={() => {}} />)
    expect(screen.getByRole('img', { name: 'plan' }).getAttribute('src')).toBe('/files/build-bed/plan.png')
  })
  it('closes through its Close button', () => {
    const onClose = vi.fn()
    render(<Panel plan={plan} id="build-bed" body="" files={[]} today="2026-10-16" onSelect={() => {}} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
  it('renders nothing for an id the plan does not have', () => {
    const { container } = render(<Panel plan={plan} id="nope" body="" files={[]} today="2026-10-16" onSelect={() => {}} onClose={() => {}} />)
    expect(container.innerHTML).toBe('')
  })
})
