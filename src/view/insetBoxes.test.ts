import { describe, expect, it } from 'vitest'
import { insetBoxes } from './insetBoxes.js'

describe('insetBoxes', () => {
  it('turns a toolbar height and a panel width into boxes', () => {
    expect(insetBoxes({ w: 1000, h: 700 }, { top: 56, right: 400, bottom: 0, left: 0 })).toEqual({
      toolbar: { left: 0, top: 0, right: 1000, bottom: 56 },
      panel: { left: 600, top: 0, right: 1000, bottom: 700 },
    })
    expect(insetBoxes({ w: 1000, h: 700 }, { top: 0, right: 0, bottom: 0, left: 0 })).toEqual({})
  })

  it('turns a bottom sheet\'s height into a box across the bottom', () => {
    expect(insetBoxes({ w: 390, h: 844 }, { top: 114, right: 0, bottom: 300, left: 0 })).toEqual({
      toolbar: { left: 0, top: 0, right: 390, bottom: 114 },
      hud: { left: 0, top: 544, right: 390, bottom: 844 },
    })
  })
})
