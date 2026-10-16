import { describe, expect, it } from 'vitest'
import { aimHoles, crossed, MARK_CSS, placePlate, plateHoles, plateLeft, plateShift, plateWidths, PLATE, wrappedAt, type HoleAim, type Other } from './plateFit.js'

const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom })
const dot = (id: string, cx: number, cy: number, r = 5): Other => ({ id, box: box(cx - r, cy - r, cx + r, cy + r) })

// The selected circle at (100, 200); its plate from x 130, 138 wide, two title lines and the id line (42 tall).
const plate = box(130, 179, 268, 221)
const line = 14.4
// its brackets 44px across
const anchor = { cy: 200, reach: 22 }

describe('crossed', () => {
  it('names the circles the plate crosses, not one it only touches', () => {
    expect(crossed(plate, [dot('in', 200, 200), dot('edge', 273, 200), dot('far', 400, 200)])).toEqual(['in'])
  })
})

describe('plateWidths', () => {
  it('is the full width alone when nothing is crossed', () => {
    expect(plateWidths(plate, [dot('far', 400, 200)], 60)).toEqual([138])
  })

  it('adds a width ending before each crossed circle, widest first', () => {
    // the side deck's fan at x 215..235 in its row, and a circle below at x 250
    const ws = plateWidths(plate, [{ id: 'deck', box: box(215, 190, 235, 210) }, dot('below', 255, 218)], 60)
    expect(ws).toEqual([138, 250 - PLATE.gap - 130, 215 - PLATE.gap - 130])
  })

  it('never narrower than the least width (a few letters and the padding)', () => {
    expect(plateWidths(plate, [dot('close', 160, 200)], 60)).toEqual([138])
  })
})

describe('placePlate', () => {
  const tries = (others: Other[]) => plateWidths(plate, others, 60).map(width => ({ width, box: { ...plate, right: plate.left + width } }))

  it('keeps the plate as it is when it crosses nothing', () => {
    expect(placePlate([{ width: 138, box: plate }], anchor, line, [dot('far', 400, 200)])).toEqual({ width: 138, dy: 0, covered: [] })
  })

  it('narrows it to end before the next circle in its row (the words wrap; measured taller)', () => {
    const others = [{ id: 'deck', box: box(215, 190, 235, 210) }]
    const narrow = 215 - PLATE.gap - 130
    const got = placePlate(
      [
        { width: 138, box: plate },
        { width: narrow, box: box(130, 172, 130 + narrow, 228) },
      ],
      anchor,
      line,
      others,
    )
    expect(got).toEqual({ width: narrow, dy: 0, covered: [] })
  })

  it('moves it up off a circle in the row below rather than narrowing it, its circle still beside its words', () => {
    const below = dot('below', 255, 222)
    const got = placePlate(tries([below]), anchor, line, [below])
    expect(got.width).toBe(138)
    // its top at 217: the plate's bottom (221) moves to 217 - gap
    expect(got.dy).toBe(217 - PLATE.gap - 221)
    expect(got.covered).toEqual([])
    expect(plate.top + got.dy + line / 2).toBeLessThanOrEqual(200)
  })

  it('failing a clear place beside, moves it to a corner of the brackets where it is clear', () => {
    // the row of the circle and the row below are full under the plate; above them is empty
    const crowd = [dot('a', 150, 200), dot('b', 200, 200), dot('c', 250, 200), dot('d', 175, 214), dot('e', 225, 214)]
    const got = placePlate([{ width: 138, box: plate }], anchor, line, crowd, box(0, 0, 1280, 720))
    expect(got.covered).toEqual([])
    expect(got.width).toBe(138)
    // up, its bottom just clear of the row of its circle, and no higher than level with the brackets' top
    expect(got.dy).toBe(195 - PLATE.gap - 221)
    expect(plate.bottom + got.dy).toBeGreaterThanOrEqual(200 - 22)
  })

  it('never moves it out of the window', () => {
    const crowd = [dot('a', 150, 200), dot('b', 200, 200), dot('c', 250, 200), dot('d', 175, 214), dot('e', 225, 214)]
    const got = placePlate([{ width: 138, box: plate }], anchor, line, crowd, box(0, 170, 1280, 230))
    expect(plate.top + got.dy).toBeGreaterThanOrEqual(170)
    expect(plate.bottom + got.dy).toBeLessThanOrEqual(230)
    expect(got.covered.length).toBeGreaterThan(0)
  })

  it('in a crowd with no clear place, takes the one crossing fewest, the usual one first, and names what it still crosses', () => {
    const crowd = [dot('a', 150, 200), dot('b', 190, 186), dot('c', 230, 214), dot('d', 250, 200)]
    // the window leaves it no room to move up or down
    const got = placePlate(tries(crowd), anchor, line, crowd, box(0, 179, 1280, 221))
    expect(got.covered.length).toBeGreaterThan(0)
    expect(got.covered.length).toBeLessThanOrEqual(crowd.length)
    expect(crossed({ ...plate, right: plate.left + got.width, top: plate.top + got.dy, bottom: plate.bottom + got.dy }, crowd)).toEqual(got.covered)
  })

  it('a circle in its row too close to end the plate before it: moved to a corner of the brackets, at its full width', () => {
    const one = dot('a', 150, 200)
    expect(placePlate(tries([one]), anchor, line, [one], box(0, 0, 1280, 720))).toEqual({ width: 138, dy: 195 - PLATE.gap - 221, covered: [] })
  })

  it('with no clear place, a tie keeps the usual width and place', () => {
    const one = dot('a', 150, 200)
    expect(placePlate(tries([one]), anchor, line, [one], plate)).toEqual({ width: 138, dy: 0, covered: ['a'] })
  })
})

describe('plateWidths, how many', () => {
  it('tries at most PLATE.maxTries widths: the full one and the widest narrower ones', () => {
    const many = [160, 175, 190, 205, 220, 235, 250].map((x, i) => dot(`d${i}`, x + 5, 200))
    const ws = plateWidths(plate, many, 10)
    expect(ws).toHaveLength(PLATE.maxTries)
    expect(ws).toEqual([138, ...[250, 235, 220].map(x => x - PLATE.gap - 130)].slice(0, PLATE.maxTries))
  })
})

describe('placePlate and the window', () => {
  it('skips a narrower width whose taller plate would reach out of the window', () => {
    const deck = { id: 'deck', box: box(215, 190, 235, 210) }
    const narrow = 215 - PLATE.gap - 130
    // narrowed, the words wrap onto more lines and the plate reaches past the window's bottom (225)
    const got = placePlate(
      [
        { width: 138, box: plate },
        { width: narrow, box: box(130, 165, 130 + narrow, 235) },
      ],
      anchor,
      line,
      [deck],
      box(0, 0, 1280, 225),
    )
    expect(got.width).toBe(138)
  })
})

describe('placePlate keeps where it was', () => {
  const win = box(0, 0, 1280, 720)
  const was = (p: { width: number; dy: number }) => ({ width: p.width, dy: p.dy, box: { ...plate, right: plate.left + p.width, top: plate.top + p.dy, bottom: plate.bottom + p.dy } })

  it('a sequence of fits with the view moving a little keeps the placement while it still crosses nothing', () => {
    let prev: { width: number; dy: number } | undefined
    const seen: number[] = []
    for (let step = 0; step < 8; step++) {
      // a circle in the row below, under the plate's bottom at first, drifts down a px a fit as the view pans
      const below = dot('below', 255, 222 + step)
      const at = placePlate([{ width: 138, box: plate }], anchor, line, [below], win, prev && was(prev))
      expect(at.covered).toEqual([])
      seen.push(at.dy)
      prev = at
    }
    // centred is clear again from the fifth fit on, but the moved plate is kept: no flip back and forth
    expect(seen[0]).toBeLessThan(0)
    expect(new Set(seen).size).toBe(1)
  })

  it('places it afresh once where it was crosses a circle', () => {
    const across = dot('across', 200, 200)
    const got = placePlate([{ width: 138, box: plate }], anchor, line, [across], win, was({ width: 138, dy: 0 }))
    expect(got.dy).not.toBe(0)
    expect(got.covered).toEqual([])
  })

  it('places it afresh once where it was moved to is out of the window', () => {
    const got = placePlate([{ width: 138, box: plate }], anchor, line, [], box(0, 170, 1280, 720), was({ width: 138, dy: -20 }))
    expect(got).toEqual({ width: 138, dy: 0, covered: [] })
  })
})

describe('plateHoles', () => {
  // the plate drawn at 2 screen px a plate px: a hole's place and size are in the plate's own px from its top left
  it('cuts the backing round each circle the plate still crosses, PLATE.gap px clear of it, so it shows through', () => {
    const others = [dot('in', 200, 200), dot('far', 400, 200)]
    const r = (5 + PLATE.gap) / 2
    expect(plateHoles(plate, 2, others, ['in'])).toBe(`radial-gradient(${r}px ${r}px at 35px 10.5px, #0000 98%, #000 100%)`)
  })

  it('cuts nothing where it crosses no circle', () => {
    expect(plateHoles(plate, 2, [dot('far', 400, 200)], [])).toBe('')
  })

  it("cuts one hole for each of a step's boxes that crosses the plate (its circle, its tag), none for one that does not", () => {
    const others: Other[] = [dot('b', 150, 200), { id: 'b', box: box(140, 214, 160, 226) }, { id: 'b', box: box(300, 190, 320, 200) }]
    const holes = plateHoles(plate, 1, others, ['b'])
    expect(holes.match(/radial-gradient/g)).toHaveLength(2)
    expect(holes).toContain(`${10 + PLATE.gap}px ${6 + PLATE.gap}px at 20px 41px`)
  })
})

describe('wrappedAt', () => {
  const at = (w: number, h: number) => ({ at: w, left: 0, top: -h / 2 - 2, w: w + 12, h })
  it('is a width measured before, as measured', () => {
    expect(wrappedAt([at(90, 46)], 90)).toEqual(at(90, 46))
  })
  it('between two widths drawn just as tall, is that tall, its box as much narrower as the width', () => {
    expect(wrappedAt([at(80, 46), at(100, 46), at(60, 62)], 92)).toEqual(at(92, 46))
  })
  it('is not known between widths drawn on different numbers of lines, nor past the widths measured', () => {
    expect(wrappedAt([at(60, 62), at(100, 46)], 80)).toBeNull()
    expect(wrappedAt([at(80, 46), at(100, 46)], 110)).toBeNull()
    expect(wrappedAt([at(80, 46)], 70)).toBeNull()
  })
  it('is not known between two widths drawn as tall whose boxes start or pad their words differently', () => {
    // the narrower one starts a px further right
    expect(wrappedAt([{ ...at(80, 46), left: 1 }, at(100, 46)], 90)).toBeNull()
    // the narrower one's box is a px wider round its words than the wider one's
    expect(wrappedAt([{ ...at(80, 46), w: 80 + 13 }, at(100, 46)], 90)).toBeNull()
    // within half a px of each other, both still are
    expect(wrappedAt([{ ...at(80, 46), left: 0.3, w: 80 + 12.3 }, at(100, 46)], 90)).not.toBeNull()
  })
  it('from a width measured down to the narrowest its lines all still fit at (from), is as tall, and no further', () => {
    expect(wrappedAt([{ ...at(100, 46), from: 84 }], 90)).toEqual(at(90, 46))
    expect(wrappedAt([{ ...at(100, 46), from: 84 }], 84)).toEqual(at(84, 46))
    expect(wrappedAt([{ ...at(100, 46), from: 84 }], 83)).toBeNull()
    expect(wrappedAt([{ ...at(100, 46), from: 84 }], 104)).toBeNull()
  })
  it('from a width measured up to the widest no line takes the next first word at (to), is as tall, and no further', () => {
    expect(wrappedAt([{ ...at(100, 46), to: 110 }], 106)).toEqual(at(106, 46))
    expect(wrappedAt([{ ...at(100, 46), to: 110 }], 110)).toEqual(at(110, 46))
    expect(wrappedAt([{ ...at(100, 46), to: 110 }], 111)).toBeNull()
  })
})

describe('plateLeft and plateShift', () => {
  // a normal circle (radius 5 card px) at card zoom 1: the usual brackets are max(44, 2 x 5 + 20) = 44 card px across
  const at1 = { dotR: 5, z: 1, overdue: false }

  it('starts the plate right of the usual brackets where the room is wider than they are', () => {
    // max(40, 18 + 44 / 2 + 3 + 6)
    expect(plateLeft(Infinity, at1)).toBeCloseTo(49)
    expect(plateLeft(200, at1)).toBeCloseTo(49)
  })

  it('moves it in with brackets narrowed to the room, but never inside their least size', () => {
    // brackets 30 across: 18 + 15 + 3 + 6
    expect(plateLeft(30, at1)).toBeCloseTo(42)
    // the least: (5 + 2) x 2 + 8 = 22 across, where the plate's own 40 px start wins
    expect(plateLeft(0, at1)).toBeCloseTo(40)
    // an overdue ring keeps the brackets (5 + 9) x 2 + 8 = 36 across
    expect(plateLeft(0, { ...at1, overdue: true })).toBeCloseTo(18 + 18 + 3 + 6)
  })

  it('zoomed out, the brackets and the plate keep their size on screen (card px grow as the zoom falls)', () => {
    // brackets 44 / 0.5 = 88 card px, a 3 / 0.5 px gap, and the padding drawn at the words' boost, 12 / 6.5
    expect(plateLeft(Infinity, { ...at1, z: 0.5 })).toBeCloseTo(18 + 44 + 6 + (6 * 12) / 6.5)
  })

  it('shifts the plate (screen px) only by what the change of room moves the brackets', () => {
    expect(plateShift(Infinity, 200, at1, 2), 'both rooms wider than the usual brackets').toBe(0)
    expect(plateShift(44, 30, at1, 2)).toBeCloseTo(-14)
    expect(plateShift(30, 44, at1, 2)).toBeCloseTo(14)
    expect(plateShift(10, 0, at1, 2), 'both under the least, where the plate starts at its own 40 px').toBe(0)
  })
})

describe('aimHoles', () => {
  // A zoom about the window's centre: each step's anchor (where the renderer puts it) is its place in the plan times
  // the pixels per unit; its card is drawn at the label scale (the clamped ppu) times its own near-scale, and everything
  // on it (its circle, the plate) at that zoom from the anchor.
  const W = { x: 640, y: 360 }
  const at = (wx: number, wy: number, ppu: number, near = 1) => ({ x: W.x + wx * ppu, y: W.y + wy * ppu, z: Math.min(1.6, Math.max(0.45, ppu)) * near })
  // the selected circle 67 card px left of its anchor; its plate's top 30 plate px above the circle's centre, 120 x 60;
  // the covered step's circle (radius 7 with its 2px ring: 9 card px each way) 67 card px left of its own anchor
  const aim: HoleAim = { dot: { x: -67, y: 0 }, top: -30, w: 120, h: 60, parts: [{ id: 'k16', x: -67, y: 0, hw: 9, hh: 9 }] }
  const style = (z: number) => ({ dotR: 11, z, overdue: false })
  const holeOn = (holes: string, plate: { left: number; top: number }, s: number) => {
    const m = /radial-gradient\(([\d.]+)px ([\d.]+)px at ([\d.-]+)px ([\d.-]+)px/.exec(holes)!
    const [rx, , x, y] = m.slice(1).map(Number)
    return { x: plate.left + x * s, y: plate.top + y * s, rx: rx * s }
  }

  it('keeps the hole on its circle at every zoom, as the circle moves against the plate', () => {
    let cut = 0
    for (const ppu of [0.3, 0.5, 0.62, 0.8, 1.1, 2]) {
      const sel = at(0, 0, ppu)
      const nb = at(60, 4, ppu, 1.3)
      const holes = aimHoles(aim, { ...sel, room: Infinity, style: style(sel.z) }, new Map([['k16', nb]]))
      // (where the plate reaches the circle: else no hole is cut)
      if (!holes) continue
      cut++
      const boost = Math.max(1, MARK_CSS.minTitle / (MARK_CSS.title * sel.z))
      const s = sel.z * boost
      const cx = sel.x + sel.z * aim.dot.x
      const plate = { left: cx + sel.z * (plateLeft(Infinity, style(sel.z)) - MARK_CSS.padding * boost - MARK_CSS.centre), top: sel.y + s * aim.top }
      const circle = { x: nb.x - 67 * nb.z, y: nb.y }
      const h = holeOn(holes, plate, s)
      expect(Math.abs(h.x - circle.x), `ppu ${ppu}: across`).toBeLessThan(0.02)
      expect(Math.abs(h.y - circle.y), `ppu ${ppu}: down`).toBeLessThan(0.02)
      expect(h.rx, `ppu ${ppu}: PLATE.gap clear of the circle`).toBeCloseTo(9 * nb.z + PLATE.gap, 1)
    }
    expect(cut, 'zooms at which the plate reaches the circle').toBeGreaterThan(2)
  })

  it('cuts the same holes wherever a pan moves the plan whole', () => {
    const sel = at(0, 0, 0.62)
    const nb = at(60, 4, 0.62, 1.3)
    const pan = (p: { x: number; y: number; z: number }) => ({ ...p, x: p.x + 37.5, y: p.y - 12 })
    const a = aimHoles(aim, { ...sel, room: Infinity, style: style(sel.z) }, new Map([['k16', nb]]))
    expect(a).not.toBe('')
    expect(aimHoles(aim, { ...pan(sel), room: Infinity, style: style(sel.z) }, new Map([['k16', pan(nb)]]))).toBe(a)
  })

  it('cuts none for a step not drawn, nor where its circle has left the plate', () => {
    const sel = at(0, 0, 0.62)
    expect(aimHoles(aim, { ...sel, room: Infinity, style: style(sel.z) }, new Map())).toBe('')
    expect(aimHoles(aim, { ...sel, room: Infinity, style: style(sel.z) }, new Map([['k16', at(400, 4, 0.62, 1.3)]]))).toBe('')
  })
})
