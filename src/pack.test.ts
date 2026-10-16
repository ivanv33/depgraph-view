import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The repo root from this file, so `npm pack` and package.json are this package's own wherever vitest runs.
const repo = fileURLToPath(new URL('..', import.meta.url))
const built = existsSync(join(repo, 'dist')) && existsSync(join(repo, 'lib'))

describe('the published package', () => {
  it.skipIf(!built)('packs only dist/, lib/, bin/ and the package files', () => {
    const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: repo, encoding: 'utf8' })
    const paths: string[] = JSON.parse(out)[0].files.map((f: { path: string }) => f.path)
    const top = new Set(paths.map(p => (p.includes('/') ? p.split('/')[0] + '/' : p)))
    expect([...top].sort()).toEqual(['LICENSE', 'README.md', 'bin/', 'dist/', 'lib/', 'package.json'])
    expect(paths.some(p => /\.test\.|__tests__|\.map$/.test(p) && !p.startsWith('dist/'))).toBe(false)
  })

  it.skipIf(!built)('builds the page with relative asset URLs, so it works under any base path', () => {
    expect(readFileSync(join(repo, 'dist/viewer.css'), 'utf8')).not.toContain('url(/')
    const html = readFileSync(join(repo, 'dist/index.html'), 'utf8')
    expect(html).not.toMatch(/(src|href)="\//)
    expect(html).toContain('./viewer.css')
  })

  it('is version 0.2.2 under MIT with a bin and Node 20.19', () => {
    const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
    expect([pkg.version, pkg.license, pkg.bin['depgraph-view'], pkg.engines.node]).toEqual(['0.2.2', 'MIT', 'bin/depgraph-view.js', '>=20.19'])
  })

  it('builds on prepare, so an install from a git source gets lib/ and dist/', () => {
    const { scripts } = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
    expect(scripts.prepare).toBe('rm -rf dist lib && npm run build')
    expect(scripts).not.toHaveProperty('prepack')
  })
})
