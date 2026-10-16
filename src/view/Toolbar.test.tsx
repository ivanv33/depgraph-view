// @vitest-environment jsdom
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import Toolbar from './Toolbar.js'

afterEach(cleanup)

describe('Toolbar', () => {
  it('toolbar toggles group and fits', () => {
    const onToggleGroup = vi.fn()
    const onFit = vi.fn()
    const { rerender } = render(<Toolbar grouped={false} onToggleGroup={onToggleGroup} onFit={onFit} />)
    const toggle = screen.getByTestId('group-toggle')
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(toggle)
    expect(onToggleGroup).toHaveBeenCalledTimes(1)
    rerender(<Toolbar grouped onToggleGroup={onToggleGroup} onFit={onFit} />)
    expect(screen.getByTestId('group-toggle').getAttribute('aria-pressed')).toBe('true')
    const fit = screen.getByTestId('fit-plan')
    expect(fit).toBe(screen.getByRole('button', { name: 'Fit the whole plan' }))
    fireEvent.click(fit)
    expect(onFit).toHaveBeenCalledTimes(1)
    expect(onToggleGroup).toHaveBeenCalledTimes(1)
  })
  it('puts its children first', () => {
    render(
      <Toolbar grouped={false} onToggleGroup={() => {}} onFit={() => {}}>
        <input data-testid="search" />
      </Toolbar>,
    )
    expect(screen.getByTestId('toolbar').firstElementChild).toBe(screen.getByTestId('search'))
  })
  it('hands the group toggle to toggleRef', () => {
    const ref = createRef<HTMLButtonElement>()
    render(<Toolbar grouped={false} onToggleGroup={() => {}} onFit={() => {}} toggleRef={ref} />)
    expect(ref.current).toBe(screen.getByTestId('group-toggle'))
  })
})
