import { createServer } from 'node:net'

/** A port the caller named is already taken. */
export class PortInUseError extends Error {}

const MAX_PORT = 65535

/** Whether `port` binds on 127.0.0.1 right now; other errors than EADDRINUSE reject. */
function free(port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', (e: NodeJS.ErrnoException) => (e.code === 'EADDRINUSE' ? resolve(false) : reject(e)))
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)))
  })
}

/** The first port from `start` that binds on 127.0.0.1. */
export async function findPort(start: number): Promise<number> {
  for (let port = start; port <= MAX_PORT; port++) if (await free(port)) return port
  throw new PortInUseError(`no free port from ${start}`)
}
