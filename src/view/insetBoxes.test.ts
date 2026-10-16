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
})
