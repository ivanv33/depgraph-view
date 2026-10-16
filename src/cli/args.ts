export interface CliArgs {
  path: string
  port?: number
  host?: string
  open: boolean
  watch: boolean
}

/** `depgraph-view validate <path> [--json]`. */
export interface ValidateArgs {
  command: 'validate'
  path: string
  json: boolean
}

export const USAGE = `usage: depgraph-view <path> [--port N] [--host ADDR] [--open] [--no-watch]
       depgraph-view validate <path> [--json]

  <path>       a plan YAML file, or a folder holding it
  --port N     serve on port N (0-65535); without it the first free port from 4310
  --host ADDR  bind ADDR (default 127.0.0.1); 0.0.0.0 serves the whole network
  --open       open the page in the default browser
  --no-watch   serve the graph as loaded, without following file changes
  validate     load the plan once and exit, serving nothing: problems on stderr,
               a summary on stdout; exit 0 clean, 1 with warnings, 2 refused
  --json       with validate, print the summary as one JSON object
  -h, --help   show this help`

const MAX_PORT = 65535

/** The command line after the program name, `{ help }` with the usage for stdout, or `{ error }` with a message for stderr. */
export function parseArgs(argv: string[]): CliArgs | ValidateArgs | { help: string } | { error: string } {
  if (argv[0] === 'validate') return parseValidateArgs(argv.slice(1))
  let path: string | undefined
  let port: number | undefined
  let host: string | undefined
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
    } else if (a === '--host') {
      const v = argv[++i]
      if (v === undefined || v === '') return { error: `--host takes an address or host name\n\n${USAGE}` }
      host = v
    } else if (a.startsWith('-')) return { error: `unknown option ${a}\n\n${USAGE}` }
    else if (path !== undefined) return { error: `one path only, got ${path} and ${a}\n\n${USAGE}` }
    else path = a
  }
  if (path === undefined) return { error: USAGE }
  return { path, ...(host === undefined ? {} : { host }), ...(port === undefined ? {} : { port }), open, watch }
}

/** The arguments after `validate`. */
function parseValidateArgs(argv: string[]): ValidateArgs | { help: string } | { error: string } {
  let path: string | undefined
  let json = false
  for (const a of argv) {
    if (a === '-h' || a === '--help') return { help: USAGE }
    if (a === '--json') json = true
    else if (a.startsWith('-')) return { error: `validate does not take ${a}\n\n${USAGE}` }
    else if (path !== undefined) return { error: `one path only, got ${path} and ${a}\n\n${USAGE}` }
    else path = a
  }
  if (path === undefined) return { error: USAGE }
  return { command: 'validate', path, json }
}
