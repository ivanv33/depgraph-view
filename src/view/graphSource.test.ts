import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Graph and its companions keep the cut', () => {
  it('no view component queries the host DOM by test id or reaches into app modules', () => {
    for (const f of ['Graph.tsx', 'ChainEdgeCue.tsx', 'DeckList.tsx']) {
      const src = readFileSync(join('src/view', f), 'utf8')
      expect(src, f).not.toMatch(/querySelector[^(]*\(\s*['"`]\[data-testid/)
      expect(src, f).not.toMatch(/shiftLink|readyPlace|panelLayout|NodeHud|useHotkeys/)
    }
  })
  it('Graph declares exactly the cut props', () => {
    const src = readFileSync('src/view/Graph.tsx', 'utf8')
    const block = src.slice(src.indexOf('export interface GraphProps'), src.indexOf('}', src.indexOf('export interface GraphProps')))
    const names = [...block.matchAll(/^\s+(\w+)\??:/gm)].map(m => m[1]).sort()
    expect(names).toEqual(['fitAll', 'focusFallback', 'grouped', 'insets', 'onGlides', 'onSelect', 'plan', 'selected', 'today'])
  })
})
