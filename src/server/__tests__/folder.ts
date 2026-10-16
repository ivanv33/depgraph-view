import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const made: string[] = []

/** A temp folder holding `files` (keys are relative paths); returns its realpath. `removeFolders` deletes it. */
export function makeFolder(files: Record<string, string | Buffer>): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'depgraph-view-')))
  made.push(dir)
  for (const [rel, content] of Object.entries(files)) {
    const file = join(dir, rel)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, content)
  }
  return dir
}

/** Deletes every folder `makeFolder` made so far. */
export function removeFolders(): void {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
}
