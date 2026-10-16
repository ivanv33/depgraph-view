import { describe, expect, it } from 'vitest'
import { shiftHeld } from './shiftHeld.js'

describe('shiftHeld', () => {
  it('keydown of Shift sets it', () => expect(shiftHeld(false, { type: 'keydown', key: 'Shift', shiftKey: true })).toBe(true))
  it('keyup of Shift clears it', () => expect(shiftHeld(true, { type: 'keyup', key: 'Shift', shiftKey: false })).toBe(false))
  it('blur clears it', () => expect(shiftHeld(true, { type: 'blur' })).toBe(false))
  it('another key with Shift still held keeps the state', () => {
    expect(shiftHeld(true, { type: 'keydown', key: 'a', shiftKey: true })).toBe(true)
    expect(shiftHeld(false, { type: 'keyup', key: 'a', shiftKey: false })).toBe(false)
  })
  it('another key with shiftKey false clears it (released while unfocused)', () => {
    expect(shiftHeld(true, { type: 'keydown', key: 'a', shiftKey: false })).toBe(false)
    expect(shiftHeld(true, { type: 'keyup', key: 'a', shiftKey: false })).toBe(false)
  })
})
