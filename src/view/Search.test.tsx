// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import Search from './Search.js'
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

const options = () => screen.queryAllByRole('option')

describe('Search', () => {
  it('search finds by title and by id and picks on Enter', () => {
    const onPick = vi.fn()
    render(<Search plan={plan} today="2026-10-16" onPick={onPick} />)
    const box = screen.getByTestId('search')
    expect(box.getAttribute('aria-label')).toBe('Search steps')
    fireEvent.change(box, { target: { value: 'buy-bo' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledWith('buy-boards')
    expect((box as HTMLInputElement).value).toBe('')
  })
  it('finds by title and lists results in a listbox', () => {
    render(<Search plan={plan} today="2026-10-16" onPick={() => {}} />)
    fireEvent.change(screen.getByTestId('search'), { target: { value: 'the b' } })
    expect(screen.getByRole('listbox')).toBeTruthy()
    expect(options().map(o => o.getAttribute('data-node-id'))).toEqual(['build-bed', 'buy-boards', 'sow-beans'])
  })
  it('moves the highlight with Up and Down and picks the highlighted one', () => {
    const onPick = vi.fn()
    render(<Search plan={plan} today="2026-10-16" onPick={onPick} />)
    const box = screen.getByTestId('search')
    fireEvent.change(box, { target: { value: 'the b' } })
    expect(options()[0].getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    expect(options()[2].getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(box, { key: 'ArrowUp' })
    expect(options()[1].getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledWith('buy-boards')
  })
  it('picks on a click and clears the box', () => {
    const onPick = vi.fn()
    render(<Search plan={plan} today="2026-10-16" onPick={onPick} />)
    const box = screen.getByTestId('search') as HTMLInputElement
    fireEvent.change(box, { target: { value: 'sow' } })
    fireEvent.click(options()[0])
    expect(onPick).toHaveBeenCalledWith('sow-beans')
    expect(box.value).toBe('')
  })
  it('Escape clears the box and keeps it on screen', () => {
    const onPick = vi.fn()
    render(<Search plan={plan} today="2026-10-16" onPick={onPick} />)
    const box = screen.getByTestId('search') as HTMLInputElement
    fireEvent.change(box, { target: { value: 'bed' } })
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(box.value).toBe('')
    expect(options()).toHaveLength(0)
    expect(screen.getByTestId('search')).toBe(box)
    expect(onPick).not.toHaveBeenCalled()
  })
  it('keeps an empty status region before anything is typed and fills it while there is a query', () => {
    render(<Search plan={plan} today="2026-10-16" onPick={() => {}} />)
    const hint = screen.getByTestId('search-hint')
    expect(hint.getAttribute('role')).toBe('status')
    expect(hint.textContent).toBe('')
    fireEvent.change(screen.getByTestId('search'), { target: { value: 'bed' } })
    expect(screen.getByTestId('search-hint')).toBe(hint)
    expect(hint.textContent).not.toBe('')
  })
  it('hides the results when the focus leaves the box, keeps the text, and shows them again on focus', () => {
    render(<Search plan={plan} today="2026-10-16" onPick={() => {}} />)
    const box = screen.getByTestId('search') as HTMLInputElement
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: 'bed' } })
    expect(options()).toHaveLength(1)
    fireEvent.blur(box)
    expect(options()).toHaveLength(0)
    expect(box.getAttribute('aria-expanded')).toBe('false')
    // the live region stays in the page (a screen reader only announces changes to a region it already saw), empty
    expect(screen.getByTestId('search-hint').textContent).toBe('')
    expect(screen.getByTestId('search-hint').getAttribute('aria-live')).toBe('polite')
    expect(box.value).toBe('bed')
    fireEvent.focus(box)
    expect(options().map(o => o.getAttribute('data-node-id'))).toEqual(['build-bed'])
    expect(box.getAttribute('aria-expanded')).toBe('true')
  })
  it('shows each result\'s state and due date', () => {
    render(<Search plan={plan} today="2026-10-16" onPick={() => {}} />)
    fireEvent.change(screen.getByTestId('search'), { target: { value: 'build' } })
    expect(options()[0].textContent).toContain('Ready · Nov 1')
  })
  it('search keeps the mark column as wide as the mark', () => {
    const src = readFileSync('src/view/Search.tsx', 'utf8')
    expect(src).toContain('w-[var(--mark-w)]')
    expect(src).not.toMatch(/w-\[0\.\d+em\]/)
  })
})
