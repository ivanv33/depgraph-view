export interface CliArgs {
  path: string
  port?: number
  open: boolean
  watch: boolean
}

export const USAGE = `usage: depgraph-view <path> [--port N] [--open] [--no-watch]

  <path>      a graph JSON file, or a folder holding exactly one top-level JSON file
  --port N    serve on port N (0-65535); without it the first free port from 4310
  --open      open the page in the default browser
  --no-watch  serve the graph as loaded, without following file changes
  -h, --help  show this help`

const MAX_PORT = 65535

/** The command line after the program name, `{ help }` with the usage for stdout, or `{ error }` with a message for stderr. */
export function parseArgs(argv: string[]): CliArgs | { help: string } | { error: string } {
  let path: string | undefined
  let port: number | undefined
  let open = false
  let watch = true
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-h' || a === '--help') return { help: USAGE }
    if (a === '--open') open = true
    else if (a === '--no-watch') watch = false
    else if (a === '--port') {
      const v = argv[++i]
      if (v === undefined || !/^\d+$/.test(v) || Number(v) > MAX_PORT) return { error: `--port takes an integer from 0 to ${MAX_PORT}\n\n${USAGE}` }
      port = Number(v)
    } else if (a.startsWith('-')) return { error: `unknown option ${a}\n\n${USAGE}` }
    else if (path !== undefined) return { error: `one path only, got ${path} and ${a}\n\n${USAGE}` }
    else path = a
  }
  if (path === undefined) return { error: USAGE }
  return port === undefined ? { path, open, watch } : { path, port, open, watch }
}
