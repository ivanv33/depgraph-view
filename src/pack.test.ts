import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Vitest runs from the repo root, so `npm pack` and package.json are this package's own.
const built = existsSync('dist') && existsSync('lib')

describe('the published package', () => {
  it.skipIf(!built)('packs only dist/, lib/, bin/ and the package files', () => {
    const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { encoding: 'utf8' })
    const paths: string[] = JSON.parse(out)[0].files.map((f: { path: string }) => f.path)
    const top = new Set(paths.map(p => (p.includes('/') ? p.split('/')[0] + '/' : p)))
    expect([...top].sort()).toEqual(['LICENSE', 'README.md', 'bin/', 'dist/', 'lib/', 'package.json'])
    expect(paths.some(p => /\.test\.|__tests__|\.map$/.test(p) && !p.startsWith('dist/'))).toBe(false)
  })

  it('is version 0.1.0 under MIT with a bin and Node 20', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    expect([pkg.version, pkg.license, pkg.bin['depgraph-view'], pkg.engines.node]).toEqual(['0.1.0', 'MIT', 'bin/depgraph-view.js', '>=20'])
  })
})
