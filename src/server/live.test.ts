import { chmodSync, mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeFolder, planText, removeFolders } from './__tests__/folder.js'
import { GraphError } from './loader.js'
import { watchedSource, type LiveEvent, type WatchedSource } from './live.js'

/** The first event `source` sends, or a rejection after `timeoutMs`. */
function nextEvent(source: WatchedSource, timeoutMs = 3000): Promise<LiveEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off()
      reject(new Error(`no event in ${timeoutMs} ms`))
    }, timeoutMs)
    const off = source.on(e => {
      clearTimeout(timer)
      off()
      resolve(e)
    })
  })
}

/** Every event `source` sends in the next `windowMs`. */
function collect(source: WatchedSource, windowMs: number): Promise<LiveEvent[]> {
  const events: LiveEvent[] = []
  const off = source.on(e => events.push(e))
  return new Promise(resolve => setTimeout(() => {
    off()
    resolve(events)
  }, windowMs))
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Waits for chokidar's `ready`, then a grace period: on macOS the OS-level directory watch starts a
 * moment after `ready`, and under load a write in that gap is missed (seen in concurrent runs).
 */
async function settle(source: WatchedSource): Promise<void> {
  await source.ready()
  await pause(300)
}

const graph = (nodes: Record<string, Record<string, unknown> | null>) => planText('Orchard', nodes)

let root: string
let planPath: string
let s: WatchedSource

beforeEach(async () => {
  root = makeFolder({
    'graph.yaml': graph({ a: { md: 'a.md', dir: 'ctx/a' } }),
    'a.md': '---\ntitle: Prune the pears\n---\n',
    'ctx/a/notes.txt': 'north row first',
  })
  planPath = join(root, 'graph.yaml')
  s = watchedSource(planPath)
  await settle(s)
})
afterEach(async () => {
  await s.close()
  removeFolders()
})

describe('watchedSource', () => {
  it('loads once and throws GraphError on a bad file', () => {
    expect(s.current().result.plan.nodes[0].title).toBe('Prune the pears')
    const bad = makeFolder({ 'graph.yaml': 'name: [unclosed\n' })
    expect(() => watchedSource(join(bad, 'graph.yaml'))).toThrow(GraphError)
  })
  it('picks up an edit made before the watcher is ready, without an event', async () => {
    const early = watchedSource(planPath)
    try {
      const events: LiveEvent[] = []
      early.on(e => events.push(e))
      writeFileSync(join(root, 'a.md'), '---\ntitle: Edited early\n---\n')
      await early.ready()
      expect(early.current().result.plan.nodes[0].title).toBe('Edited early')
      expect(events).toEqual([])
    } finally {
      await early.close()
    }
  })
  it('rejects ready when the watcher fails before it is ready', async () => {
    const locked = join(root, 'ctx/a/locked') // the loader skips an unreadable folder, chokidar does not
    mkdirSync(locked)
    chmodSync(locked, 0o000)
    const failing = watchedSource(planPath)
    try {
      await expect(failing.ready()).rejects.toMatchObject({ code: 'EACCES' })
    } finally {
      await failing.close()
      chmodSync(locked, 0o755)
    }
  })
  it('sends one reload for a burst of writes and serves the new title', async () => {
    for (let i = 0; i < 5; i++) writeFileSync(join(root, 'a.md'), `---\ntitle: T${i}\n---\n`)
    const events = await collect(s, 600)
    expect(events.map(e => e.type)).toEqual(['reload'])
    expect(s.current().result.plan.nodes[0].title).toBe('T4')
  })
  it('keeps the last good graph and sends error on an invalid reload', async () => {
    writeFileSync(planPath, 'name: [unclosed\n')
    const e = await nextEvent(s)
    expect(e).toEqual({ type: 'error', message: expect.stringContaining('graph.yaml') })
    expect(s.current().result.plan.nodes).toHaveLength(1)
  })
  it('sends a missing graph file by name, without its absolute path', async () => {
    rmSync(planPath)
    const e = await nextEvent(s)
    expect(e).toEqual({ type: 'error', message: expect.stringContaining('graph.yaml') })
    expect((e as { message: string }).message).not.toMatch(/(^|[\s'"(])\//)
  })
  it('sends an I/O failure without its absolute path', async () => {
    chmodSync(join(root, 'a.md'), 0o000)
    writeFileSync(planPath, graph({ a: { md: 'a.md', dir: 'ctx/a' } }))
    const e = await nextEvent(s)
    chmodSync(join(root, 'a.md'), 0o644)
    expect(e).toEqual({ type: 'error', message: 'could not reload the graph (EACCES)' })
  })
  it('reloads after an atomic rename save', async () => {
    writeFileSync(join(root, 'a.md.tmp'), '---\ntitle: Renamed in\n---\n')
    renameSync(join(root, 'a.md.tmp'), join(root, 'a.md'))
    expect((await nextEvent(s)).type).toBe('reload')
    expect(s.current().result.plan.nodes[0].title).toBe('Renamed in')
  })
  it('watches an md file added to the index by a reload', async () => {
    writeFileSync(join(root, 'b.md'), '---\ntitle: Graft the apples\n---\n')
    writeFileSync(planPath, graph({ a: { md: 'a.md', dir: 'ctx/a' }, b: { md: 'b.md', dir: 'ctx/a' } }))
    expect((await nextEvent(s)).type).toBe('reload')
    expect(s.current().result.plan.nodes.map(n => n.id)).toEqual(['a', 'b'])
    await pause(300) // chokidar starts the new watch asynchronously after `add`
    writeFileSync(join(root, 'b.md'), '---\ntitle: Graft the plums\n---\n')
    expect((await nextEvent(s)).type).toBe('reload')
    expect(s.current().result.plan.nodes[1].title).toBe('Graft the plums')
  })
  it('stops watching an md file dropped from the index by a reload', async () => {
    writeFileSync(join(root, 'b.md'), '---\ntitle: Graft the apples\n---\n')
    writeFileSync(planPath, graph({ b: { md: 'b.md', dir: 'ctx/a' } }))
    expect((await nextEvent(s)).type).toBe('reload')
    writeFileSync(join(root, 'a.md'), '---\ntitle: Not watched now\n---\n')
    expect(await collect(s, 600)).toEqual([])
  })
  it('keeps watching a folder under a still-watched folder after its node is dropped', async () => {
    mkdirSync(join(root, 'ctx/a/sub'))
    writeFileSync(join(root, 'p.md'), '---\ntitle: Child\n---\n')
    writeFileSync(planPath, graph({ a: { md: 'a.md', dir: 'ctx/a' }, p: { md: 'p.md', dir: 'ctx/a/sub' } }))
    await expect.poll(() => s.current().result.plan.nodes.length, { timeout: 3000 }).toBe(2)
    await pause(300)
    writeFileSync(planPath, graph({ a: { md: 'a.md', dir: 'ctx/a' } }))
    await expect.poll(() => s.current().result.plan.nodes.length, { timeout: 3000 }).toBe(1)
    await pause(300)
    writeFileSync(join(root, 'ctx/a/sub/late.txt'), 'planted after')
    await expect.poll(() => s.current().result.resources.a, { timeout: 3000 }).toContain('sub/late.txt')
  })
  it('keeps watching a node folder inside a dropped node folder', async () => {
    mkdirSync(join(root, 'ctx/a/sub'))
    writeFileSync(join(root, 'ctx/a/sub/s.md'), '---\ntitle: Inner\n---\n')
    writeFileSync(planPath, graph({ a: { md: 'a.md', dir: 'ctx/a' }, s: { md: 'ctx/a/sub/s.md' } }))
    await expect.poll(() => s.current().result.plan.nodes.length, { timeout: 3000 }).toBe(2)
    await pause(300)
    writeFileSync(planPath, graph({ s: { md: 'ctx/a/sub/s.md' } }))
    await expect.poll(() => s.current().result.plan.nodes.length, { timeout: 3000 }).toBe(1)
    await pause(300)
    writeFileSync(join(root, 'ctx/a/sub/new.txt'), 'still watched')
    await expect.poll(() => s.current().result.resources.s, { timeout: 3000 }).toContain('new.txt')
  })
  it('sends nothing for a write under node_modules or .git in a node folder', async () => {
    mkdirSync(join(root, 'ctx/a/node_modules/pkg'), { recursive: true })
    mkdirSync(join(root, 'ctx/a/.git'), { recursive: true })
    await pause(300)
    const events = collect(s, 600)
    writeFileSync(join(root, 'ctx/a/node_modules/pkg/x.js'), 'module.exports = 1')
    writeFileSync(join(root, 'ctx/a/.git/HEAD'), 'ref: refs/heads/main')
    expect(await events).toEqual([])
  })
  it('watches a plan that itself lives under a node_modules folder', async () => {
    const nested = makeFolder({
      'node_modules/plan/graph.yaml': graph({ a: { md: 'a.md' } }),
      'node_modules/plan/a.md': '---\ntitle: Inside\n---\n',
    })
    const inner = watchedSource(join(nested, 'node_modules/plan/graph.yaml'))
    try {
      await settle(inner)
      writeFileSync(join(nested, 'node_modules/plan/a.md'), '---\ntitle: Edited\n---\n')
      expect((await nextEvent(inner)).type).toBe('reload')
    } finally {
      await inner.close()
    }
  })
  it('holds the last reload error until a good reload clears it', async () => {
    expect(s.error?.()).toBeNull()
    writeFileSync(planPath, 'name: [unclosed\n')
    await nextEvent(s)
    expect(s.error?.()).toEqual(expect.stringContaining('graph.yaml'))
    writeFileSync(planPath, graph({ a: { md: 'a.md', dir: 'ctx/a' } }))
    expect((await nextEvent(s)).type).toBe('reload')
    expect(s.error?.()).toBeNull()
  })
  it('a file added to a node folder updates resources', async () => {
    writeFileSync(join(root, 'ctx/a/new.txt'), 'south row next')
    expect((await nextEvent(s)).type).toBe('reload')
    expect(s.current().result.resources.a).toContain('new.txt')
  })
  it('a file added in a subfolder of a node folder updates resources', async () => {
    mkdirSync(join(root, 'ctx/a/deep'))
    writeFileSync(join(root, 'ctx/a/deep/more.txt'), 'east row later')
    await expect.poll(() => s.current().result.resources.a, { timeout: 3000 }).toContain('deep/more.txt')
  })
  it('sends nothing for a symlink in a node folder at start', async () => {
    symlinkSync(makeFolder({}), join(root, 'ctx/a/link-out'))
    await pause(500) // past the OS reporting the symlink's own creation
    const linked = watchedSource(planPath)
    try {
      const events: LiveEvent[] = []
      linked.on(e => events.push(e))
      await linked.ready()
      await pause(400)
      expect(events).toEqual([])
    } finally {
      await linked.close()
    }
  })
  it('sends nothing after close', async () => {
    await s.close()
    const events: LiveEvent[] = []
    s.on(e => events.push(e))
    writeFileSync(join(root, 'a.md'), '---\ntitle: Too late\n---\n')
    await pause(400)
    expect(events).toEqual([])
    expect(s.current().result.plan.nodes[0].title).toBe('Prune the pears')
  })
})
