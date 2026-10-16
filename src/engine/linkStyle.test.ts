import { describe, expect, it } from 'vitest'
import { edgeOpacity, linkRole, linkStyle } from './linkStyle.js'
import type { Chain } from './chain.js'

const chain: Chain = { upstream: new Set(['a', 'b']), downstream: new Set(['d', 'e']) }
// selected = s ; a -> b -> s -> d -> e
describe('linkRole', () => {
  it('is none when nothing is selected', () => {
    expect(linkRole('a', 'b', null, chain)).toBe('none')
  })
  it('upstream for edges into the selection chain', () => {
    expect(linkRole('b', 's', 's', chain)).toBe('upstream')
    expect(linkRole('a', 'b', 's', chain)).toBe('upstream')
  })
  it('downstream for edges out of the selection chain', () => {
    expect(linkRole('s', 'd', 's', chain)).toBe('downstream')
    expect(linkRole('d', 'e', 's', chain)).toBe('downstream')
  })
  it('other otherwise', () => {
    expect(linkRole('x', 'y', 's', chain)).toBe('other')
    expect(linkRole('x', 'b', 's', chain)).toBe('other')
    expect(linkRole('s', 'a', 's', chain)).toBe('other')
  })
  it('hover for the direct edges of the hovered card, in both directions, only with nothing selected', () => {
    expect(linkRole('h', 'y', null, chain, 'h')).toBe('hover')
    expect(linkRole('x', 'h', null, chain, 'h')).toBe('hover')
    expect(linkRole('x', 'y', null, chain, 'h')).toBe('none')
    expect(linkRole('b', 's', 's', chain, 'b')).toBe('upstream')
    expect(linkRole('x', 'y', 's', chain, 'x')).toBe('other')
  })
})

describe('linkStyle', () => {
  it('matches the spec values', () => {
    expect(linkStyle('none', false)).toEqual({ color: '#c9d3e6', width: 1.8, arrow: 9, dashed: false })
    expect(linkStyle('none', true)).toEqual({ color: '#4a5266', width: 1, arrow: 6, dashed: false })
    expect(linkStyle('upstream', false)).toEqual({ color: '#ffb454', width: 2.6, arrow: 10, dashed: false })
    expect(linkStyle('downstream', false)).toEqual({ color: '#5ac8fa', width: 2.6, arrow: 10, dashed: false })
    expect(linkStyle('other', false)).toEqual({ color: '#2a3040', width: 0.8, arrow: 5, dashed: false })
  })
  it('sourceDone only matters for none', () => {
    expect(linkStyle('upstream', true)).toEqual(linkStyle('upstream', false))
    expect(linkStyle('other', true)).toEqual(linkStyle('other', false))
  })
  it('draws a redundant edge faint and dashed when nothing is selected', () => {
    expect(linkStyle('none', false, true)).toEqual({ color: '#2a3040', width: 0.8, arrow: 4, dashed: true })
    expect(linkStyle('none', true, true)).toEqual({ color: '#2a3040', width: 0.8, arrow: 4, dashed: true })
  })
  it('gives a redundant edge in the selected chain the chain colour at width 1.2', () => {
    expect(linkStyle('upstream', false, true)).toMatchObject({ color: '#ffb454', width: 1.2 })
    expect(linkStyle('downstream', false, true)).toMatchObject({ color: '#5ac8fa', width: 1.2 })
    expect(linkStyle('other', false, true)).toMatchObject({ color: '#2a3040', width: 0.8 })
  })
  it('highlights a hovered card’s edges at the needs colour and full width', () => {
    expect(linkStyle('hover', true)).toEqual({ color: '#c9d3e6', width: 2.6, arrow: 10, dashed: false })
    expect(linkStyle('hover', false, true)).toEqual(linkStyle('hover', true))
  })
})

describe('edgeOpacity', () => {
  it('is the lower strength of the two ends', () => {
    expect(edgeOpacity(1, 1)).toBe(1)
    expect(edgeOpacity(0.4, 1)).toBe(0.4)
    expect(edgeOpacity(0.9, 0.5)).toBe(0.5)
  })
  it('is full strength while the edge is highlighted (hovered or on the selected chain), however far off its ends are', () => {
    for (const role of ['upstream', 'downstream', 'hover'] as const) expect(edgeOpacity(0.4, 0.6, role)).toBe(1)
    expect(edgeOpacity(0.4, 1, 'none')).toBe(0.4)
    expect(edgeOpacity(0.4, 1, 'other')).toBe(0.4)
  })
})
