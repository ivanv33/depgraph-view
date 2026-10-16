import { startServer, type RunningServer } from '../server/index.js'
import { isLoopback } from '../server/urls.js'
import { parseArgs } from './args.js'
import { openBrowser } from './open.js'

export interface Io {
  out(line: string): void
  err(line: string): void
}

/**
 * Runs `depgraph-view` with `argv` (the arguments after the program name). Code 0 without a server after
 * printing the usage for `-h`/`--help`, 2 on a usage error, 1 when the server cannot start, 0 with the
 * running server otherwise. Prints every URL to stdout (the first is the one `--open` opens) and, for a bind
 * beyond loopback, a warning to stderr. Never throws, never exits;
 * `open` is how `--open` shows the page (tests pass their own).
 */
export async function run(argv: string[], io: Io, open: (url: string) => void = openBrowser): Promise<{ code: number; server?: RunningServer }> {
  const args = parseArgs(argv)
  if ('help' in args) {
    io.out(args.help)
    return { code: 0 }
  }
  if ('error' in args) {
    io.err(args.error)
    return { code: 2 }
  }
  let server: RunningServer
  try {
    server = await startServer({ path: args.path, port: args.port, host: args.host, watch: args.watch })
  } catch (e) {
    // GraphError, PortInUseError and any I/O or watcher error alike: one line, code 1.
    io.err(`depgraph-view: ${e instanceof Error ? e.message : String(e)}`)
    return { code: 1 }
  }
  for (const url of server.urls) io.out(url)
  const host = args.host ?? '127.0.0.1'
  if (!isLoopback(host)) io.err(`warning: serving on ${host}; anyone who can reach this port can read the plan and every node folder`)
  for (const w of server.warnings) io.err(`warning: ${w}`)
  if (args.open) open(server.url)
  return { code: 0, server }
}
