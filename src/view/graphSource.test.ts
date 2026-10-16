import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Graph and its companions keep the cut', () => {
  it('no view component queries the host DOM by test id or reaches into app modules', () => {
    for (const f of ['Graph.tsx', 'ChainEdgeCue.tsx', 'DeckList.tsx']) {
      const src = readFileSync(join('src/view', f), 'utf8')
      expect(src, f).not.toMatch(/querySelector[^(]*\(\s*['"`]\[data-testid/)
      expect(src, f).not.toMatch(/readyPlace|panelLayout|NodeHud|useHotkeys/)
    }
  })
  it('Graph keeps no app chrome: no app test ids, no bottom card gap past the host insets', () => {
    const src = readFileSync('src/view/Graph.tsx', 'utf8')
    expect(src).not.toMatch(/node-panel|node-hud/)
    expect(src, 'the cue area and the measured area end at the host bottom inset (<= the view height)').not.toMatch(/FRAME\.hudGap|FRAME\.hudBottom/)
  })
  it('Graph declares exactly the cut props', () => {
    const src = readFileSync('src/view/Graph.tsx', 'utf8')
    const start = src.indexOf('export interface GraphProps')
    const block = src.slice(start, src.indexOf('\n}', start)) // the interface's own closing brace: a prop's type may hold braces
    const names = [...block.matchAll(/^\s+(\w+)\??:/gm)].map(m => m[1]).sort()
    expect(names).toEqual(['arming', 'chrome', 'fitAll', 'flyTo', 'focusFallback', 'grouped', 'insets', 'legend', 'marked', 'onAddAt', 'onGlides', 'onLinkContextMenu', 'onOpenedDone', 'onPick', 'onSelect', 'onShiftLink', 'passiveInsets', 'plan', 'selected', 'shake', 'today'])
  })
})
