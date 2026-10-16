import { createReadStream, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import type { GraphSource, LiveEvent } from './live.js'
import { insideRoot } from './paths.js'

const TEXT = 'text/plain; charset=utf-8'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': TEXT,
  '.txt': TEXT,
  '.csv': TEXT,
  '.log': TEXT,
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.woff2': 'font/woff2',
}

/** The Content-Type for `file` by its extension, from a fixed allowlist; anything else is octet-stream. */
export function contentType(file: string): string {
  return TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
}

const PAGE_CSP = "default-src 'self'; img-src 'self' blob: data:; connect-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; worker-src 'self' blob:"
const FILE_CSP = "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'"
const IMMUTABLE = 'public, max-age=31536000, immutable'

type Headers = Record<string, string | number>

function send(req: IncomingMessage, res: ServerResponse, status: number, headers: Headers, body: string | Buffer): void {
  const buf = typeof body === 'string' ? Buffer.from(body) : body
  res.writeHead(status, { ...headers, 'Content-Length': buf.length })
  res.end(req.method === 'HEAD' ? undefined : buf)
}

const notFound = (req: IncomingMessage, res: ServerResponse) => send(req, res, 404, { 'Content-Type': TEXT }, 'Not found\n')

/** Streams the regular file at the realpath `file`, or 404s when it is not one. */
function sendFile(req: IncomingMessage, res: ServerResponse, file: string | null, headers: Headers): void {
  const stat = file === null ? undefined : statSync(file, { throwIfNoEntry: false })
  if (file === null || !stat?.isFile()) return notFound(req, res)
  res.writeHead(200, { ...headers, 'Content-Length': stat.size })
  if (req.method === 'HEAD') return void res.end()
  createReadStream(file).on('error', () => res.destroy()).pipe(res)
}

/** `segments` decoded once each and joined with `/`, or null when one does not decode. */
function decodeSegments(segments: string[]): string | null {
  try {
    return segments.map(s => decodeURIComponent(s)).join('/')
  } catch {
    return null
  }
}

/** One Server-Sent Events frame: the event name and its JSON payload. */
function frame(e: LiveEvent): string {
  const data = e.type === 'reload' ? { generatedAt: e.generatedAt } : { message: e.message }
  return `event: ${e.type}\ndata: ${JSON.stringify(data)}\n\n`
}

/** Holds the response open and writes every event of `source` until the client goes. */
function sendEvents(source: GraphSource, req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  if (req.method === 'HEAD') return void res.end()
  res.write('retry: 1000\n\n')
  // A page that joins while the graph is broken sees the banner without waiting for the next change.
  const error = source.error?.() ?? null
  if (error !== null) res.write(frame({ type: 'error', message: error }))
  const off = source.on(e => res.write(frame(e)))
  res.on('close', off)
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

/** Whether the Host header names this machine: `127.0.0.1`, `localhost` or `[::1]`, with or without a port. */
function loopbackHost(host: string | undefined): boolean {
  if (host === undefined) return false
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':', 1)[0]
  return LOOPBACK_HOSTS.has(name.toLowerCase())
}

function route(source: GraphSource, distDir: string, checkHost: boolean, req: IncomingMessage, res: ServerResponse): void {
  // DNS rebinding: a page on another origin that resolves its name to 127.0.0.1 still sends its own Host.
  if (checkHost && !loopbackHost(req.headers.host)) return send(req, res, 403, { 'Content-Type': TEXT }, 'Forbidden\n')
  if (req.method !== 'GET' && req.method !== 'HEAD')
    return send(req, res, 405, { 'Content-Type': TEXT, Allow: 'GET, HEAD' }, 'Method not allowed\n')
  // The raw path, not a WHATWG URL: URL parsing would resolve `..` and `%2e%2e` before the guard sees them.
  const rawPath = (req.url ?? '/').split(/[?#]/, 1)[0]
  if (rawPath === '/') return sendFile(req, res, insideRoot(distDir, 'index.html'), { 'Content-Type': contentType('index.html'), 'Cache-Control': 'no-cache', 'Content-Security-Policy': PAGE_CSP })
  if (rawPath === '/viewer.css') return sendFile(req, res, insideRoot(distDir, 'viewer.css'), { 'Content-Type': contentType('viewer.css') })
  if (rawPath === '/api/graph') {
    const { result, generatedAt } = source.current()
    const { plan, resources, warnings, bodies } = result
    const json = JSON.stringify({ plan, resources, warnings, bodies, generatedAt })
    return send(req, res, 200, { 'Content-Type': contentType('graph.json'), 'Cache-Control': 'no-store' }, json)
  }
  if (rawPath === '/events') return sendEvents(source, req, res)
  const [, head, ...rest] = rawPath.split('/')
  if (head === 'assets' && rest.length > 0) {
    const rel = decodeSegments(rest)
    if (rel === null) return notFound(req, res)
    const file = insideRoot(path.join(distDir, 'assets'), rel)
    return sendFile(req, res, file, { 'Content-Type': contentType(rel), 'Cache-Control': IMMUTABLE })
  }
  if (head === 'files' && rest.length > 1) {
    const [id, ...relSegments] = rest
    const decodedId = decodeSegments([id])
    const rel = decodeSegments(relSegments)
    const folders = source.current().result.folders
    if (decodedId === null || rel === null || !Object.hasOwn(folders, decodedId)) return notFound(req, res)
    // The same folders the resources list skips.
    if (rel.split(/[\\/]/).some(seg => seg === '.git' || seg === 'node_modules')) return notFound(req, res)
    const type = contentType(rel)
    return sendFile(req, res, insideRoot(folders[decodedId], rel), {
      'Content-Type': type.startsWith('text/html') ? TEXT : type,
      'Content-Security-Policy': FILE_CSP,
    })
  }
  return notFound(req, res)
}

/**
 * The request listener: read-only routes over the graph in `source` and the built page in `distDir`.
 * `checkHost` (on by default) refuses a request whose Host is not a loopback name; a server bound beyond
 * loopback turns it off, since its clients name it by a LAN address.
 */
export function createHandler(source: GraphSource, distDir: string, { checkHost = true }: { checkHost?: boolean } = {}): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    try {
      route(source, distDir, checkHost, req, res)
    } catch {
      // Never echo the error: I/O messages carry absolute paths.
      if (res.headersSent) res.destroy()
      else send(req, res, 500, { 'Content-Type': TEXT }, 'Internal server error\n')
    }
  }
}
