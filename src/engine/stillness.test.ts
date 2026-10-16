import { describe, expect, it } from 'vitest'
import { isStill } from './stillness.js'

const rest = { gliding: false, dragging: false, resizing: false, labelsPending: false, still: 2 }

describe('isStill', () => {
  it('is true with no glide, no drag, no pending resize and a measuring fit run on a still view', () => {
    expect(isStill(rest)).toBe(true)
    expect(isStill({ ...rest, still: 5 })).toBe(true)
  })
  it('is false while the camera glides', () => expect(isStill({ ...rest, gliding: true })).toBe(false))
  it('is false while a drag is in progress', () => expect(isStill({ ...rest, dragging: true })).toBe(false))
  it('is false while a resize has not settled', () => expect(isStill({ ...rest, resizing: true })).toBe(false))
  it('is false while the plan has steps and no title has been drawn yet', () =>
    expect(isStill({ ...rest, labelsPending: true, still: 9 })).toBe(false))
  it('is false until the second still frame', () => {
    expect(isStill({ ...rest, still: 1 })).toBe(false)
    expect(isStill({ ...rest, still: 0 })).toBe(false)
  })
})
