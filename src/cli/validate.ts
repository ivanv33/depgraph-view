import { loadGraphFile, resolveGraphPath } from '../server/loader.js'
import type { Io } from './main.js'

/** `depgraph-view validate` exits with these: loaded clean, loaded with warnings, refused (as for a usage error). */
export const VALIDATE_EXIT = { clean: 0, warnings: 1, refused: 2 } as const

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** The one stdout line of a plan that loaded, such as `Vegetable garden: 3 steps, 2 links, no warnings`. */
export function summaryLine(name: string, steps: number, links: number, warnings: number): string {
  return `${name}: ${count(steps, 'step')}, ${count(links, 'link')}, ${warnings === 0 ? 'no warnings' : count(warnings, 'warning')}`
}

/**
 * Loads the plan at `path` as the server does, once, and reports it: a refusal as `depgraph-view: <message>`
 * and each warning as `warning: <message>` on stderr (the server's own lines), then the summary (or with
 * `json` one JSON object) on stdout. Returns the exit code; starts no server, watches nothing, never throws.
 */
export function validate(path: string, json: boolean, io: Io): number {
  let result
  try {
    result = loadGraphFile(resolveGraphPath(path))
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    io.err(`depgraph-view: ${message}`)
    if (json) io.out(JSON.stringify({ name: null, steps: 0, links: 0, warnings: [], errors: [message] }))
    return VALIDATE_EXIT.refused
  }
  const { plan, warnings } = result
  for (const w of warnings) io.err(`warning: ${w}`)
  const links = plan.nodes.reduce((n, node) => n + node.depends_on.length, 0)
  io.out(json ? JSON.stringify({ name: plan.name, steps: plan.nodes.length, links, warnings, errors: [] }) : summaryLine(plan.name, plan.nodes.length, links, warnings.length))
  return warnings.length ? VALIDATE_EXIT.warnings : VALIDATE_EXIT.clean
}
