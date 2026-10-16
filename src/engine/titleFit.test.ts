import { describe, expect, it } from 'vitest'
import { FIT, fitTitles, rankOf, type FitInput, type FitOut } from './titleFit.js'

const box = (left: number, top: number, w: number, h: number) => ({ left, top, right: left + w, bottom: top + h })

/**
 * A label as drawn: a 10px circle at (x, y) (its centre), the words 12px right of it, `lines` title lines of 12px
 * and `w` wide, centred on the circle, with a 10px due line under them when `due`.
 */
function label(id: string, x: number, y: number, opts: { w?: number; lines?: number; due?: number; tier?: number; order?: number; font?: number; prev?: FitInput['prev'] } = {}): FitInput {
  const { w = 80, lines = 1, due, tier = 8, order = 0, font = 10, prev } = opts
  const textH = lines * 12 + (due ? 10 : 0)
  const top = y - textH / 2
  return {
    id,
    rank: { tier, order },
    dot: box(x - 5, y - 5, 10, 10),
    title: box(x + 12, top, w, lines * 12),
    due: due ? box(x + 12, top + lines * 12, due, 10) : undefined,
    line: 12,
    maxWidth: 100,
    font,
    prev,
  }
}

/** The labels with `out` as what the last run drew (as the graph reads it back from the page). */
const fedBack = (labels: FitInput[], out: Map<string, FitOut>): FitInput[] =>
  labels.map(l => {
    const f = out.get(l.id)!
    return { ...l, prev: f.fit, prevCut: f.fit === 'short' ? { lines: f.lines!, dy: f.dy!, width: f.width } : undefined }
  })

/** Where a label's words draw for its fit: in full its title and due line; cut, from the words' left, its width and lines, moved by dy. */
function drawnWords(l: FitInput, f: FitOut) {
  if (f.fit === 'dot') return []
  if (f.fit === 'full') return l.due ? [l.title, l.due] : [l.title]
  const blockBottom = l.due ? Math.max(l.title.bottom, l.due.bottom) : l.title.bottom
  const cy = (l.title.top + blockBottom) / 2 + (f.dy ?? 0)
  const h = (f.lines ?? 1) * l.line
  return [{ left: l.title.left, top: cy - h / 2, right: l.title.left + f.width!, bottom: cy + h / 2 }]
}

const fits = (labels: FitInput[]) => Object.fromEntries([...fitTitles(labels)].map(([id, f]) => [id, f.fit]))

describe('fitTitles', () => {
  it('shows a lone title in full', () => {
    expect(fits([label('a', 0, 0)])).toEqual({ a: 'full' })
  })

  it('shows titles that keep clear of each other in full', () => {
    expect(fits([label('a', 0, 0), label('b', 0, 40), label('c', 200, 0)])).toEqual({ a: 'full', b: 'full', c: 'full' })
  })

  it('shortens a title to the room before the next circle, on one line', () => {
    // b's circle sits 60px right of a's: a's 80px title would run over it
    const out = fitTitles([label('a', 0, 0, { tier: 3 }), label('b', 60, 0)])
    expect(out.get('a')!.fit).toBe('short')
    // from a's text (x 12) to b's circle (x 55), less the gap
    expect(out.get('a')!.width).toBeCloseTo(55 - 12 - FIT.gap)
    expect(out.get('b')!.fit).toBe('full')
  })

  it('keeps a cut title shown last run at its width when the next circle starts within the gap past it: its slack stands', () => {
    // a's 28px words end at x 40, b's circle starts at 41; a was cut on one line last run. Held to the gap before the
    // circle the room would be 27 px, under the five letters a line must hold (27.5), and the title would be hidden.
    const a = { ...label('a', 0, 0, { w: 28, tier: 3, prev: 'short' }), prevCut: { lines: 1, dy: 0 } }
    expect(fitTitles([a, label('b', 46, 0)]).get('a')).toEqual({ fit: 'short', width: 28, lines: 1, dy: 0 })
  })

  it('cuts a title whose words end within the gap of the next circle, rather than hide it', () => {
    // a's 80px title ends at x 92; b's circle starts `e` px past that, from 3 px over it to 4 px clear. Within the gap
    // (0 <= e < 2) the words are cut, not hidden: no step of a few px hides them (the frameDue fixture's identical block
    // columns at 1280, one cut and one hidden, a circle 0.8 px past their end). First cut the gap before the circle, then,
    // shown, they keep the slack a shown cut has, so they settle at their own width; over the circle, at the room before it.
    for (let e = -3; e <= 4; e += 0.25) {
      const out = fitTitles([label('a', 0, 0, { tier: 3 }), label('b', 97 + e, 0)]).get('a')!
      if (e >= FIT.gap) expect(out, `e ${e}`).toEqual({ fit: 'full' })
      else {
        expect(out.fit, `e ${e}`).toBe('short')
        expect(out.width, `e ${e}`).toBeCloseTo(e < 0 ? 92 + e - FIT.gap - 12 : 80)
      }
    }
  })

  it("ends a title before a lane that runs past its row (its wall), and keeps a title that ends short of it whole", () => {
    // a lane 70px right of a's circle: a's 80px words (from x 12) would cross it
    const out = fitTitles([{ ...label('a', 0, 0), wall: 70 }])
    expect(out.get('a')!.fit).toBe('short')
    expect(out.get('a')!.width).toBeCloseTo(70 - FIT.lane - 12 - FIT.gap)
    // a lane past the words' end leaves them whole
    expect(fitTitles([{ ...label('a', 0, 0), wall: 100 }]).get('a')!.fit).toBe('full')
    // the lane is in the row for every label there: b, a little lower and with no wall of its own, ends before it too
    const both = fitTitles([{ ...label('a', 200, 0, { w: 10 }), wall: 280 }, label('b', 220, 10)])
    expect(both.get('b')!.fit).toBe('short')
    expect(both.get('b')!.width).toBeCloseTo(280 - FIT.lane - 232 - FIT.gap)
  })

  it('keeps a title clear of a lane only where the lane is drawn (its span), not over the whole of the row it runs past', () => {
    // b, a row 14px under a, has a lane 60px right of a's circle; a's words (x 12 to 92, y -6 to 6) would cross its x.
    // Drawn from 11px down (the top of its run, half a card past it), the line ends 5px under a's words: a stays whole.
    const a = label('a', 0, 0, { tier: 3 })
    const b = { ...label('b', 0, 14, { w: 10 }), wall: 60 }
    expect(fitTitles([a, { ...b, wallSpan: { top: 11, bottom: 80 } }]).get('a')!.fit).toBe('full')
    // drawn up past a's words, it cuts them before it, as before
    const cut = fitTitles([a, { ...b, wallSpan: { top: -20, bottom: 80 } }]).get('a')!
    expect(cut.fit).toBe('short')
    expect(cut.width).toBeCloseTo(60 - FIT.lane - 12 - FIT.gap)
    // and where the page does not say how far it is drawn, it is taken as b's row, a line past either side
    expect(fitTitles([a, b]).get('a')!.fit).toBe('short')
  })

  it('keeps every title clear of a lane by the gap, shown before or not: no slack against a lane', () => {
    // a lane 9px right of a's circle, between it and its words (12px right): its box (wall ± lane) ends 1px short of
    // them. Shown or not last run, the words are not drawn so near the line (the slack is for titles and circles, which
    // a hair's overlap leaves legible; a line through the words' first letter does not).
    for (const prev of [undefined, 'full', 'short'] as const) {
      const a = { ...label('a', 0, 0, { prev }), wall: 9, prevCut: prev === 'short' ? { lines: 1, dy: 0 } : undefined }
      expect(fitTitles([a]).get('a')!.fit, `${prev}`).toBe('dot')
    }
    // and a cut ends the gap short of a lane further right, shown before or not
    for (const prev of [undefined, 'full', 'short'] as const) {
      const a = { ...label('a', 0, 0, { prev }), wall: 70, prevCut: prev === 'short' ? { lines: 1, dy: 0 } : undefined }
      const out = fitTitles([a]).get('a')!
      expect(out.fit, `${prev}`).toBe('short')
      expect(out.width!, `${prev}`).toBeLessThanOrEqual(70 - FIT.lane - 12 - FIT.gap + 1e-9)
    }
  })

  it("keeps a due-soon step's words clear of a lane that runs close past its large circle", () => {
    // a 16px circle (due soon, past the card floor) whose words start 3.5px past its edge; a lane whose box (wall ±
    // lane) ends 1px before the words, its line only a px or two right of the circle: the words never draw that close
    const big = { ...label('a', 0, 0), dot: box(-8, -8, 16, 16), title: box(11.5, -6, 80, 12) }
    for (const prev of [undefined, 'full'] as const) {
      const out = fitTitles([{ ...big, prev, wall: 11.5 - 1 - FIT.lane }]).get('a')!
      expect(out.fit, `${prev}`).not.toBe('full')
    }
  })

  it('cuts a wrapped title to one line, the width of the text block at most', () => {
    // three lines: the one-line version would be wider than the block, so it is cut to the block
    const out = fitTitles([label('a', 0, 0, { lines: 3, tier: 3 }), label('b', 0, 24, { tier: 1 })])
    expect(out.get('a')!.fit).toBe('short')
    expect(out.get('a')!.width).toBe(100)
  })

  it('lets a cut title take two lines when the room under its first line is free', () => {
    // a's three-line title meets b's circle 70px right: cut to the room before it, on two lines
    const out = fitTitles([label('a', 0, 0, { lines: 3, tier: 3 }), label('b', 70, 0)])
    expect(out.get('a')).toMatchObject({ fit: 'short', lines: 2, dy: 0 })
    expect(out.get('a')!.width).toBeCloseTo(65 - 12 - FIT.gap)
  })

  it('keeps a cut title to one line when a second line would meet a circle above or below', () => {
    // c's and e's circles sit just under and over where two lines would draw, centred or moved
    const out = fitTitles([label('a', 0, 0, { lines: 3, tier: 3 }), label('b', 70, 0), label('c', 30, 15), label('e', 30, -15)])
    expect(out.get('a')).toMatchObject({ fit: 'short', lines: 1, dy: 0 })
  })

  it('moves a cut title up beside its circle when the row under it is close, rather than hide it', () => {
    // a's line, centred on its circle, would come within the gap of c's circle below; moved up by half the circle
    // (5px), it clears it
    const out = fitTitles([label('a', 0, 0, { tier: 3 }), label('c', 40, 12)])
    expect(out.get('a')).toMatchObject({ fit: 'short', lines: 1, dy: -5 })
  })

  it('cuts a title before a circle within the gap over or under its words, rather than hide it, when no try clears as it stands', () => {
    // c's circle sits 1px under a's centred line, from x 55; u's and w's circles sit where a's words would start moved
    // up or down. No try clears as it stands (centred, c is within the gap; moved, the words would start on a circle):
    // centred, the words are cut before c instead
    const out = fitTitles([label('a', 0, 0, { tier: 3 }), label('c', 60, 12), label('u', 15, -15), label('w', 15, 15)])
    expect(out.get('a')).toMatchObject({ fit: 'short', lines: 1, dy: 0 })
    expect(out.get('a')!.width).toBeCloseTo(55 - FIT.gap - 12)
    // where a try clears as it stands, it is taken as before: moved up beside its circle, uncut
    expect(fitTitles([label('a', 0, 0, { tier: 3 }), label('c', 60, 12)]).get('a')).toEqual({ fit: 'short', width: 80, lines: 1, dy: -5 })
  })

  it('cuts a title before a lane within the gap under its words, and keeps that cut once shown: no slack against a lane', () => {
    // b's lane, 50px right of a's circle, is drawn from 1px under a's centred line; u's and w's circles sit where a's
    // words would start moved up or down. Cut before the lane, centred; fed back as drawn, the cut stays as it is (the
    // slack a shown cut has is not for a lane, so it does not grow over it and then fail to clear it)
    const ls = [label('a', 0, 0, { tier: 3 }), { ...label('b', -60, 30, { w: 10 }), wall: 50, wallSpan: { top: 7, bottom: 60 } }, label('u', 15, -15), label('w', 15, 15)]
    const once = fitTitles(ls)
    expect(once.get('a')).toMatchObject({ fit: 'short', lines: 1, dy: 0 })
    expect(once.get('a')!.width).toBeCloseTo(50 - FIT.lane - FIT.gap - 12)
    expect(fitTitles(fedBack(ls, once))).toEqual(once)
  })

  it("draws a top row's cut title a line higher when no try beside its circle clears, and hides any other's", () => {
    // a lane drawn up to a's circle's middle, 4px right of where its words start, cuts every try beside the circle (the
    // words would start on it); a line higher (y -18 to -6) the words clear it. Only a step in the plan's top rows (a
    // goal or one of its own needs: rank.top) is drawn there, a line over its circle.
    const lane = { ...label('b', -60, 30, { w: 10 }), wall: 16, wallSpan: { top: 0, bottom: 60 } }
    const top = { ...label('a', 0, 0), rank: { tier: 6, order: 0, top: true } }
    const out = fitTitles([top, lane])
    expect(out.get('a')).toEqual({ fit: 'short', width: 80, lines: 1, dy: -12 })
    expect(fitTitles(fedBack([top, lane], out))).toEqual(out)
    expect(fitTitles([label('a', 0, 0, { tier: 6 }), lane]).get('a')).toEqual({ fit: 'dot' })
  })

  describe("a top row's words and the goal's arrows to its own needs (overhead)", () => {
    const top = (opts: Parameters<typeof label>[3] = {}) => ({ ...label('a', 0, 0, opts), rank: { tier: 6, order: 0, top: true } })

    it('draws the words in full where the arrows run clear of them', () => {
      expect(fitTitles([{ ...top(), overhead: [box(-100, -30, 400, 2)] }]).get('a')).toEqual({ fit: 'full' })
    })

    it('cuts the words before an arrow rising to their right', () => {
      // an arrow climbs at x 60 past a's words (x 12 to 92): cut there, the gap before it, centred
      const out = fitTitles([{ ...top(), overhead: [box(60, -20, 2, 40)] }])
      expect(out.get('a')).toMatchObject({ fit: 'short', lines: 1, dy: 0 })
      expect(out.get('a')!.width).toBeCloseTo(60 - FIT.gap - 12)
    })

    it('draws the words just under the arrows on its circle\'s side when no try beside its circle or a line up clears them', () => {
      // the arrows run flat across at y -4 to -2, just over a's circle (y -5 to 5): every try beside the circle meets
      // them, and b's circle (x 35 to 45, y -19 to -9) leaves no room a line up; just under them (y 0 to 12, the gap
      // clear) the words draw whole, cut to their own width
      const ls = [{ ...top(), overhead: [box(-100, -4, 400, 2)] }, label('b', 40, -14)]
      const out = fitTitles(ls)
      expect(out.get('a')).toMatchObject({ fit: 'short', lines: 1, width: 80 })
      expect(out.get('a')!.dy).toBeCloseTo(-2 + FIT.gap + 6)
      expect(fitTitles(fedBack(ls, out))).toEqual(out)
      // any other step's words mind no such arrows: a lone label crossed by them is drawn in full
      expect(fitTitles([{ ...label('a', 0, 0), overhead: [box(-100, -4, 400, 2)] }]).get('a')).toEqual({ fit: 'full' })
    })

    it('draws the words just over the arrows when under them has no room either', () => {
      // the arrows at y -8 to -6; c's circle (x 35 to 45, y 5 to 15) leaves no room beside a's circle moved down or
      // just under the arrows (y -4 to 8): just over them (y -22 to -10) the words draw whole
      const ls = [{ ...top(), overhead: [box(-100, -8, 400, 2)] }, label('c', 40, 10)]
      const out = fitTitles(ls)
      expect(out.get('a')).toMatchObject({ fit: 'short', lines: 1, width: 80 })
      expect(out.get('a')!.dy).toBeCloseTo(-8 - FIT.gap - 6)
      expect(fitTitles(fedBack(ls, out))).toEqual(out)
    })

    it('draws the words no farther than two lines from where they draw in full: past that, the circle alone', () => {
      // as above with a second run of arrows a line higher (y -20 to -18): just over them all the words would draw
      // 28px up, more than two lines, so only the circle is drawn
      const ls = [{ ...top(), overhead: [box(-100, -8, 400, 2), box(-100, -20, 400, 2)] }, label('c', 40, 10)]
      expect(fitTitles(ls).get('a')).toEqual({ fit: 'dot' })
    })

    it('ends the words moved off their row before the next circle in that row, so its words keep room to move up too', () => {
      // as when drawn a line higher above, with c's circle 60px right of a's in its row (x 55 to 65, y -3 to 7): a's
      // words a line up (y -18 to -6) pass clear over c's circle but end before it, the gap short of it
      const lane = { ...label('b', -60, 30, { w: 10 }), wall: 16, wallSpan: { top: 0, bottom: 60 } }
      const ls = [top(), lane, label('c', 60, 2)]
      const out = fitTitles(ls)
      expect(out.get('a')).toMatchObject({ fit: 'short', lines: 1, dy: -12 })
      expect(out.get('a')!.width).toBeCloseTo(55 - FIT.gap - 12)
      expect(fitTitles(fedBack(ls, out))).toEqual(out)
    })

    it("draws a goal's two lines whole over the arrows that run through them, on its circle's side", () => {
      // the goal's two lines (y -12 to 12) are crossed by its arrows flat across at y 8 to 10, under its circle: just
      // over them (y -18 to 6) both lines draw whole, at the words' full width
      const goal = { ...label('g', 0, 0, { lines: 2, tier: 3 }), rank: { tier: 3, order: 0, top: true }, overhead: [box(-5, 8, 400, 2)] }
      const out = fitTitles([goal])
      expect(out.get('g')).toMatchObject({ fit: 'short', lines: 2, width: 100 })
      expect(out.get('g')!.dy).toBeCloseTo(8 - FIT.gap - 12)
    })
  })

  it('leaves the due line out of a cut title', () => {
    // with its due line a's words would reach c's circle below; cut, the title alone keeps clear
    const out = fitTitles([label('a', 0, 0, { due: 40, tier: 3 }), label('b', 70, 0), label('c', 40, 14)])
    expect(out.get('a')).toMatchObject({ fit: 'short', lines: 1, dy: 0 })
  })

  it('keeps clear of what is drawn around another step\'s circle (its overdue ring or chain outline)', () => {
    // b's circle is 100px right; its ring reaches 9px past it, over the end of a's 80px title
    const out = fitTitles([label('a', 0, 0, { tier: 3 }), { ...label('b', 100, 0), ring: 9 }])
    expect(out.get('a')!.fit).toBe('short')
    expect(out.get('a')!.width).toBeCloseTo(95 - 9 - 12 - FIT.gap)
  })

  it('gives the same answer when its answer is fed back as the last one, on random boxes', () => {
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let run = 0; run < 30; run++) {
      const labels: FitInput[] = []
      for (let i = 0; i < 40; i++)
        labels.push(label(`n${i}`, rnd() * 400, rnd() * 200, { order: i, tier: Math.floor(rnd() * 9), lines: 1 + Math.floor(rnd() * 3), due: rnd() < 0.4 ? 40 : undefined, font: 8.5 + rnd() * 2 }))
      const once = fitTitles(labels)
      expect(fitTitles(fedBack(labels, once))).toEqual(once)
    }
  })

  it('is settled on a chain where one label growing back gives the next more room: fed back, nothing changes', () => {
    // c was hidden: its first cut is decided strictly (31px), and once drawn cut it keeps its line while it overlaps by
    // a hair, which gives it more room (80px) on the next run. Two passes alone stopped before that.
    const ls: FitInput[] = [label('a', 114, 5, { order: 0, prev: 'full' }), label('b', 8, 29, { order: 1 }), label('c', 64, 20, { order: 2, prev: 'dot' })]
    const once = fitTitles(ls)
    expect(fitTitles(fedBack(ls, once))).toEqual(once)
    expect(fitTitles(fedBack(ls, fitTitles(fedBack(ls, once))))).toEqual(once)
  })

  it('counts the priority mark before the words: a cut line must hold a few letters besides it', () => {
    // b's circle 50px right: 33px of room holds FIT.minChars letters at 10px (27.5px), but not with a 10px mark
    expect(fits([label('a', 0, 0, { tier: 3 }), label('b', 50, 0)]).a).toBe('short')
    expect(fits([{ ...label('a', 0, 0, { tier: 3 }), mark: 10 }, label('b', 50, 0)]).a).toBe('dot')
  })

  it('hides the title when the room left would not hold a few letters', () => {
    // b's circle 30px right: 13px of room, less than FIT.minChars letters at 10px
    expect(fits([label('a', 0, 0, { tier: 3 }), label('b', 30, 0)]).a).toBe('dot')
  })

  it('never hides a higher-ranked title to make room for a lower one, whatever their plan order', () => {
    // a and b cross each other's words; b ranks higher (due soon), though a comes first in the plan
    const a = label('a', 0, 0, { tier: 6, order: 0 })
    const b = label('b', 20, 6, { tier: 3, order: 1 })
    expect(fits([a, b])).toEqual({ a: 'dot', b: 'full' })
  })

  it('takes the plan order on a tie, then the id, whatever order the labels come in', () => {
    const a = label('a', 0, 0, { order: 1 })
    const b = label('b', 20, 6, { order: 0 })
    expect(fits([a, b])).toEqual({ a: 'dot', b: 'full' })
    expect(fits([b, a])).toEqual({ a: 'dot', b: 'full' })
    const c = label('c', 20, 6, { order: 0 })
    const d = label('d', 0, 0, { order: 0 })
    expect(fits([d, c])).toEqual(fits([c, d]))
    expect(fits([d, c]).c).toBe('full')
  })

  it('never draws a title over another step\'s circle or due line', () => {
    // a's words run over b's due line; b ranks higher
    const b = label('b', 0, 20, { due: 60, tier: 1 })
    const a = label('a', 0, 30, { tier: 6 })
    const out = fits([a, b])
    expect(out.b).toBe('full')
    expect(out.a).toBe('dot')
  })

  it('hides a title drawn under the legibility floor, except for the selected step, its chain and the focused step', () => {
    const small = FIT.floor - 1
    expect(fits([label('a', 0, 0, { font: small })]).a).toBe('dot')
    expect(fits([label('a', 0, 0, { font: small, tier: 0 })]).a).toBe('full')
    expect(fits([label('a', 0, 0, { font: small, tier: 1 })]).a).toBe('full')
    expect(fits([label('a', 0, 0, { font: small, tier: 2 })]).a).toBe('full')
    expect(fits([label('a', 0, 0, { font: small, tier: 3 })]).a).toBe('dot')
  })

  it('always shows the selected title in full, even over a circle, at the size it draws', () => {
    expect(fitTitles([label('a', 0, 0, { tier: 0 }), label('b', 40, 0, { tier: 1 })]).get('a')).toEqual({ fit: 'full' })
  })

  it('places the selected title first: everyone else keeps clear of it, whatever the plan order', () => {
    // b's words would run under a's (selected) words; b comes first in the plan and is on the chain
    const a = label('a', 0, 0, { tier: 0, order: 5 })
    const b = label('b', 20, 4, { tier: 1, order: 0 })
    expect(fits([b, a])).toEqual({ a: 'full', b: 'dot' })
  })

  describe("the selected step's plate", () => {
    // The selected step as the graph measures it: its circle with the brackets around it (a 44px square on the circle)
    // and its plate (the words on their dark backing, 20px tall, 120px wide, right of the brackets), larger than the
    // title the rest of the steps draw at this zoom.
    const plate = (over: Partial<FitInput> = {}): FitInput => ({
      ...label('s', 0, 0, { tier: 0 }),
      dot: box(-22, -22, 44, 44),
      title: box(25, -10, 120, 20),
      font: 12,
      line: 14,
      ...over,
    })
    const near = (id: string, x: number, y: number, opts: Parameters<typeof label>[3] = {}) => label(id, x, y, { tier: 1, ...opts })
    const crosses = (a: { left: number; top: number; right: number; bottom: number }, b: typeof a) =>
      a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

    it('is always shown whole, never cut, even where it crosses other circles, titles placed in plan order before it, and the floor', () => {
      const s = plate({ font: FIT.floor - 2, prev: 'dot' })
      // a circle under the plate, and a chain step earlier in the plan whose words sit where the plate is
      const out = fitTitles([near('a', 60, 0, { order: 0, prev: 'full' }), near('b', 40, -14, { order: 1 }), { ...s, rank: { tier: 0, order: 9 } }])
      expect(out.get('s')).toEqual({ fit: 'full' })
      // whatever it was last run
      expect(fitTitles([{ ...s, prev: 'short', prevCut: { lines: 1, dy: 0 } }, near('a', 60, 0)]).get('s')).toEqual({ fit: 'full' })
    })

    it('no other title draws over the plate or the brackets: one that would is cut before it or left out', () => {
      // a: left of the plate, its words run into it; b: above the brackets, its words run across them; c: under the
      // plate's right half, its words would cross it entirely; d: well clear below, untouched
      const s = plate()
      const ls = [near('a', -70, 0, { w: 110 }), near('b', -40, -20, { w: 90 }), near('c', 60, 8, { w: 80 }), near('d', 0, 60)]
      const out = fitTitles([s, ...ls])
      expect(out.get('a')!.fit).toBe('short')
      expect(out.get('d')!.fit).toBe('full')
      for (const l of ls) {
        const [at] = drawnWords(l, out.get(l.id)!)
        if (!at) continue
        expect(crosses(at, s.title), `${l.id} over the plate`).toBe(false)
        expect(crosses(at, s.dot), `${l.id} over the brackets`).toBe(false)
      }
      // the cut one stops before the brackets, which reach further left than the plate
      expect(out.get('a')!.width).toBeLessThanOrEqual(s.dot.left - ls[0].title.left - FIT.gap)
      expect(out.get('c')!.fit).not.toBe('full')
    })

    it('holds a neighbour cut or hidden as long as the plate is there, and lets it back when the plate goes', () => {
      const s = plate()
      // its 50px words end 8px left of the circle: clear of a plain one, across the brackets
      const a = near('a', -70, 0, { w: 50 })
      const first = fitTitles([s, a])
      expect(first.get('a')!.fit).not.toBe('full')
      const again = fitTitles(fedBack([s, a], first))
      expect(again.get('a')).toEqual(first.get('a'))
      // deselected: a plain step there, its 10px circle and words to its right
      expect(fitTitles(fedBack([label('s', 0, 0), a], again)).get('a')!.fit).toBe('full')
    })
  })

  describe('hysteresis', () => {
    // b's circle starts at x 95: a's 80px title (x 12 to 92) clears it by 3px, so a fresh label (needing FIT.gap more) fits
    it('a shown title stays shown until it overlaps by more than a few px', () => {
      // b 4px further left: a's words cross b's circle by 1px
      const a = label('a', 0, 0, { tier: 3, prev: 'full' })
      expect(fits([a, label('b', 96, 0)]).a).toBe('full')
      // a shortened one grows back to full only once that clearly fits
      expect(fits([{ ...a, prev: 'short' }, label('b', 96, 0)]).a).toBe('short')
      // ...and by more than FIT.slack it gives way
      expect(fits([a, label('b', 92 - FIT.slack, 0)]).a).toBe('short')
    })

    it('a hidden title stays hidden until it clearly fits', () => {
      // a's words end at 92, b's circle starts at 93: clear by 1px, less than FIT.gap
      const a = label('a', 0, 0, { tier: 3, prev: 'dot' })
      expect(fits([a, label('b', 98, 0)]).a).not.toBe('full')
      expect(fits([a, label('b', 120, 0)]).a).toBe('full')
    })

    it('a fresh cut clears what reaches its band by a hair, settled and fed back: the slack keeps a cut shown, it never widens it', () => {
      // b's circle (60..70 across, 5..15 down) reaches 1px into a's line (-6..6): a's words are cut before it
      const labels = [label('a', 0, 0, { tier: 3 }), label('b', 65, 10)]
      const out = fitTitles(labels)
      expect(out.get('a')).toMatchObject({ fit: 'short', lines: 1 })
      expect(out.get('a')!.width).toBeCloseTo(60 - 12 - FIT.gap)
      // drawn so, the next run keeps that cut as it is
      const again = fitTitles(fedBack(labels, out)).get('a')!
      expect(again).toMatchObject({ fit: 'short', lines: 1 })
      expect(again.width).toBeCloseTo(60 - 12 - FIT.gap)
    })

    it('a title under the floor by a hair stays as it was', () => {
      const font = FIT.floor - FIT.floorSlack / 2
      expect(fits([label('a', 0, 0, { font, prev: 'full' })]).a).toBe('full')
      expect(fits([label('a', 0, 0, { font, prev: 'dot' })]).a).toBe('dot')
    })
  })

  it('decides 300 labels in a few ms, and nothing it draws overlaps', () => {
    // a crowded grid: 20 columns 60px apart (titles 80px wide cross the next circle), 15 rows 14px apart
    const labels: FitInput[] = []
    for (let i = 0; i < 300; i++) labels.push(label(`n${i}`, (i % 20) * 60, Math.floor(i / 20) * 14, { order: i, tier: i % 7, lines: 1 + (i % 2), due: i % 3 ? 50 : undefined }))
    fitTitles(labels)
    // the fastest of several timed batches: a busy machine (the whole suite runs in parallel) only slows batches down,
    // so the fastest is the closest to what the rule costs
    const batches: number[] = []
    for (let b = 0; b < 9; b++) {
      const t0 = performance.now()
      for (let r = 0; r < 5; r++) fitTitles(labels)
      batches.push((performance.now() - t0) / 5)
    }
    expect(Math.min(...batches)).toBeLessThan(8)
    const out = fitTitles(labels)
    expect([...out.values()].filter(f => f.fit !== 'dot').length).toBeGreaterThan(20)
    // Nothing drawn overlaps: every label's words as drawn against every other label's words and circle. Only the
    // first tier (the selected step's, always whole) may cross a circle or another of its own tier.
    const words = new Map(labels.map(l => [l.id, drawnWords(l, out.get(l.id)!)]))
    const bad: string[] = []
    for (const l of labels)
      for (const w of words.get(l.id)!)
        for (const o of labels) {
          if (o.id === l.id || (l.rank.tier <= 0 && o.rank.tier <= 0)) continue
          const hits = [...words.get(o.id)!, ...(l.rank.tier <= 0 ? [] : [o.dot])]
          if (hits.some(h => w.left < h.right && h.left < w.right && w.top < h.bottom && h.top < w.bottom)) bad.push(`${l.id}/${o.id}`)
        }
    expect(bad).toEqual([])
  })
})

describe('rankOf', () => {
  const base = { order: 0, selected: false, chain: false, focused: false, goal: false, dueNear: false, high: false, need: false, ready: false }
  it('puts the selected step first, then its chain, the focused step, the goal, a near or late date, high priority, the goal\'s own needs, ready or doing, the rest', () => {
    const tiers = [
      { ...base, selected: true },
      { ...base, chain: true },
      { ...base, focused: true },
      { ...base, goal: true },
      { ...base, dueNear: true },
      { ...base, high: true },
      { ...base, need: true },
      { ...base, ready: true },
      base,
    ].map(r => rankOf(r).tier)
    expect(tiers).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
    // the highest reason counts
    expect(rankOf({ ...base, chain: true, dueNear: true, ready: true }).tier).toBe(1)
    expect(rankOf({ ...base, order: 7 }).order).toBe(7)
  })

  it("marks the plan's top rows (a goal and a goal's own needs), whatever else ranks them", () => {
    expect(rankOf({ ...base, goal: true }).top).toBe(true)
    expect(rankOf({ ...base, need: true }).top).toBe(true)
    expect(rankOf({ ...base, need: true, high: true, selected: true }).top).toBe(true)
    expect(rankOf({ ...base, high: true, ready: true }).top).toBeFalsy()
  })
})
