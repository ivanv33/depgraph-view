import { startServer, type RunningServer } from '../server/index.js'
import { parseArgs } from './args.js'
import { openBrowser } from './open.js'

export interface Io {
  out(line: string): void
  err(line: string): void
}

/**
 * Runs `depgraph-view` with `argv` (the arguments after the program name). Code 2 on a usage error,
 * 1 when the server cannot start, 0 with the running server otherwise. Never throws, never exits;
 * `open` is how `--open` shows the page (tests pass their own).
 */
export async function run(argv: string[], io: Io, open: (url: string) => void = openBrowser): Promise<{ code: number; server?: RunningServer }> {
  const args = parseArgs(argv)
  if ('error' in args) {
    io.err(args.error)
    return { code: 2 }
  }
  let server: RunningServer
  try {
    server = await startServer({ path: args.path, port: args.port, watch: args.watch })
  } catch (e) {
    // GraphError, PortInUseError and any I/O or watcher error alike: one line, code 1.
    io.err(`depgraph-view: ${e instanceof Error ? e.message : String(e)}`)
    return { code: 1 }
  }
  io.out(server.url)
  for (const w of server.warnings) io.err(`warning: ${w}`)
  if (args.open) open(server.url)
  return { code: 0, server }
}
