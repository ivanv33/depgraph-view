import { describe, expect, it } from 'vitest'
import { idleLink, shiftLinkStep, type ShiftLinkEvent, type ShiftLinkState, type ShiftLinkEffect } from './shiftLink.js'

const armed = (from: string): ShiftLinkState => ({ from })
const none: ShiftLinkEffect = { type: 'none' }

describe('shiftLinkStep', () => {
  it.each<[string, ShiftLinkState, ShiftLinkEvent, ShiftLinkState, ShiftLinkEffect]>([
    // the first Shift+click on a step arms the link from it and changes nothing else
    ['idle, Shift+click a step: armed from it', idleLink, { type: 'shiftPick', id: 's' }, armed('s'), none],
    // a deck is no step to link from or to: it shakes, and an armed link stays armed
    ['idle, Shift+click a deck: shake', idleLink, { type: 'shiftPick', id: 'd', deck: true }, idleLink, { type: 'shake', id: 'd' }],
    ['armed, Shift+click a deck: shake, still armed', armed('s'), { type: 'shiftPick', id: 'd', deck: true }, armed('s'), { type: 'shake', id: 'd' }],
    // the second Shift+click on another step makes it depend on the first
    ['armed, Shift+click another step: link', armed('s'), { type: 'shiftPick', id: 't' }, idleLink, { type: 'link', from: 's', to: 't' }],
    // Shift+click on the source again: off, quietly
    ['armed, Shift+click the source: off', armed('s'), { type: 'shiftPick', id: 's' }, idleLink, none],
    // a canvas click, Shift up, a move without Shift, the window losing focus, Escape, the source no longer drawn
    ['armed, cancel: idle', armed('s'), { type: 'cancel' }, idleLink, none],
    // a plain pick cancels, and the pick goes on as ever (the caller does it)
    ['armed, plain pick: idle', armed('s'), { type: 'plainPick' }, idleLink, none],
    ['idle, cancel: idle', idleLink, { type: 'cancel' }, idleLink, none],
    ['idle, plain pick: idle', idleLink, { type: 'plainPick' }, idleLink, none],
  ])('%s', (_name, state, event, next, effect) => {
    expect(shiftLinkStep(state, event)).toEqual({ state: next, effect })
  })

  it('a step that changes nothing returns the same state object', () => {
    expect(shiftLinkStep(idleLink, { type: 'cancel' }).state).toBe(idleLink)
    const s = armed('s')
    expect(shiftLinkStep(s, { type: 'shiftPick', id: 'd', deck: true }).state).toBe(s)
  })
})
