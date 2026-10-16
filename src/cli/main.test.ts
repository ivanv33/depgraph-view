import { writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeFolder, removeFolders } from '../server/__tests__/folder.js'
import type { RunningServer } from '../server/index.js'
import { USAGE } from './args.js'
import { run, type Io } from './main.js'

function capture(): Io & { outLines: string[]; errLines: string[] } {
  const outLines: string[] = []
  const errLines: string[] = []
  return { outLines, errLines, out: line => void outLines.push(line), err: line => void errLines.push(line) }
}

const GRAPH = JSON.stringify({ name: 'Orchard', nodes: [{ id: 'a', md: 'a.md' }] })

let root: string
let bad: string
let running: RunningServer[] = []

beforeEach(() => {
  root = makeFolder({ 'graph.json': GRAPH, 'a.md': '---\ntitle: Prune the pears\n---\n' })
  bad = makeFolder({})
})
afterEach(async () => {
  await Promise.all(running.splice(0).map(s => s.close()))
  removeFolders()
})

/** `run`, remembering any server it starts so teardown closes it. */
async function start(argv: string[], io: Io, open?: (url: string) => void) {
  const r = await run(argv, io, open)
  if (r.server) running.push(r.server)
  return r
}

describe('run', () => {
  it('prints one line with the URL and keeps serving', async () => {
    const io = capture()
    const { code, server } = await start([root, '--port', '0', '--no-watch'], io)
    expect(code).toBe(0)
    expect(io.outLines).toEqual([server!.url])
    expect(io.errLines).toEqual([])
    expect((await fetch(`${server!.url}api/graph`)).status).toBe(200)
  })
  it('serves with the watcher on by default', async () => {
    const io = capture()
    const { code, server } = await start([root, '--port', '0'], io)
    expect(code).toBe(0)
    expect(io.outLines).toEqual([server!.url])
  })
  it('prints the usage to stdout and exits 0 for --help, exits 2 with an error for bad arguments', async () => {
    const help = capture()
    expect(await start(['--help'], help)).toEqual({ code: 0 })
    expect(help.outLines).toEqual([USAGE])
    expect(help.errLines).toEqual([])
    const io = capture()
    expect((await start([root, '--port', 'x'], io)).code).toBe(2)
    expect(io.errLines).toHaveLength(1)
  })
  it('exits 1 with the loader error for invalid JSON and for a missing path', async () => {
    writeFileSync(join(bad, 'graph.json'), '{ "name": 3, "nodes": [] }')
    const invalid = capture()
    expect(await start([bad, '--port', '0'], invalid)).toEqual({ code: 1 })
    expect(invalid.errLines).toEqual(['depgraph-view: name must be a string'])
    const io = capture()
    expect(await start([join(root, 'nope.json'), '--port', '0'], io)).toEqual({ code: 1 })
    expect(io.errLines).toHaveLength(1)
    expect(io.errLines[0]).toMatch(/^depgraph-view: /)
    expect(io.outLines).toEqual([])
  })
  it('exits 1 when the given port is in use', async () => {
    const held: Server = createServer()
    await new Promise<void>(resolve => held.listen(0, '127.0.0.1', resolve))
    const port = (held.address() as AddressInfo).port
    try {
      const io = capture()
      expect(await start([root, '--port', String(port), '--no-watch'], io)).toEqual({ code: 1 })
      expect(io.errLines).toEqual([`depgraph-view: port ${port} is in use`])
      expect(io.outLines).toEqual([])
    } finally {
      await new Promise<void>(resolve => held.close(() => resolve()))
    }
  })
  it('prints warnings to stderr only', async () => {
    const dir = makeFolder({
      'graph.json': JSON.stringify({ name: 'Orchard', nodes: [{ id: 'a', md: 'a.md' }, { id: 'x', md: 'x.md' }] }),
      'a.md': '---\ntitle: Prune the pears\n---\n',
    })
    const io = capture()
    const { code, server } = await start([dir, '--port', '0', '--no-watch'], io)
    expect(code).toBe(0)
    expect(io.outLines).toEqual([server!.url])
    expect(io.errLines).toEqual(['warning: node "x": md not found'])
  })
  it('opens the browser at the URL only with --open', async () => {
    const opened: string[] = []
    const plain = await start([root, '--port', '0', '--no-watch'], capture(), url => void opened.push(url))
    expect(opened).toEqual([])
    const io = capture()
    const { server } = await start([root, '--port', '0', '--no-watch', '--open'], io, url => void opened.push(url))
    expect(opened).toEqual([server!.url])
    expect(plain.code).toBe(0)
  })
})
