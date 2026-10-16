import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type FixtureStep = {
  id: string
  title: string
  status?: string
  depends_on: string[]
  body?: string
  files?: Record<string, string | Buffer>
}

/** A fresh empty folder in the OS temp dir; the caller removes it. */
export function newFixtureDir(): string {
  return mkdtempSync(join(tmpdir(), 'depgraph-view-'))
}

/**
 * Writes a plan folder into `dir`: `graph.json` named `name`, and for each step its md file at `nodes/<id>/<id>.md`
 * with its files beside it (the md folder is the step's folder). Each id in `extra.missing` is listed in graph.json
 * with an md path that is never written.
 */
export function writeFixture(dir: string, name: string, steps: FixtureStep[], extra: { missing?: string[] } = {}): void {
  const nodes = [
    ...steps.map(s => ({ id: s.id, md: `nodes/${s.id}/${s.id}.md`, dir: `nodes/${s.id}`, depends_on: s.depends_on })),
    ...(extra.missing ?? []).map(id => ({ id, md: `nodes/${id}/${id}.md`, depends_on: [] as string[] })),
  ]
  writeFileSync(join(dir, 'graph.json'), JSON.stringify({ name, nodes }, null, 2))
  for (const s of steps) {
    const folder = join(dir, 'nodes', s.id)
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, `${s.id}.md`), `---\ntitle: ${s.title}\nstatus: ${s.status ?? 'todo'}\n---\n${s.body ?? ''}`)
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
    },
    { id: 'sow-beans', title: 'Sow the beans', depends_on: ['build-bed', 'pick-seeds'] },
    { id: 'water-rota', title: 'Write a watering rota', depends_on: ['sow-beans'] },
  ]
}
