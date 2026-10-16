import { readdirSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'

/** Whether `p` is `base` or lies below it; both absolute. */
export function within(base: string, p: string): boolean {
  const rel = path.relative(base, p)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
}

const realpath = (p: string): string | null => {
  try {
    return realpathSync(p)
  } catch {
    return null
  }
}

/** The realpath of `root/rel` when it exists and lies inside `realpath(root)` (or equals it), else null. */
export function insideRoot(root: string, rel: string): string | null {
  const realRoot = realpath(root)
  const real = realpath(path.resolve(root, rel))
  return realRoot !== null && real !== null && within(realRoot, real) ? real : null
}

const SKIPPED = new Set(['.git', 'node_modules'])

/**
 * Every file below `folder` as a POSIX-style relative path, sorted by `<`, cut at `limit`.
 * Skips `.git` and `node_modules` folders and any entry whose realpath leaves `folder`;
 * a folder reached twice through symlinks is walked once; a subfolder that cannot be read is skipped.
 */
export function listFiles(folder: string, limit = 500): { files: string[]; truncated: boolean } {
  const realFolder = realpathSync(folder)
  const files: string[] = []
  const walked = new Set<string>()
  const walk = (realDir: string, prefix: string) => {
    if (walked.has(realDir)) return
    walked.add(realDir)
    let names: string[]
    try {
      names = readdirSync(realDir)
    } catch (e) {
      if (prefix === '') throw e // the node folder itself unreadable is the caller's error
      return // one unreadable subfolder skips that entry, not the whole list
    }
    for (const name of names) {
      const real = realpath(path.join(realDir, name))
      if (real === null || !within(realFolder, real)) continue
      let stat
      try {
        stat = statSync(real)
      } catch {
        continue // gone or unreadable between readdir and stat
      }
      if (stat.isDirectory()) {
        if (!SKIPPED.has(name)) walk(real, `${prefix}${name}/`)
      } else if (stat.isFile()) {
        files.push(`${prefix}${name}`)
      }
    }
  }
  walk(realFolder, '')
  files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return { files: files.slice(0, limit), truncated: files.length > limit }
}
