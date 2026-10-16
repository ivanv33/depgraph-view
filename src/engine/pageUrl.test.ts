import { describe, expect, it } from 'vitest'
import { searchWithStep, stepFromSearch } from './pageUrl.js'

describe('stepFromSearch', () => {
  it('reads the selected step from the query', () => {
    expect(stepFromSearch('?plan=a&step=n1')).toBe('n1')
    expect(stepFromSearch(new URLSearchParams('step=n1'))).toBe('n1')
  })
  it('is null without one, or with an empty or malformed one', () => {
    expect(stepFromSearch('?plan=a')).toBeNull()
    expect(stepFromSearch('?plan=a&step=')).toBeNull()
    expect(stepFromSearch('?plan=a&step=Not%20An%20Id')).toBeNull()
    expect(stepFromSearch('')).toBeNull()
  })
})

describe('searchWithStep', () => {
  it('adds the step after the plan, keeping other params', () => {
    expect(searchWithStep('?plan=a', 'n1')).toBe('?plan=a&step=n1')
    expect(searchWithStep('?plan=a&x=1', 'n1')).toBe('?plan=a&x=1&step=n1')
  })
  it('replaces the step in place', () => {
    expect(searchWithStep('?plan=a&step=n1&x=1', 'n2')).toBe('?plan=a&step=n2&x=1')
  })
  it('drops the step with nothing selected', () => {
    expect(searchWithStep('?plan=a&step=n1', null)).toBe('?plan=a')
    expect(searchWithStep('?plan=a', null)).toBe('?plan=a')
    expect(searchWithStep('?step=n1', null)).toBe('')
  })
})
