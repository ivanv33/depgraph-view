import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer, request, type Server } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeFolder, planText, removeFolders } from './__tests__/folder.js'
import { contentType, createHandler } from './http.js'
import type { GraphSource, LiveEvent } from './live.js'
import { PortInUseError } from './port.js'
import { startServer, type RunningServer } from './start.js'

/** Sends `path` byte for byte (fetch would normalise dot segments) and resolves the status. */
function rawStatus(url: string, path: string): Promise<number> {
  const { port } = new URL(url)
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET' }, res => {
      res.resume()
      resolve(res.statusCode ?? 0)
    })
    req.on('error', reject)
    req.end()
  })
}

/** The status for GET `/` with the Host header set to `host`, or sent without one when `host` is null. */
function hostStatus(url: string, host: string | null): Promise<number> {
  const { port } = new URL(url)
  return new Promise((resolve, reject) => {
    const headers = host === null ? {} : { Host: host }
    const req = request({ host: '127.0.0.1', port, path: '/', method: 'GET', headers, setHost: host !== null }, res => {
      res.resume()
      expect(res.headers['x-content-type-options']).toBe('nosniff')
      resolve(res.statusCode ?? 0)
    })
    req.on('error', reject)
    req.end()
  })
}

/** Whether this machine lets a test bind 0.0.0.0 (a sandbox may not). */
const canBindAll = await new Promise<boolean>(resolve => {
  const probe = createNetServer()
  probe.once('error', () => resolve(false))
  probe.listen(0, '0.0.0.0', () => probe.close(() => resolve(true)))
})

let root: string
let distDir: string
let server: RunningServer

beforeEach(async () => {
  const outside = makeFolder({ 'secret.txt': 'not for the page' })
  distDir = makeFolder({ 'index.html': '<!doctype html><title>viewer</title>', 'assets/app-abc123.js': 'console.log(1)', 'viewer.css': 'body{}' })
  root = makeFolder({
    'graph.yaml': planText('Garden', { a: { md: 'a.md', dir: 'ctx/a' } }),
    'a.md': '---\ntitle: Sow the beans\n---\nBody\n',
    'ctx/a/notes.txt': 'row by row',
    'ctx/a/page.html': '<script>alert(1)</script>',
    'ctx/a/blob.bin': Buffer.from([0, 1, 2]),
    'ctx/a/my notes #1?.txt': 'odd name',
  })
  symlinkSync(outside, join(root, 'ctx/a/link-out'))
  server = await startServer({ path: root, port: 0, distDir })
})
afterEach(async () => {
  await server.close()
  removeFolders()
})

describe('startServer', () => {
  it('binds 127.0.0.1 and serves the page with nosniff', async () => {
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/)
    const r = await fetch(server.url)
    expect(r.status).toBe(200)
    expect(r.headers.get('x-content-type-options')).toBe('nosniff')
    expect(r.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(r.headers.get('content-security-policy')).toBe("default-src 'self'; img-src 'self' blob: data:; connect-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; worker-src 'self' blob:")
  })
  it('serves the graph without folder paths', async () => {
    const body = await (await fetch(`${server.url}api/graph`)).json()
    expect(Object.keys(body).sort()).toEqual(['bodies', 'generatedAt', 'plan', 'resources', 'warnings'])
    expect(JSON.stringify(body)).not.toContain(root)
  })
  it('serves a node file and 404s traversal and symlinks out', async () => {
    expect((await fetch(`${server.url}files/a/notes.txt`)).status).toBe(200)
    for (const p of ['files/a/../graph.yaml', 'files/a/%2e%2e/graph.yaml', 'files/a/../../graph.yaml', 'files/a/%2e%2e/%2e%2e/graph.yaml'])
      expect(await rawStatus(server.url, `/${p}`), p).toBe(404)
    for (const p of ['files/a/..%2fgraph.yaml', 'files/a/..%2f..%2fgraph.yaml', 'files/a/link-out/secret.txt', 'files/ghost/x.txt', 'files/a/'])
      expect((await fetch(`${server.url}${p}`)).status, p).toBe(404)
  })
  it('serves encoded names and 404s encoded traversal', async () => {
    const r = await fetch(`${server.url}files/a/${encodeURIComponent('my notes #1?.txt')}`)
    expect(r.status).toBe(200)
    expect((await fetch(`${server.url}files/a/%E0%A4%A`)).status).toBe(404)
  })
  it('sends files with the allowlisted type and a sandbox CSP', async () => {
    const r = await fetch(`${server.url}files/a/page.html`)
    expect(r.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(r.headers.get('content-security-policy')).toContain('sandbox')
    expect(r.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'")
    expect((await fetch(`${server.url}files/a/blob.bin`)).headers.get('content-type')).toBe('application/octet-stream')
  })
  it('refuses a request whose Host is not a loopback name', async () => {
    expect(await hostStatus(server.url, 'evil.example')).toBe(403)
    expect(await hostStatus(server.url, `evil.example:${server.port}`)).toBe(403)
    expect(await hostStatus(server.url, '127.0.0.1.evil.example')).toBe(403)
    expect(await hostStatus(server.url, null)).toBe(403)
    for (const host of ['127.0.0.1', `127.0.0.1:${server.port}`, 'localhost', `localhost:${server.port}`, '[::1]', `[::1]:${server.port}`])
      expect(await hostStatus(server.url, host), host).toBe(200)
  })
  it('binds an explicit 127.0.0.1 and keeps the Host check', async () => {
    const explicit = await startServer({ path: root, port: 0, distDir, host: '127.0.0.1', watch: false })
    try {
      expect(explicit.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/)
      expect(explicit.urls).toEqual([explicit.url])
      expect(await hostStatus(explicit.url, 'evil.example')).toBe(403)
      expect(await hostStatus(explicit.url, '127.0.0.1')).toBe(200)
    } finally {
      await explicit.close()
    }
  })
  it.skipIf(!canBindAll)('binds 0.0.0.0 and accepts any Host there', async () => {
    const all = await startServer({ path: root, port: 0, distDir, host: '0.0.0.0', watch: false })
    try {
      expect(all.urls.length).toBeGreaterThan(0)
      expect(all.url).toBe(all.urls[0])
      expect(all.url).toMatch(new RegExp(`^http://[0-9.]+:${all.port}/$`))
      const local = `http://127.0.0.1:${all.port}/`
      for (const host of ['evil.example', `evil.example:${all.port}`, '127.0.0.1', null]) expect(await hostStatus(local, host), String(host)).toBe(200)
      expect((await fetch(`${local}api/graph`)).status).toBe(200)
      expect((await fetch(`${local}api/graph`, { method: 'POST' })).status).toBe(405)
    } finally {
      await all.close()
    }
  })
  it('rejects a host it cannot bind', async () => {
    await expect(startServer({ path: root, port: 0, distDir, host: '203.0.113.7', watch: false })).rejects.toThrow()
  })
  it('404s node files under .git or node_modules', async () => {
    for (const rel of ['.git/config', 'node_modules/x.js', 'sub/node_modules/x.js', 'sub/ok.txt']) {
      mkdirSync(dirname(join(root, 'ctx/a', rel)), { recursive: true })
      writeFileSync(join(root, 'ctx/a', rel), 'present')
    }
    expect((await fetch(`${server.url}files/a/sub/ok.txt`)).status).toBe(200)
    for (const rel of ['.git/config', 'node_modules/x.js', 'sub/node_modules/x.js', 'sub%2Fnode_modules%2Fx.js'])
      expect(await rawStatus(server.url, `/files/a/${rel}`), rel).toBe(404)
  })
  it('has no write routes', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) expect((await fetch(`${server.url}api/graph`, { method })).status).toBe(405)
  })
  it('rejects a given port in use', async () => {
    await expect(startServer({ path: root, port: server.port, distDir })).rejects.toBeInstanceOf(PortInUseError)
  })
  it('serves assets immutable, the page and graph uncached, and 404s the rest as text', async () => {
    const asset = await fetch(`${server.url}assets/app-abc123.js`)
    expect(asset.status).toBe(200)
    expect(asset.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect((await fetch(`${server.url}viewer.css`)).headers.get('content-type')).toBe('text/css; charset=utf-8')
    expect((await fetch(server.url)).headers.get('cache-control')).toBe('no-cache')
    const graph = await fetch(`${server.url}api/graph`)
    expect(graph.headers.get('cache-control')).toBe('no-store')
    expect(graph.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(await rawStatus(server.url, '/assets/../index.html')).toBe(404)
    const missing = await fetch(`${server.url}nope`)
    expect(missing.status).toBe(404)
    expect(missing.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(missing.headers.get('x-content-type-options')).toBe('nosniff')
  })
  it('answers HEAD with the GET headers and no body', async () => {
    const get = await fetch(`${server.url}files/a/notes.txt`)
    const head = await fetch(`${server.url}files/a/notes.txt`, { method: 'HEAD' })
    expect(head.status).toBe(200)
    for (const h of ['content-type', 'content-length', 'content-security-policy', 'x-content-type-options'])
      expect(head.headers.get(h), h).toBe(get.headers.get(h))
    expect(await head.text()).toBe('')
  })
  it('streams reload events on /events', async () => {
    const r = await fetch(`${server.url}events`)
    expect(r.headers.get('content-type')).toBe('text/event-stream')
    expect(r.headers.get('cache-control')).toBe('no-cache')
    expect(r.headers.get('connection')).toBe('keep-alive')
    expect(r.headers.get('x-content-type-options')).toBe('nosniff')
    const reader = r.body!.getReader()
    const decoder = new TextDecoder()
    expect(decoder.decode((await reader.read()).value)).toBe('retry: 1000\n\n')
    // The OS-level watch starts a moment after chokidar's ready and may first report the fixture's own
    // creation, so wait out that gap and read frames until a reload carries the edit.
    await new Promise(resolve => setTimeout(resolve, 300))
    writeFileSync(join(root, 'a.md'), '---\ntitle: Water the beans\n---\n')
    let title = 'Sow the beans'
    while (title !== 'Water the beans') {
      const text = decoder.decode((await reader.read()).value)
      expect(text).toMatch(/^event: reload\ndata: \{"generatedAt":"[^"]+"\}\n\n$/)
      title = (await (await fetch(`${server.url}api/graph`)).json()).plan.nodes[0].title
    }
    await reader.cancel()
  })
  it('ends open /events streams on close', async () => {
    const reader = (await fetch(`${server.url}events`)).body!.getReader()
    await reader.read()
    await server.close()
    await expect(reader.read().then(r => r.done)).rejects.toThrow()
  })
  it('does not watch with watch: false', async () => {
    const still = await startServer({ path: root, port: 0, distDir, watch: false })
    try {
      writeFileSync(join(root, 'a.md'), '---\ntitle: Water the beans\n---\n')
      await new Promise(resolve => setTimeout(resolve, 500))
      expect((await (await fetch(`${still.url}api/graph`)).json()).plan.nodes[0].title).toBe('Sow the beans')
    } finally {
      await still.close()
    }
  })
})

describe('createHandler', () => {
  let bare: Server
  afterEach(() => {
    bare.closeAllConnections()
    return new Promise<void>(resolve => bare.close(() => resolve()))
  })
  it('turns a thrown error into a generic 500', async () => {
    const source: GraphSource = {
      current: () => { throw new Error('EACCES: /private/plan/a.md') },
      on: () => () => {},
      close: async () => {},
    }
    bare = createServer(createHandler(source, makeFolder({})))
    await new Promise<void>(resolve => bare.listen(0, '127.0.0.1', resolve))
    const r = await fetch(`http://127.0.0.1:${(bare.address() as AddressInfo).port}/api/graph`)
    expect(r.status).toBe(500)
    expect(r.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(await r.text()).not.toContain('/private')
  })
  it('accepts any Host, or none, when the check is off and refuses a forged one by default', async () => {
    const source: GraphSource = { current: () => { throw new Error('unused') }, on: () => () => {}, close: async () => {} }
    const dist = makeFolder({ 'index.html': '<!doctype html>' })
    bare = createServer({ requireHostHeader: false }, createHandler(source, dist, { checkHost: false }))
    await new Promise<void>(resolve => bare.listen(0, '127.0.0.1', resolve))
    const open = `http://127.0.0.1:${(bare.address() as AddressInfo).port}/`
    for (const host of ['evil.example', 'box.local:80', null]) expect(await hostStatus(open, host), String(host)).toBe(200)
    const strict = createServer({ requireHostHeader: false }, createHandler(source, dist))
    await new Promise<void>(resolve => strict.listen(0, '127.0.0.1', resolve))
    try {
      expect(await hostStatus(`http://127.0.0.1:${(strict.address() as AddressInfo).port}/`, 'evil.example')).toBe(403)
    } finally {
      await new Promise<void>(resolve => strict.close(() => resolve()))
    }
  })
  it('writes error events on /events and unsubscribes when the client goes', async () => {
    const listeners = new Set<(e: LiveEvent) => void>()
    const source: GraphSource = {
      current: () => { throw new Error('unused') },
      on: listener => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      close: async () => {},
    }
    bare = createServer(createHandler(source, makeFolder({})))
    await new Promise<void>(resolve => bare.listen(0, '127.0.0.1', resolve))
    const reader = (await fetch(`http://127.0.0.1:${(bare.address() as AddressInfo).port}/events`)).body!.getReader()
    const decoder = new TextDecoder()
    let text = decoder.decode((await reader.read()).value)
    expect(listeners.size).toBe(1)
    for (const l of listeners) l({ type: 'error', message: 'graph.yaml: "bad" input' })
    while (!text.endsWith('\n\n') || text === 'retry: 1000\n\n') text += decoder.decode((await reader.read()).value)
    expect(text).toBe('retry: 1000\n\nevent: error\ndata: {"message":"graph.yaml: \\"bad\\" input"}\n\n')
    await reader.cancel()
    await expect.poll(() => listeners.size).toBe(0)
  })
})

describe('createHandler late joiner', () => {
  let bare: Server
  afterEach(() => {
    bare.closeAllConnections()
    return new Promise<void>(resolve => bare.close(() => resolve()))
  })
  it('writes the current error of the source to a client that connects after it', async () => {
    const source: GraphSource = {
      current: () => { throw new Error('unused') },
      on: () => () => {},
      error: () => 'graph.yaml: bad',
      close: async () => {},
    }
    bare = createServer(createHandler(source, makeFolder({})))
    await new Promise<void>(resolve => bare.listen(0, '127.0.0.1', resolve))
    const reader = (await fetch(`http://127.0.0.1:${(bare.address() as AddressInfo).port}/events`)).body!.getReader()
    const decoder = new TextDecoder()
    let text = ''
    while (!text.includes('event: error')) text += decoder.decode((await reader.read()).value)
    expect(text).toBe('retry: 1000\n\nevent: error\ndata: {"message":"graph.yaml: bad"}\n\n')
    await reader.cancel()
  })
})

describe('contentType', () => {
  it('maps the allowlist and falls back to octet-stream', () => {
    expect(contentType('x.HTML')).toBe('text/html; charset=utf-8')
    expect(contentType('x.md')).toBe('text/plain; charset=utf-8')
    expect(contentType('x.jpeg')).toBe('image/jpeg')
    expect(contentType('x.woff2')).toBe('font/woff2')
    expect(contentType('x.exe')).toBe('application/octet-stream')
    expect(contentType('noext')).toBe('application/octet-stream')
  })
})
