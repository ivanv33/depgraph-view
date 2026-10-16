import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { stringify } from 'yaml'

export type FixtureStep = {
  id: string
  title: string
  status?: string
  depends_on: string[]
  body?: string
  files?: Record<string, string | Buffer>
  /** An md path and folder other than the default `nodes/<id>.context/<id>.md` and `nodes/<id>.context`. */
  at?: { md: string; dir: string }
}

/** A fresh empty folder in the OS temp dir; the caller removes it. */
export function newFixtureDir(): string {
  return mkdtempSync(join(tmpdir(), 'depgraph-view-'))
}

/**
 * Writes a plan folder into `dir`: `graph.yaml` named `name`, and for each step its md file at the default
 * `nodes/<id>.context/<id>.md` with its files beside it, or, for a step with `at`, its md at `at.md` and its files in
 * `at.dir` (both listed in graph.yaml). Each id in `extra.missing` is listed with an explicit md path that is never
 * written, so the viewer drops it with `md not found`.
 */
export function writeFixture(dir: string, name: string, steps: FixtureStep[], extra: { missing?: string[] } = {}): void {
  const nodes: Record<string, { needs?: string[]; md?: string; dir?: string }> = {}
  for (const s of steps) nodes[s.id] = s.at ? { needs: s.depends_on, md: s.at.md, dir: s.at.dir } : { needs: s.depends_on }
  for (const id of extra.missing ?? []) nodes[id] = { md: `nodes/${id}.context/${id}.md` }
  writeFileSync(join(dir, 'graph.yaml'), stringify({ name, nodes }))
  for (const s of steps) {
    const md = join(dir, s.at?.md ?? `nodes/${s.id}.context/${s.id}.md`)
    const folder = join(dir, s.at?.dir ?? `nodes/${s.id}.context`)
    mkdirSync(dirname(md), { recursive: true })
    mkdirSync(folder, { recursive: true })
    writeFileSync(md, `---\ntitle: ${s.title}\nstatus: ${s.status ?? 'todo'}\n---\n${s.body ?? ''}`)
    for (const [file, content] of Object.entries(s.files ?? {})) writeFileSync(join(folder, file), content)
  }
}

/** A valid 1×1 transparent PNG. */
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

/** A fictional six-step garden plan. */
export function gardenSteps(): FixtureStep[] {
  return [
    { id: 'plan-bed', title: 'Plan the vegetable bed', depends_on: ['buy-boards', 'pick-seeds'] },
    { id: 'buy-boards', title: 'Buy the boards', depends_on: [] },
    { id: 'pick-seeds', title: 'Pick the seeds', depends_on: [] },
    {
      id: 'build-bed',
      title: 'Build the bed',
      depends_on: ['buy-boards'],
      body: '# Build notes\nUse the spare boards. ![sketch](sketch.png) [Cut list](cut-list.txt)',
      files: { 'sketch.png': PIXEL_PNG, 'cut-list.txt': 'Four boards, 1.2 m each.\n' },
      at: { md: 'notes/build-bed.md', dir: 'notes/build-bed' },
    },
    { id: 'sow-beans', title: 'Sow the beans', depends_on: ['build-bed', 'pick-seeds'] },
    { id: 'water-rota', title: 'Write a watering rota', depends_on: ['sow-beans'] },
  ]
}
