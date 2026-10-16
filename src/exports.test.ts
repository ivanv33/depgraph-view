// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repo = fileURLToPath(new URL('..', import.meta.url))
const read = (p: string) => readFileSync(join(repo, p), 'utf8')
const plain = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')
const built = existsSync(join(repo, 'lib'))

describe('package exports', () => {
  it('maps ./engine/*, ./view/*, ./labels.css and ./deckList.css', () => {
    const pkg = JSON.parse(read('package.json'))
    expect(pkg.exports['./engine/*']).toEqual({ types: './lib/engine/*.d.ts', default: './lib/engine/*.js' })
    expect(pkg.exports['./view/*']).toEqual({ types: './lib/view/*.d.ts', default: './lib/view/*.js' })
    expect(pkg.exports['./labels.css']).toBe('./lib/view/labels.css')
    expect(pkg.exports['./deckList.css']).toBe('./lib/view/deckList.css')
    expect(pkg.scripts['build:lib']).toBe('tsc -p tsconfig.build.json && node scripts/copy-css.mjs')
  })

  it.skipIf(!built)('server-safe subpaths load by name in plain Node, through the exports map', () => {
    // a self-reference by package name goes through `exports`; v0.2.1 refuses it with ERR_PACKAGE_PATH_NOT_EXPORTED
    const script = [
      "const s = await import('depgraph-view/engine/schema')",
      "const p = await import('depgraph-view/view/PriorityMark')",
      "const h = await import('depgraph-view/view/hooks/useElementHeight')",
      'console.log(typeof s.validatePlan, typeof p.default, typeof h.useElementEdge, typeof globalThis.window)',
    ].join(';')
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: repo, encoding: 'utf8' })
    expect(out.trim()).toBe('function function function undefined')
    expect(existsSync(join(repo, 'lib/view/labels.css'))).toBe(true)
    expect(existsSync(join(repo, 'lib/view/deckList.css'))).toBe(true)
  })

  it('labels.css and deckList.css are plain CSS: no Tailwind, no page globals', () => {
    for (const file of ['src/view/labels.css', 'src/view/deckList.css']) {
      const css = plain(read(file))
      expect(css, file).not.toMatch(/@import|@tailwind|@apply|@source|@theme/)
      expect(css, file).not.toMatch(/color-scheme|(^|\n)\s*(html|body)\b|(^|[\n,}])\s*button:focus-visible|\.md\b|\.panel-section-label/)
    }
  })

  it('labels.css holds the label rules, the mark sizes, the crosshair, the shake and the just-added mark', () => {
    const css = read('src/view/labels.css')
    expect(css).toMatch(/:root \{[^}]*--mark-h: 0\.8em;/)
    for (const s of ['.glass {', '.node-label {', '.node-dot {', '.priority-mark {', "[data-arming='true'] .node-label",
      "[data-shift='true'] .node-label { cursor: crosshair; }", '@keyframes dg-shake', ".node-label[data-shake='true'] .node-label-title {",
      '@keyframes dg-added', ".node-label[data-added='true'] .node-dot {"]) expect(css).toContain(s)
  })

  it('deckList.css holds the deck list rules and the link hint', () => {
    const css = read('src/view/deckList.css')
    expect(css).toContain('.deck-list {')
    expect(css).toContain('.deck-list-hint { margin: 0; padding: 6px 12px 0; font-size: 11px; color: #ffb454; }')
    expect(css).toContain(".deck-list-rows [data-state='done'] .priority-mark { filter: brightness(0.7); }")
  })

  it('viewer.css imports both right after Tailwind and keeps only the page rules', () => {
    const css = read('src/view/viewer.css')
    expect(css.startsWith('@import "tailwindcss" source(".");\n@import "./labels.css";\n@import "./deckList.css";\n')).toBe(true)
    for (const s of ['.node-dot {', '--mark-h:', '.deck-list {', 'dg-shake']) expect(css).not.toContain(s)
    expect(css).not.toMatch(/^\.glass \{/m) // the glass rule lives in labels.css; the page's bottom sheet only tints it
    for (const s of ['color-scheme: dark;', 'body {', 'button:focus-visible', '.md {', '.panel-section-label {']) expect(css).toContain(s)
  })

  it('the root exports the app-facing pieces', () => {
    const index = read('src/view/index.ts').replace(/from\s+'[^']*'/g, '') // text: importing `.` would load react-force-graph-3d; module paths must not satisfy the match
    for (const name of ['PriorityMark', 'PriorityMarkProps', 'STATE_NAME', 'STATE_SWATCH', 'LegendList', 'useGrouping', 'useToday',
      'useElementHeight', 'useElementEdge', 'WindowEdge', 'HostChrome', 'NodeSignal', 'PickMode']) expect(index, name).toMatch(new RegExp(`\\b${name}\\b`))
  })
})
