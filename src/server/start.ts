import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { networkInterfaces } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createHandler } from './http.js'
import { staticSource, watchedSource } from './live.js'
import { resolveGraphPath } from './loader.js'
import { findPort, PortInUseError } from './port.js'
import { isLoopback, serverUrls } from './urls.js'

export interface ServerOptions {
  path: string
  port?: number
  /** The address or name to bind; `127.0.0.1` when absent. */
  host?: string
  watch?: boolean
  distDir?: string
}

export interface RunningServer {
  /** The URL to open: `urls[0]`. */
  url: string
  /** Every URL the server is reachable at; more than one only for a wildcard bind on a machine with several LAN addresses. */
  urls: string[]
  port: number
  warnings: string[]
  close(): Promise<void>
}

const DEFAULT_PORT = 4310
/** The built page, at the same depth from `src/server` and `lib/server`. */
const DEFAULT_DIST = fileURLToPath(new URL('../../dist/', import.meta.url))

/**
 * Loads the graph at `options.path` and serves it on `options.host` (127.0.0.1 by default). A loopback bind
 * refuses requests whose Host header is not a loopback name; any other bind accepts every Host. Without `port` it takes the first free
 * port from 4310; a given port (0 included) is used as is and a taken one rejects with PortInUseError.
 * Unless `watch` is false it follows the graph's files and pushes changes on `/events`.
 * Throws GraphError when the graph cannot be loaded.
 */
export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const planPath = resolveGraphPath(options.path)
  const watched = options.watch === false ? null : watchedSource(planPath)
  const source = watched ?? staticSource(planPath)
  const host = options.host ?? '127.0.0.1'
  const loopback = isLoopback(host)
  // The handler refuses a missing Host itself (403, nosniff) instead of Node's bare 400.
  const server = createServer({ requireHostHeader: false }, createHandler(source, options.distDir ?? DEFAULT_DIST, { checkHost: loopback }))
  try {
    await watched?.ready()
    const wanted = options.port ?? (await findPort(DEFAULT_PORT))
    await new Promise<void>((resolve, reject) => {
      const onError = (e: NodeJS.ErrnoException) => reject(e.code === 'EADDRINUSE' ? new PortInUseError(`port ${wanted} is in use`) : e)
      server.once('error', onError)
      server.listen(wanted, host.replace(/^\[(.*)\]$/, '$1'), () => {
        server.off('error', onError)
        resolve()
      })
    })
  } catch (e) {
    await source.close()
    throw e
  }
  const bound = server.address() as AddressInfo
  const port = bound.port
  // Loopback and wildcard binds are named by the address actually bound (`localhost` may land on ::1).
  const urls = serverUrls({ host: loopback || bound.address === '0.0.0.0' || bound.address === '::' ? bound.address : host, port, interfaces: networkInterfaces() })
  return {
    url: urls[0],
    urls,
    port,
    warnings: source.current().result.warnings,
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
      await source.close()
    },
  }
}
