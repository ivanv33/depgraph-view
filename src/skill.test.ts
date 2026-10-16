import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { makeFolder, removeFolders } from './server/__tests__/folder.js'
import { COMMON_KEYS, splitNodeFile } from './server/frontmatter.js'
import { loadGraphFile, resolveGraphPath, type LoadResult } from './server/loader.js'
import { parseGraphYaml } from './server/planYaml.js'

// The repo root from this file, as in pack.test.ts.
const repo = fileURLToPath(new URL('..', import.meta.url))
const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')) as { version: string; repository: string }
const skillDir = join(repo, 'skills/depgraph')
const read = (rel: string) => readFileSync(join(repo, rel), 'utf8')

/** The fence languages the skill uses: a plan that must load, a card that must load, a command, anything else. */
const LANGS = ['yaml', 'markdown', 'sh', 'text'] as const
type Lang = (typeof LANGS)[number]

/** The three files of the skill; the two references come in later tasks, and their tests stay red until then. */
const SKILL_MD = 'skills/depgraph/SKILL.md'
const FORMAT_MD = 'skills/depgraph/references/format.md'
const VIEWER_MD = 'skills/depgraph/references/viewer.md'

/** The description the design spec fixes, verbatim. */
const DESCRIPTION =
  'Build, change and show dependency plans for the depgraph-view viewer: a plan folder holding one YAML file that lists each step and the steps it needs, plus one markdown card per step. Use this skill whenever the user wants to lay out a goal, project or roadmap as steps with dependencies; start a new plan; add, link, unlink, rename or delete a step; mark a step todo, doing, done or blocked; set a step\'s title, tags, due date, priority or hold; check a plan for cycles, bad ids or missing cards; or says "show me the plan", "open the graph" or "run the viewer", even if they never say depgraph. Also use it whenever a folder holds a YAML file with a nodes mapping next to a nodes folder of .context folders. Not for prose implementation plans, task lists without dependencies, or package dependency graphs.'

/** Every `.md` file under skills/depgraph/, path relative to the repo. */
function skillFiles(): { path: string; text: string }[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.md') ? [join(dir, e.name)] : []))
  return walk(skillDir)
    .sort()
    .map(file => ({ path: relative(repo, file), text: readFileSync(file, 'utf8') }))
}

/** Every fenced block in `text`: its info string and its body (with a final newline), in order. */
function allFences(text: string): { lang: string; body: string }[] {
  const out: { lang: string; body: string }[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const open = /^(\s*)(`{3,})(.*)$/.exec(lines[i])
    if (!open) continue
    const [, indent, ticks, info] = open
    const body: string[] = []
    let j = i + 1
    while (j < lines.length && !new RegExp(`^\\s*${ticks}\`*\\s*$`).test(lines[j])) body.push(lines[j++].replace(new RegExp(`^ {0,${indent.length}}`), ''))
    if (j === lines.length) throw new Error(`unclosed fence at line ${i + 1}`)
    out.push({ lang: info.trim(), body: body.join('\n') + '\n' })
    i = j
  }
  return out
}

/** The bodies of the fenced blocks in `text` whose info string is `lang`. */
function fences(text: string, lang: Lang): string[] {
  return allFences(text)
    .filter(f => f.lang === lang)
    .map(f => f.body)
}

/** The text between a card's opening and closing `---`, or null when it has none. */
function frontmatterOf(card: string): string | null {
  return splitNodeFile(card).frontmatter
}

/** Writes `files` to a temp folder and loads the plan at `target` inside it, as the viewer would. */
function loadIn(files: Record<string, string>, target = '.'): LoadResult {
  const dir = makeFolder(files)
  return loadGraphFile(resolveGraphPath(join(dir, target)))
}

/** Dates (which YAML 1.1 makes of `2027-03-01`) as their `YYYY-MM-DD` text, everywhere in `v`. */
function norm(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (Array.isArray(v)) return v.map(norm)
  if (v !== null && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, norm(x)]))
  return v
}

/** A YAML 1.1 reader and the viewer's YAML 1.2 reader see the same values in `text`. */
function sameIn11And12(text: string): void {
  expect(norm(parse(text, { version: '1.1' }))).toEqual(norm(parse(text, { version: '1.2' })))
}

/** The fence rule for one skill file; a file that does not exist yet fails here. */
function expectFenceConvention(rel: string): void {
  const langs = allFences(read(rel)).map(f => f.lang)
  expect(langs.filter(l => !(LANGS as readonly string[]).includes(l)), `${rel}: fences outside ${LANGS.join('|')}`).toEqual([])
}

const SECTIONS = [
  '## The shape',
  '## The card',
  '## Quoting',
  '## Operations',
  '### Start a plan',
  '### Add a step',
  '### Link',
  '### Unlink',
  '### Rename a step',
  '### Delete a step',
  '### Edit a card',
  '### Check the plan',
  '## Showing the plan',
  '## Never',
]

const PLAY_IDS = ['choose-play', 'book-hall', 'hold-auditions', 'cast-roles', 'build-set', 'sew-costumes', 'rehearse', 'opening-night']

afterEach(() => removeFolders())

describe('the depgraph skill', () => {
  it('SKILL.md has valid skill frontmatter', () => {
    const text = read(SKILL_MD)
    const fm = parse(frontmatterOf(text) ?? '') as Record<string, unknown>
    expect(Object.keys(fm).filter(k => !['name', 'description', 'license', 'compatibility'].includes(k))).toEqual([])
    expect(fm.name).toBe('depgraph')
    expect(fm.license).toBe('MIT')
    expect(fm.compatibility).toBe('Node 20.19 or newer and npx; the first viewer run downloads and builds the viewer from GitHub.')
    expect(fm.description).toBe(DESCRIPTION)
    expect(DESCRIPTION.length).toBeLessThanOrEqual(1024)
    expect(DESCRIPTION).not.toMatch(/[<>]/)
    expect(text.split('\n').length).toBeLessThanOrEqual(500)
  })

  it('pins the viewer to this package version everywhere', () => {
    const files = skillFiles()
    const pins = (text: string) => [...text.matchAll(/#v(\d+\.\d+\.\d+)/g)].map(m => m[0])
    const want = `#v${pkg.version}`
    expect(files.flatMap(f => pins(f.text).filter(p => p !== want).map(p => `${f.path}: ${p}`))).toEqual([])
    expect(pins(read('README.md')).filter(p => p !== want)).toEqual([])
    expect(pins(read(SKILL_MD)).length).toBeGreaterThan(0)
    const unpinned = files.flatMap(f => f.text.split(pkg.repository).slice(1).filter(after => !after.startsWith('#v')).map(after => `${f.path}: ${pkg.repository}${after.slice(0, 20)}`))
    expect(unpinned).toEqual([])
  })

  it('SKILL.md has the sections in order', () => {
    const lines = read(SKILL_MD).split('\n')
    expect(lines.filter(l => SECTIONS.includes(l))).toEqual(SECTIONS)
    const start = lines.indexOf('## Never')
    const end = lines.findIndex((l, i) => i > start && /^#{1,2} /.test(l))
    const bullets = lines.slice(start + 1, end === -1 ? undefined : end).filter(l => l.startsWith('- '))
    expect(bullets).toHaveLength(11)
  })

  it('SKILL.md fences are yaml, markdown, sh or text, with at least one plan and one card', () => {
    expectFenceConvention(SKILL_MD)
    const text = read(SKILL_MD)
    expect(fences(text, 'yaml').length).toBeGreaterThan(0)
    expect(fences(text, 'markdown').length).toBeGreaterThan(0)
  })

  // Expected red until Task 2 writes references/format.md.
  it('references/format.md fences are yaml, markdown, sh or text, with at least one plan', () => {
    expectFenceConvention(FORMAT_MD)
    expect(fences(read(FORMAT_MD), 'yaml').length).toBeGreaterThan(0)
  })

  // Expected red until Task 3 writes references/viewer.md.
  it('references/viewer.md fences are yaml, markdown, sh or text', () => {
    expectFenceConvention(VIEWER_MD)
  })

  it('every yaml block is a plan that loads with no warnings', () => {
    for (const f of skillFiles())
      for (const block of fences(f.text, 'yaml')) expect(parseGraphYaml(block).warnings, `${f.path}:\n${block}`).toEqual([])
  })

  it('every markdown block is a card that loads with no warnings', () => {
    for (const f of skillFiles())
      for (const block of fences(f.text, 'markdown')) {
        const r = loadIn({ 'card/card.yaml': 'name: Card check\nnodes:\n  card: {}\n', 'card/nodes/card.context/card.md': block }, 'card')
        expect(r.warnings, `${f.path}:\n${block}`).toEqual([])
        const keys = Object.keys(parse(frontmatterOf(block) ?? '') ?? {})
        expect(keys.filter(k => !(COMMON_KEYS as readonly string[]).includes(k)), block).toEqual([])
        expect(keys, block).toEqual(COMMON_KEYS.filter(k => keys.includes(k)))
        expect(keys, block).toEqual(expect.arrayContaining(['title', 'description', 'status', 'tags']))
      }
  })

  it('every example reads the same in YAML 1.1 and 1.2', () => {
    for (const f of skillFiles()) {
      for (const block of fences(f.text, 'yaml')) sameIn11And12(block)
      for (const block of fences(f.text, 'markdown')) sameIn11And12(frontmatterOf(block) ?? '')
    }
  })

  it('the school play example loads clean with a card at every step', () => {
    const text = read(SKILL_MD)
    const play = fences(text, 'yaml').find(b => (parse(b) as { name?: unknown } | null)?.name === 'Spring school play')
    expect(play).toBeDefined()
    expect(parseGraphYaml(play!).entries.map(e => e.id)).toEqual(PLAY_IDS)
    const card = fences(text, 'markdown')[0]
    const files: Record<string, string> = { 'play/play.yaml': play! }
    for (const id of PLAY_IDS) files[`play/nodes/${id}.context/${id}.md`] = card
    const r = loadIn(files, 'play')
    expect(r.warnings).toEqual([])
    expect(r.plan.nodes).toHaveLength(8)
    const needs = (id: string) => r.plan.nodes.find(n => n.id === id)?.depends_on
    expect(needs('rehearse')).toEqual(['build-set', 'cast-roles'])
    expect(needs('opening-night')).toEqual(['rehearse', 'sew-costumes'])
  })

  it('the helpers read fences and frontmatter as the skill writes them', () => {
    const doc = '```yaml\nname: x\n```\n\n```text\nbroken: [\n```\n'
    expect(fences(doc, 'yaml')).toEqual(['name: x\n'])
    expect(fences(doc, 'text')).toEqual(['broken: [\n'])
    expect(frontmatterOf('---\ntitle: A\n---\nbody\n')).toBe('title: A\n')
    expect(frontmatterOf('just text')).toBeNull()
  })
})
