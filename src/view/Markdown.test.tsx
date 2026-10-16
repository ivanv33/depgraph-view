// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import Markdown from './Markdown.js'

afterEach(cleanup)

describe('Markdown', () => {
  it('renders relative images through /files and absolute ones as alt text', () => {
    render(<Markdown nodeId="a" markdown={'![sketch](sketch.png) ![remote](https://example.com/t.png)'} />)
    expect(screen.getByRole('img').getAttribute('src')).toBe('/files/a/sketch.png')
    expect(screen.getByText('remote').tagName).toBe('SPAN')
  })
  it('never renders an image that climbs out of the folder', () => {
    const { container } = render(<Markdown nodeId="a" markdown={'![up](../secret.png) ![rooted](/etc/x.png)'} />)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('up').tagName).toBe('SPAN')
  })
  it('opens relative and http(s) links in a new tab, relative ones through /files', () => {
    render(<Markdown nodeId="bed" markdown={'[notes](notes.md#part) and [site](https://example.com/)'} />)
    const notes = screen.getByRole('link', { name: 'notes' })
    expect(notes.getAttribute('href')).toBe('/files/bed/notes.md#part')
    expect(notes.getAttribute('target')).toBe('_blank')
    expect(notes.getAttribute('rel')).toBe('noopener noreferrer')
    const site = screen.getByRole('link', { name: 'site' })
    expect(site.getAttribute('href')).toBe('https://example.com/')
    expect(site.getAttribute('target')).toBe('_blank')
    expect(site.getAttribute('rel')).toBe('noopener noreferrer')
  })
  it('keeps in-page #fragment links and renders other unresolved links as plain text', () => {
    render(<Markdown nodeId="a" markdown={'[top](#top) [host](//host/x) [up](../x.md) [rooted](/rooted)'} />)
    expect(screen.getByRole('link', { name: 'top' }).getAttribute('href')).toBe('#top')
    for (const name of ['host', 'up', 'rooted']) {
      expect(screen.queryByRole('link', { name }), name).toBeNull()
      expect(screen.getByText(name).tagName, name).toBe('SPAN')
    }
  })
  it('drops javascript: urls and raw html', () => {
    const { container } = render(<Markdown nodeId="a" markdown={'[bad](javascript:alert(1))\n\n<b data-raw>raw</b>'} />)
    expect(container.innerHTML).not.toContain('javascript:')
    expect(container.querySelector('[data-raw]')).toBeNull()
  })
  it('renders gfm tables', () => {
    const { container } = render(<Markdown nodeId="a" markdown={'| a | b |\n|---|---|\n| 1 | 2 |'} />)
    expect(container.querySelector('table')).not.toBeNull()
  })
})
