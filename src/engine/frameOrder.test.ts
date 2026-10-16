import { describe, expect, it } from 'vitest'
import { runFrame } from './frameOrder.js'

describe('runFrame', () => {
  it('runs the reads first, in order, then the writes in order', () => {
    const order: string[] = []
    runFrame([() => order.push('list'), null, () => order.push('fit')], [() => order.push('scale'), null, () => order.push('cue')])
    expect(order).toEqual(['list', 'fit', 'scale', 'cue'])
  })

  it('still writes the scale and the cues when the fit throws, and throws the error on', () => {
    const order: string[] = []
    expect(() =>
      runFrame(
        [
          () => {
            throw new Error('fit failed')
          },
        ],
        [() => order.push('scale'), () => order.push('cue')],
      ),
    ).toThrow('fit failed')
    expect(order).toEqual(['scale', 'cue'])
  })

  it('runs every write when one throws, and throws the first error on, a read error before a write error', () => {
    const order: string[] = []
    const throwing = (msg: string) => () => {
      throw new Error(msg)
    }
    expect(() => runFrame([], [throwing('place failed'), () => order.push('scale'), throwing('cue failed')])).toThrow('place failed')
    expect(order).toEqual(['scale'])
    expect(() => runFrame([throwing('fit failed')], [throwing('place failed'), () => order.push('scale')])).toThrow('fit failed')
    expect(order).toEqual(['scale', 'scale'])
  })

  it('runs every read when one throws (a deck list failing does not stop the fit), and throws the first error on', () => {
    const order: string[] = []
    expect(() =>
      runFrame(
        [
          () => {
            throw new Error('list failed')
          },
          () => order.push('fit'),
          () => {
            throw new Error('fit failed')
          },
        ],
        [() => order.push('scale')],
      ),
    ).toThrow('list failed')
    expect(order).toEqual(['fit', 'scale'])
  })
})
