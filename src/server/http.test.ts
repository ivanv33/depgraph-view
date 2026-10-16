import { symlinkSync } from 'node:fs'
import { createServer, request, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeFolder, removeFolders } from './__tests__/folder.js'
import { contentType, createHandler } from './http.js'
import type { GraphSource } from './live.js'
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

let root: string
let distDir: string
let server: RunningServer

beforeEach(async () => {
  const outside = makeFolder({ 'secret.txt': 'not for the page' })
  distDir = makeFolder({ 'index.html': '<!doctype html><title>viewer</title>', 'assets/app-abc123.js': 'console.log(1)', 'viewer.css': 'body{}' })
  root = makeFolder({
    'graph.json': JSON.stringify({ name: 'Garden', nodes: [{ id: 'a', md: 'a.md', dir: 'ctx/a' }] }),
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
  })
  it('serves the graph without folder paths', async () => {
    const body = await (await fetch(`${server.url}api/graph`)).json()
    expect(Object.keys(body).sort()).toEqual(['bodies', 'generatedAt', 'plan', 'resources', 'warnings'])
    expect(JSON.stringify(body)).not.toContain(root)
  })
  it('serves a node file and 404s traversal and symlinks out', async () => {
    expect((await fetch(`${server.url}files/a/notes.txt`)).status).toBe(200)
    for (const p of ['files/a/../graph.json', 'files/a/%2e%2e/graph.json', 'files/a/../../graph.json', 'files/a/%2e%2e/%2e%2e/graph.json'])
      expect(await rawStatus(server.url, `/${p}`), p).toBe(404)
    for (const p of ['files/a/..%2fgraph.json', 'files/a/..%2f..%2fgraph.json', 'files/a/link-out/secret.txt', 'files/ghost/x.txt', 'files/a/'])
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
})

describe('createHandler', () => {
  let bare: Server
  afterEach(() => new Promise<void>(resolve => bare.close(() => resolve())))
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
