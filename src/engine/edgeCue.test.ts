import { describe, expect, it } from 'vitest'
import { CARD_ESTIMATE, CUE_GAP, CUE_INSET, CUE_MARGIN, CUE_ROOM, cardBox, coverSide, cueAreaBottom, cueSize, dropGone, edgeCues, extentOf, placeCue, placeCues, cueBox, type CuePoint } from './edgeCue.js'

const area = { left: 0, top: 72, right: 800, bottom: 500 }
const up = (x: number, y: number): CuePoint => ({ x, y, kind: 'up' })
const down = (x: number, y: number): CuePoint => ({ x, y, kind: 'down' })

describe('edgeCues', () => {
  it('gives no cue while every marked step is inside the free area', () => {
    expect(edgeCues([up(100, 100), down(700, 480), up(0, 72)], area)).toEqual([])
    expect(edgeCues([], area)).toEqual([])
  })

  it('counts the steps beyond each edge, on the side they lie, at the mean of where they are along it', () => {
    // a column: three steps that need the selection above the toolbar strip, two it needs below the card
    const cues = edgeCues([down(300, 40), down(300, -60), down(300, -160), up(300, 560), up(300, 660)], area)
    expect(cues).toEqual([
      { side: 'top', count: 3, kind: 'down', at: 300 },
      { side: 'bottom', count: 2, kind: 'up', at: 300 },
    ])
  })

  it('puts a step off a corner on the side it is farther past', () => {
    const cues = edgeCues([up(-50, 40), up(-300, 40), up(900, 700)], area)
    expect(cues).toEqual([
      { side: 'bottom', count: 1, kind: 'up', at: area.right - CUE_MARGIN },
      { side: 'left', count: 2, kind: 'up', at: 72 + CUE_MARGIN },
    ])
  })

  it('says both when needs and steps that need it lie past the same edge', () => {
    expect(edgeCues([up(1000, 200), down(1200, 300)], area)).toEqual([{ side: 'right', count: 2, kind: 'both', at: 250 }])
  })

  it('keeps the cue inside the edge it sits on, clear of the corners', () => {
    expect(edgeCues([down(5, -10)], area)).toEqual([{ side: 'top', count: 1, kind: 'down', at: CUE_MARGIN }])
    expect(edgeCues([down(790, 900)], area)).toEqual([{ side: 'bottom', count: 1, kind: 'down', at: area.right - CUE_MARGIN }])
  })

  it('orders the cues top, bottom, left, right', () => {
    const sides = edgeCues([up(900, 300), up(-100, 300), up(400, 900), up(400, -100)], area).map(c => c.side)
    expect(sides).toEqual(['top', 'bottom', 'left', 'right'])
  })

  // At 800 px the side panel lies over the graph: folded, its header under the toolbar at the top right; open, a sheet
  // down the right. The free area (the frame's) runs under it, so a circle there is inside the area yet hidden.
  const header = { left: 385, top: 66, right: 784, bottom: 108 }
  const sheet = { left: 384, top: 64, right: 784, bottom: 490 }

  it('counts a step hidden under a panel lying over the free area as out of view, past the edge the panel runs along', () => {
    // a column running up under the folded header: t1 under it, t0 above the strip
    expect(edgeCues([down(500, 40), down(500, 90), down(500, 200)], area, [header])).toEqual([{ side: 'top', count: 2, kind: 'down', at: 500 }])
    // under the open sheet, which runs down the right edge: off to the right, though not past the window's edge
    expect(edgeCues([up(600, 300), up(300, 300)], area, [sheet])).toEqual([{ side: 'right', count: 1, kind: 'up', at: 300 }])
  })

  it('leaves a step beside a cover in view, and gives the same cues as before where nothing lies over the free area', () => {
    const pts = [down(380, 90), down(500, 112), up(300, 560), down(300, 40), up(-50, 40)]
    expect(edgeCues(pts, area, [header])).toEqual(edgeCues(pts, area))
    // a cover wholly in a strip (the toolbar, the side panel beside the graph on a wide window) changes nothing
    const toolbar = { left: 16, top: 16, right: 615, bottom: 61 }
    const side = { left: 864, top: 64, right: 1264, bottom: 704 }
    expect(edgeCues(pts, area, [toolbar, side])).toEqual(edgeCues(pts, area))
    expect(edgeCues(pts, area, [])).toEqual(edgeCues(pts, area))
  })

  it('needs a cover to reach at least 1 px into the free area: one that meets its edge (a docked panel at a fractional zoom) is no cover', () => {
    const docked = { left: area.right - 0.5, top: 64, right: area.right + 400, bottom: 490 }
    expect(coverSide(docked, area)).toBeNull()
    expect(coverSide({ ...docked, left: area.right }, area)).toBeNull()
    expect(coverSide({ ...docked, left: area.right - 1 }, area)).toBe('right')
    // a step drawn in that sliver is in view
    expect(edgeCues([up(area.right - 0.2, 300)], area, [docked])).toEqual([])
  })
})

// The bottom card (the selected step's needs list) is fixed to the window's bottom, centred, and grows upward with its
// list: on a long one it is taller than the window. At 800 x 740 it spans x 120-680 when at its least width.
describe('the bottom card as a cover', () => {
  const win = { left: 0, top: 72, right: 800, bottom: 724 }
  const tall = { left: 120, top: -654, right: 680, bottom: 724, side: 'bottom' as const }

  it("keeps the free area above the bottom card while that leaves room for a top and a bottom pill, else reaches down to the card's bottom edge", () => {
    // a card 400 px tall: the area ends at its top, as the frame's does
    expect(cueAreaBottom(72, 308, 724)).toBe(308)
    expect(cueAreaBottom(72, 72 + CUE_ROOM, 724)).toBe(72 + CUE_ROOM)
    // too short to hold both pills, or above the top strip (a card taller than the window): the card is then a cover
    // over the area, not its edge
    expect(cueAreaBottom(72, 72 + CUE_ROOM - 1, 724)).toBe(724)
    expect(cueAreaBottom(72, -654, 724)).toBe(724)
  })

  it('counts a step under a cover anchored to an edge (the bottom card) past that edge, though the cover spans the whole height', () => {
    // geometry alone cannot say: clipped to the area, a card taller than it touches the top edge and the bottom one
    expect(coverSide(tall, win)).toBe('right')
    const cues = edgeCues([up(300, 400), up(500, 650), up(60, 650), up(780, 300)], win, [tall])
    expect(cues).toEqual([{ side: 'bottom', count: 2, kind: 'up', at: 400 }])
    // an anchored cover still needs to reach 1 px into the area: a short card just below its bottom edge is no cover
    const short = { left: 120, top: 500.4, right: 680, bottom: 724, side: 'bottom' as const }
    expect(edgeCues([up(300, 600)], { ...win, bottom: 500 }, [short])).toEqual([{ side: 'bottom', count: 1, kind: 'up', at: 300 }])
    expect(edgeCues([up(300, 499)], { ...win, bottom: 500 }, [short])).toEqual([])
  })

  it('moves the bottom pill off the card to the bottom band beside it, the nearer side', () => {
    const size = { w: 80, h: 18 }
    const bottom = { side: 'bottom' as const, count: 2, kind: 'up' as const, at: 420 }
    expect(placeCue(bottom, size, win, [], [tall])).toEqual({ ...bottom, at: tall.right + CUE_GAP + size.w / 2 })
    expect(placeCue({ ...bottom, at: 300 }, size, win, [], [tall])).toEqual({ ...bottom, at: tall.left - CUE_GAP - size.w / 2 })
  })

  it('puts the top pill just under a shallow cover beside the card when the card covers its line and the rest of the top band is chrome, else leaves it on its line', () => {
    const size = { w: 80, h: 18 }
    const top = { side: 'top' as const, count: 5, kind: 'down' as const, at: 300 }
    // the "Ready now" chip on the left of the top band and the side panel's folded header on the right
    const chip = { left: 16, top: 72, right: 136, bottom: 96 }
    const header = { left: 385, top: 66, right: 784, bottom: 108 }
    expect(placeCue(top, size, win, [], [tall, chip, header])).toEqual({ ...top, at: tall.left - CUE_GAP - size.w / 2, inset: chip.bottom - win.top + CUE_INSET })
    // a step there: just under the header on the right, beside the card, the next nearest
    const card = { left: 40, right: 110, top: 96, bottom: 140 }
    expect(placeCue(top, size, win, [card], [tall, chip, header])).toEqual({ ...top, at: tall.right + CUE_GAP + size.w / 2, inset: header.bottom - win.top + CUE_INSET })
    // a step on each side: nowhere in view is clear, and a pill over the card would hide what it lists, so the pill
    // stays on its line (under the card)
    const right = { left: 700, right: 790, top: 100, bottom: 140 }
    expect(placeCue(top, size, win, [card, right], [tall, chip, header])).toEqual(top)
  })
})

describe('cueSize', () => {
  it('grows with the count it says', () => {
    expect(cueSize(128).w).toBeGreaterThan(cueSize(3).w)
    expect(cueSize(3).h).toBe(cueSize(128).h)
  })
})

describe('placeCue', () => {
  const size = { w: 80, h: 18 }
  const top = { side: 'top' as const, count: 14, kind: 'down' as const, at: 300 }

  it('leaves a cue where it is while nothing drawn lies under it', () => {
    // a card well below the top band, and one in the band but far along it
    expect(placeCue(top, size, area, [{ left: 250, right: 420, top: 200, bottom: 244 }, { left: 500, right: 670, top: 72, bottom: 116 }])).toEqual(top)
  })

  it('slides a cue along its edge to the nearest place clear of every card in its band', () => {
    // a card whose circle sits just under the top edge, its title running right of the line
    const card = { left: 290, right: 460, top: 70, bottom: 114 }
    expect(placeCue(top, size, area, [card]).at).toBe(card.left - CUE_GAP - size.w / 2)
    // the nearer side wins: a card mostly left of the cue sends it right
    expect(placeCue(top, size, area, [{ left: 150, right: 320, top: 70, bottom: 114 }]).at).toBe(320 + CUE_GAP + size.w / 2)
  })

  it('finds the gap between two cards, and stays inside its edge', () => {
    const cards = [
      { left: 0, right: 290, top: 80, bottom: 120 },
      { left: 310 + size.w + 2 * CUE_GAP, right: 800, top: 80, bottom: 120 },
    ]
    expect(placeCue(top, size, area, cards).at).toBe(290 + CUE_GAP + size.w / 2)
    // no gap anywhere along the edge: it stays where it was
    expect(placeCue(top, size, area, [{ left: -10, right: 810, top: 72, bottom: 120 }])).toEqual(top)
    // the only gap is past the corner margin: it stays where it was
    expect(placeCue(top, size, area, [{ left: 20, right: 810, top: 72, bottom: 120 }])).toEqual(top)
  })

  it('reads the band of each edge: the bottom one above the card, the side ones across', () => {
    const bottom = { side: 'bottom' as const, count: 2, kind: 'up' as const, at: 300 }
    expect(placeCue(bottom, size, area, [{ left: 280, right: 450, top: 470, bottom: 510 }]).at).toBe(280 - CUE_GAP - size.w / 2)
    const left = { side: 'left' as const, count: 2, kind: 'up' as const, at: 300 }
    expect(placeCue(left, size, area, [{ left: 0, right: 170, top: 290, bottom: 334 }]).at).toBe(290 - CUE_GAP - size.h / 2)
    expect(placeCue(left, size, area, [{ left: 200, right: 370, top: 290, bottom: 334 }])).toEqual(left)
    const right = { side: 'right' as const, count: 2, kind: 'up' as const, at: 300 }
    expect(placeCue(right, size, area, [{ left: 700, right: 870, top: 280, bottom: 310 }]).at).toBe(310 + CUE_GAP + size.h / 2)
  })

  // At 800 px the side panel's folded header lies over the top of the free area, right of x 385.
  const header = { left: 385, top: 66, right: 784, bottom: 108 }

  it('moves a pill whose place on its line is under a cover to just inside that cover, on its line, where that is nearer than sliding along', () => {
    const cue = { ...top, at: 565 }
    // sliding left of the header would take it 200 px off its line; under the header's bottom edge it stays on it
    expect(placeCue(cue, size, area, [], [header])).toEqual({ ...cue, inset: header.bottom - area.top + CUE_INSET })
    // a cover is no card: as a card the header would send the pill along the edge
    expect(placeCue(cue, size, area, [header]).at).toBe(header.left - CUE_GAP - size.w / 2)
    // a card on its line just under the header: the pill slides along that band, clear of it and of the header
    const card = { left: 540, right: 640, top: 110, bottom: 140 }
    expect(placeCue(cue, size, area, [card], [header])).toEqual({ ...cue, at: card.left - CUE_GAP - size.w / 2, inset: header.bottom - area.top + CUE_INSET })
  })

  it('puts a pill whose whole band is under a cover (the open sheet at 800 px) just inside the cover, where it is seen', () => {
    // the sheet runs down the right of the free area, over the whole right band
    const sheet = { left: 384, top: 64, right: 784, bottom: 490 }
    const right = { side: 'right' as const, count: 3, kind: 'up' as const, at: 300 }
    const inset = area.right - sheet.left + CUE_INSET
    expect(placeCue(right, size, area, [], [sheet])).toEqual({ ...right, inset })
    // a card just left of the sheet on the pill's line: it slides up or down that band, clear of it
    const card = { left: 300, right: 380, top: 290, bottom: 320 }
    expect(placeCue(right, size, area, [card], [sheet])).toEqual({ ...right, at: card.top - CUE_GAP - size.h / 2, inset })
    // cards all along that band too: seen beats hidden, so it stays on its line inside the sheet's edge
    expect(placeCue(right, size, area, [{ left: 300, right: 380, top: 0, bottom: 600 }], [sheet])).toEqual({ ...right, inset })
  })

  it('slides a pill along its edge past a cover that is narrow along it and deep, and drops it under a shallow one', () => {
    const narrow = { left: 290, top: 60, right: 320, bottom: 260 }
    expect(placeCue(top, size, area, [], [narrow])).toEqual({ ...top, at: narrow.left - CUE_GAP - size.w / 2 })
    // the "Ready now" chip, 24 px deep: just under it the pill is on its line, nearer than 60 px along the edge
    const chip = { left: 16, top: 72, right: 136, bottom: 96 }
    expect(placeCue({ ...top, at: 120 }, size, area, [], [chip])).toEqual({ ...top, at: 120, inset: chip.bottom - area.top + CUE_INSET })
  })

  it('moves a pill in past every cover stacked on its line (at 390 px: the two-row toolbar, the "Ready now" chip under it, the panel header under that), where it is seen', () => {
    const phone = { left: 0, top: 72, right: 390, bottom: 656 }
    const toolbar = { left: 16, top: 16, right: 374, bottom: 114 }
    const chip = { left: 16, top: 122, right: 136, bottom: 148 }
    const panelHeader = { left: 23, top: 152, right: 374, bottom: 194 }
    // the hidden step's card, just under the toolbar, right of the chip: nothing is clear in the band under the toolbar
    const card = { left: 100, right: 390, top: 126, bottom: 170 }
    const cue = { side: 'top' as const, count: 1, kind: 'down' as const, at: 118 }
    const placed = placeCue(cue, { w: 73, h: 18 }, phone, [card], [toolbar, chip, panelHeader])
    expect(placed).toEqual({ ...cue, inset: panelHeader.bottom - phone.top + CUE_INSET })
    // so it lies under none of them
    const y = phone.top + placed.inset!
    for (const c of [toolbar, chip, panelHeader]) expect(y >= c.bottom || y + 18 <= c.top).toBe(true)
    // with no card there, just under the toolbar beside the chip is the nearer move: it stays at that depth
    expect(placeCue(cue, { w: 73, h: 18 }, phone, [], [toolbar, chip, panelHeader])).toEqual({
      ...cue,
      at: chip.right + CUE_GAP + 73 / 2,
      inset: toolbar.bottom - phone.top + CUE_INSET,
    })
  })
})

describe('placeCues', () => {
  // At 390x844 with a tall bottom card: the free area is the 122 px strip from the top inset down to the card, the
  // two-row toolbar, the "Ready now" chip and the panel's folded header lying over most of it; the selected step (its
  // circle, brackets and plate) sits just under the toolbar, right of the chip.
  const phone = { left: 0, top: 72, right: 390, bottom: 194 }
  const toolbar = { left: 16, top: 16, right: 374, bottom: 114 }
  const chip = { left: 16, top: 122, right: 143, bottom: 148 }
  const panelHeader = { left: 23, top: 152, right: 374, bottom: 194 }
  const covers = [toolbar, chip, panelHeader]
  const selected = { left: 131, top: 97, right: 212, bottom: 141 }
  const above = { side: 'top' as const, count: 2, kind: 'up' as const, at: 175 }
  const below = { side: 'bottom' as const, count: 24, kind: 'down' as const, at: 175 }
  const crosses = (a: { left: number; top: number; right: number; bottom: number }, b: typeof a) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

  it('keeps two pills that meet in one strip off each other, the selected step and the chrome', () => {
    const placed = placeCues([above, below], phone, [selected], covers, [selected])
    const pills = placed.map(c => cueBox(c, phone))
    expect(crosses(pills[0], pills[1]), `${JSON.stringify(pills)}`).toBe(false)
    for (const p of pills) {
      expect(crosses(p, selected), `${JSON.stringify(p)} on the selected step`).toBe(false)
      for (const c of covers) expect(crosses(p, c), `${JSON.stringify(p)} under ${JSON.stringify(c)}`).toBe(false)
      expect(p.left >= phone.left && p.right <= phone.right && p.top >= phone.top && p.bottom <= phone.bottom).toBe(true)
    }
  })

  it('places each cue as placeCue does when nothing else is placed with it', () => {
    expect(placeCues([above], phone, [selected], covers, [selected])).toEqual([placeCue(above, cueSize(2), phone, [selected], covers)])
  })

  it('never puts a pill on the selected step, even where steps fill its whole band', () => {
    // a neighbour's card fills the rest of the strip right of the selected step: no place in the band is clear of every
    // card, so the pill crosses a card, but never the selected step's
    const neighbour = { left: 212, right: 390, top: 120, bottom: 150 }
    const [placed] = placeCues([below], phone, [selected, neighbour], covers, [selected])
    const p = cueBox(placed, phone)
    expect(crosses(p, selected), JSON.stringify(p)).toBe(false)
    for (const c of covers) expect(crosses(p, c), `${JSON.stringify(p)} under ${JSON.stringify(c)}`).toBe(false)
  })

  it('leaves out a pill that has no place off the selected step and the pills before it, rather than lay it on them', () => {
    // As measured live at 390x844 (UX pass c): the bottom card's top leaves the free area an 80 px strip from the top
    // inset, the two-row toolbar takes its upper 42 px, and in the 38 px left the "Ready now" chip and the selected
    // step (its circle at x 171-181, its title to x 330) fill the width: no place is clear for either pill.
    const strip = { left: 0, top: 72, right: 390, bottom: 152 }
    const hud = { left: 16, top: 152, right: 374, bottom: 828, side: 'bottom' as const }
    const live = [toolbar, chip, hud]
    const step = { left: 164, top: 112, right: 330, bottom: 150 }
    const one = { side: 'top' as const, count: 1, kind: 'down' as const, at: 176 }
    const many = { side: 'bottom' as const, count: 36, kind: 'up' as const, at: 195 }
    const placed = placeCues([one, many], strip, [step], live, [step])
    const pills = placed.map(c => cueBox(c, strip))
    for (const [i, p] of pills.entries()) {
      expect(crosses(p, step), `${JSON.stringify(p)} on the selected step`).toBe(false)
      for (const q of pills.slice(0, i)) expect(crosses(p, q), `${JSON.stringify(pills)} on each other`).toBe(false)
    }
    expect(placed).toEqual([])
  })

  it('leaves out a pill whose only place left is under the chrome (the two-row toolbar at 390 px), where it cannot be seen', () => {
    // As measured live at 390x844 (UX pass e, Group off, the step "think with claude"): the free area is the strip from
    // the top inset down to the bottom card (its top as in pass c), the selected step sits right of the "Ready now" chip
    // under the toolbar. The top pill goes just under the toolbar beside the chip; the bottom pill's line is under the
    // chip, nothing in its band is clear, and just above the chip (y 98-116) is under the toolbar: it was drawn there.
    const strip = { left: 0, top: 72, right: 390, bottom: 152 }
    const hud = { left: 16, top: 152, right: 374, bottom: 828, side: 'bottom' as const }
    const live = [toolbar, chip, hud]
    const step = { left: 289, top: 119, right: 366, bottom: 138 }
    const one = { side: 'top' as const, count: 1, kind: 'up' as const, at: 176 }
    const many = { side: 'bottom' as const, count: 23, kind: 'down' as const, at: 48 }
    const placed = placeCues([one, many], strip, [step], live, [step])
    for (const p of placed.map(c => cueBox(c, strip))) for (const c of live) expect(crosses(p, c), `${JSON.stringify(p)} under ${JSON.stringify(c)}`).toBe(false)
    // the top pill, clear of all, still shows
    expect(placed.map(c => c.side)).toEqual(['top'])
  })

  it('leaves out a pill when the bottom card covers the whole window and the toolbar the rest of its band', () => {
    // As measured live at 390x844 (UX pass e, the step "see the plan"): the bottom card runs from far above the window
    // to its bottom, the selected step is framed far above; the top pill's band is under the toolbar and the card.
    const win = { left: 0, top: 72, right: 390, bottom: 828 }
    const hud = { left: 16, top: -3570, right: 374, bottom: 828, side: 'bottom' as const }
    const live = [toolbar, chip, hud]
    const step = { left: 165, top: -1779, right: 242, bottom: -1759 }
    const top = { side: 'top' as const, count: 138, kind: 'up' as const, at: 168 }
    expect(placeCues([top], win, [step], live, [step])).toEqual([])
  })
})

describe('card boxes', () => {
  const at = { id: 'a', x: 100, y: 200, k: 2 }

  it('takes a card not yet measured as its whole slot and the words past it, at its size on screen', () => {
    expect(CARD_ESTIMATE).toEqual({ left: -85, right: 105, top: -22, bottom: 22 })
    expect(cardBox(at)).toEqual({ left: 100 - 170, right: 100 + 210, top: 200 - 44, bottom: 200 + 44 })
  })

  it('measures a card as what it draws (its circle and words), in card px from its slot centre, so the box holds as the view pans and zooms', () => {
    // its circle (22 card px across, 18 in from the slot's left) and a short title beside it
    const drawn = [
      { left: 100 - 156, right: 100 - 112, top: 200 - 22, bottom: 200 + 22 },
      { left: 100 - 90, right: 100 + 40, top: 190, bottom: 210 },
    ]
    const e = extentOf(drawn, at)!
    expect(e).toEqual({ left: -78, right: 20, top: -11, bottom: 11 })
    // the same card panned and zoomed out: its box follows
    expect(cardBox({ id: 'a', x: 300, y: 50, k: 1 }, e)).toEqual({ left: 222, right: 320, top: 39, bottom: 61 })
    // nothing drawn (hidden): no measure
    expect(extentOf([], at)).toBeNull()
    expect(extentOf([{ left: 5, right: 5, top: 1, bottom: 9 }], at)).toBeNull()
  })

  it('drops the measures of steps no longer drawn (deleted, or folded into a deck)', () => {
    const e = { left: -10, right: 10, top: -10, bottom: 10 }
    const extents = new Map([['a', e], ['b', e], ['c', e]])
    dropGone(extents, [{ id: 'a', x: 0, y: 0, k: 1 }, { id: 'c', x: 0, y: 0, k: 1 }])
    expect([...extents.keys()]).toEqual(['a', 'c'])
  })
})
