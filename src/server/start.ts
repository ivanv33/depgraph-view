import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { createHandler } from './http.js'
import { staticSource } from './live.js'
import { resolveGraphPath } from './loader.js'
import { findPort, PortInUseError } from './port.js'

export interface ServerOptions {
  path: string
  port?: number
  watch?: boolean
  distDir?: string
}

export interface RunningServer {
  url: string
  port: number
  warnings: string[]
  close(): Promise<void>
}

const DEFAULT_PORT = 4310
/** The built page, at the same depth from `src/server` and `lib/server`. */
const DEFAULT_DIST = fileURLToPath(new URL('../../dist/', import.meta.url))

/**
 * Loads the graph at `options.path` and serves it on 127.0.0.1. Without `port` it takes the first free
 * port from 4310; a given port (0 included) is used as is and a taken one rejects with PortInUseError.
 * Throws GraphError when the graph cannot be loaded.
 */
export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const source = staticSource(resolveGraphPath(options.path))
  const server = createServer(createHandler(source, options.distDir ?? DEFAULT_DIST))
  try {
    const wanted = options.port ?? (await findPort(DEFAULT_PORT))
    await new Promise<void>((resolve, reject) => {
      const onError = (e: NodeJS.ErrnoException) => reject(e.code === 'EADDRINUSE' ? new PortInUseError(`port ${wanted} is in use`) : e)
      server.once('error', onError)
      server.listen(wanted, '127.0.0.1', () => {
        server.off('error', onError)
        resolve()
      })
    })
  } catch (e) {
    await source.close()
    throw e
  }
  const port = (server.address() as AddressInfo).port
  return {
    url: `http://127.0.0.1:${port}/`,
    port,
    warnings: source.current().result.warnings,
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
      await source.close()
    },
  }
}
