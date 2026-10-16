import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { makeFolder, planText, removeFolders } from '../server/__tests__/folder.js'
import { parseArgs, USAGE } from './args.js'
import { run, type Io } from './main.js'
import { summaryLine, VALIDATE_EXIT } from './validate.js'

function capture(): Io & { outLines: string[]; errLines: string[] } {
  const outLines: string[] = []
  const errLines: string[] = []
  return { outLines, errLines, out: line => void outLines.push(line), err: line => void errLines.push(line) }
}

const card = (title: string) => `---\ntitle: ${title}\n---\n`

/** A clean garden: three steps, two links, a card each, and a deleted folder the loader ignores. */
const clean = () =>
  makeFolder({
    'garden.yaml': planText('Vegetable garden', { 'dig-beds': {}, 'sow-seeds': { needs: ['dig-beds'] }, 'water-rows': { needs: ['sow-seeds'] } }),
    'nodes/dig-beds.context/dig-beds.md': card('Dig the beds'),
    'nodes/sow-seeds.context/sow-seeds.md': card('Sow the seeds'),
    'nodes/water-rows.context/water-rows.md': card('Water the rows'),
    'deleted/buy-hose.context/buy-hose.md': card('Buy a hose'),
  })

/** Loads, but with a missing card and an unknown dependency. */
const warned = () =>
  makeFolder({
    'garden.yaml': planText('Vegetable garden', { 'dig-beds': {}, 'sow-seeds': { needs: ['dig-beds', 'buy-seeds'] } }),
    'nodes/dig-beds.context/dig-beds.md': card('Dig the beds'),
  })

/** Refused: a card with an invalid status. */
const broken = () =>
  makeFolder({
    'garden.yaml': planText('Vegetable garden', { 'dig-beds': {} }),
    'nodes/dig-beds.context/dig-beds.md': '---\ntitle: Dig the beds\nstatus: started\n---\n',
  })

afterEach(() => removeFolders())

describe('summaryLine', () => {
  it('counts steps, links and warnings, singular for one', () => {
    expect(summaryLine('Vegetable garden', 3, 2, 0)).toBe('Vegetable garden: 3 steps, 2 links, no warnings')
    expect(summaryLine('Vegetable garden', 1, 1, 1)).toBe('Vegetable garden: 1 step, 1 link, 1 warning')
    expect(summaryLine('Vegetable garden', 0, 0, 4)).toBe('Vegetable garden: 0 steps, 0 links, 4 warnings')
  })
})

describe('parseArgs validate', () => {
  it('takes validate, one path and --json', () => {
    expect(parseArgs(['validate', 'garden'])).toEqual({ command: 'validate', path: 'garden', json: false })
    expect(parseArgs(['validate', '--json', 'garden'])).toEqual({ command: 'validate', path: 'garden', json: true })
    expect(parseArgs(['validate', '-h'])).toEqual({ help: USAGE })
  })
  it('rejects no path, two paths and the serving flags', () => {
    for (const a of [['validate'], ['validate', 'a', 'b'], ['validate', 'a', '--port', '0'], ['validate', 'a', '--no-watch'], ['validate', 'a', '--open']])
      expect(parseArgs(a), a.join(' ')).toHaveProperty('error')
  })
  it('keeps `validate` as a path only after the command word', () => {
    expect(parseArgs(['./validate'])).toEqual({ path: './validate', open: false, watch: true })
    expect(parseArgs(['validate', 'validate'])).toEqual({ command: 'validate', path: 'validate', json: false })
  })
  it('lists the command in the usage', () => {
    expect(USAGE.split('\n')[1]).toBe('       depgraph-view validate <path> [--json]')
    expect(USAGE).toMatch(/validate\s+load the plan once/)
    expect(USAGE).toMatch(/--json\s+/)
  })
})

describe('run validate', () => {
  it('a clean plan: the summary on stdout, nothing on stderr, exit 0, no server', async () => {
    const io = capture()
    expect(await run(['validate', clean()], io)).toEqual({ code: 0 })
    expect(io.outLines).toEqual(['Vegetable garden: 3 steps, 2 links, no warnings'])
    expect(io.errLines).toEqual([])
  })
  it('a plan with warnings: each warning on stderr as the server prints it, exit 1', async () => {
    const io = capture()
    expect(await run(['validate', warned()], io)).toEqual({ code: 1 })
    expect(io.errLines).toEqual(['warning: node "sow-seeds": no md file', 'warning: node "sow-seeds": unknown dependency "buy-seeds" dropped'])
    expect(io.outLines).toEqual(['Vegetable garden: 2 steps, 1 link, 2 warnings'])
  })
  it('a refused plan: the loader message on stderr as the server prints it, nothing on stdout, exit 2', async () => {
    const io = capture()
    expect(await run(['validate', broken()], io)).toEqual({ code: 2 })
    expect(io.errLines).toEqual(['depgraph-view: node "dig-beds": invalid status "started"'])
    expect(io.outLines).toEqual([])
  })
  it('a folder with no plan, and a missing path: exit 2', async () => {
    const empty = makeFolder({ 'notes.txt': 'compost\n' })
    const io = capture()
    expect(await run(['validate', empty], io)).toEqual({ code: 2 })
    expect(io.errLines).toEqual([`depgraph-view: ${empty}: expected a .yaml plan file at the top of the folder, found none`])
    expect(io.outLines).toEqual([])
    const gone = capture()
    expect(await run(['validate', join(empty, 'nope')], gone)).toEqual({ code: 2 })
    expect(gone.errLines).toEqual([`depgraph-view: not found: ${join(empty, 'nope')}`])
  })
  it('a usage error: exit 2 with the message and the usage on stderr', async () => {
    const io = capture()
    expect(await run(['validate'], io)).toEqual({ code: 2 })
    expect(io.errLines).toEqual([USAGE])
  })
  it('--json prints one object instead of the summary, stderr unchanged', async () => {
    const ok = capture()
    expect(await run(['validate', warned(), '--json'], ok)).toEqual({ code: 1 })
    expect(ok.outLines).toHaveLength(1)
    expect(JSON.parse(ok.outLines[0])).toEqual({
      name: 'Vegetable garden',
      steps: 2,
      links: 1,
      warnings: ['node "sow-seeds": no md file', 'node "sow-seeds": unknown dependency "buy-seeds" dropped'],
      errors: [],
    })
    expect(ok.errLines).toHaveLength(2)
    const bad = capture()
    expect(await run(['validate', '--json', broken()], bad)).toEqual({ code: 2 })
    expect(JSON.parse(bad.outLines[0])).toEqual({ name: null, steps: 0, links: 0, warnings: [], errors: ['node "dig-beds": invalid status "started"'] })
    expect(bad.errLines).toEqual(['depgraph-view: node "dig-beds": invalid status "started"'])
  })
  it('the exit codes are 0, 1 and 2', () => {
    expect(VALIDATE_EXIT).toEqual({ clean: 0, warnings: 1, refused: 2 })
  })
})

const repo = fileURLToPath(new URL('../..', import.meta.url))
const bin = join(repo, 'bin/depgraph-view.js')

describe.skipIf(!existsSync(join(repo, 'lib/cli/validate.js')))('bin/depgraph-view.js validate (built)', () => {
  it('prints the summary, exits with the code and starts no server', () => {
    const r = spawnSync(process.execPath, [bin, 'validate', clean()], { encoding: 'utf8', timeout: 10000 })
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('Vegetable garden: 3 steps, 2 links, no warnings\n')
    expect(r.stderr).toBe('')
    const w = spawnSync(process.execPath, [bin, 'validate', warned()], { encoding: 'utf8', timeout: 10000 })
    expect(w.status).toBe(1)
    expect(w.stderr.split('\n').filter(Boolean)).toEqual(['warning: node "sow-seeds": no md file', 'warning: node "sow-seeds": unknown dependency "buy-seeds" dropped'])
    const b = spawnSync(process.execPath, [bin, 'validate', broken()], { encoding: 'utf8', timeout: 10000 })
    expect(b.status).toBe(2)
    expect(b.stdout).toBe('')
    expect(b.stderr).toBe('depgraph-view: node "dig-beds": invalid status "started"\n')
  })
})
