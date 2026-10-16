import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { makeFolder, removeFolders } from './server/__tests__/folder.js'
import { ID_RE } from './engine/schema.js'
import { COMMON_KEYS, splitNodeFile } from './server/frontmatter.js'
import { loadGraphFile, resolveGraphPath, type LoadResult } from './server/loader.js'
import { parseGraphYaml } from './server/planYaml.js'
import { USAGE } from './cli/args.js'
import { summaryLine, VALIDATE_EXIT } from './cli/validate.js'

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

/** The first-cell message of every row in the table under `heading` (up to the next `## `); a row whose first cell is not one backticked message fails. */
function tableMessages(md: string, heading: '## Refusals' | '## Warnings'): string[] {
  const lines = md.split('\n')
  const start = lines.indexOf(heading)
  if (start === -1) throw new Error(`no ${heading} section`)
  const end = lines.findIndex((l, i) => i > start && /^#{1,2} /.test(l))
  const rows = lines.slice(start + 1, end === -1 ? undefined : end).filter(l => l.startsWith('|'))
  return rows.slice(2).map(row => {
    const m = /^\|\s*`([^`]+)`\s*\|/.exec(row)
    if (!m) throw new Error(`${heading}: first cell is not one backticked message: ${row}`)
    return m[1]
  })
}

/** A table cell as an anchored pattern: `<...>` matches any text, a standalone `L`, `C` or `N` any number. */
function messageRe(cell: string): RegExp {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const piece = (s: string) => s.split(/\b[LCN]\b/).map(esc).join('\\d+')
  return new RegExp(`^${cell.split(/<[^>]+>/).map(piece).join('.+?')}$`)
}

/** A one-step kitchen plan with `step` as the step's value and, unless null, `card` as its card's frontmatter. */
const kitchen = (step: string, card: string | null = 'title: Buy flour\n'): Record<string, string> => ({
  'kitchen.yaml': `name: Bake bread\nnodes:\n  buy-flour: ${step}\n`,
  ...(card === null ? {} : { 'nodes/buy-flour.context/buy-flour.md': `---\n${card}---\nFrom the corner shop.\n` }),
})
const plan = (nodes: string) => ({ 'kitchen.yaml': `name: Bake bread\nnodes:\n${nodes}` })

describe('references/format.md', () => {
  it('states the id pattern, the seven keys and their values', () => {
    const md = read(FORMAT_MD)
    for (const word of [ID_RE.source, ...COMMON_KEYS, 'todo', 'doing', 'done', 'blocked', 'low', 'normal', 'high']) expect(md, word).toContain(word)
  })

  it('every refusal in the table is what the loader prints', () => {
    const refusals: Record<string, { files: Record<string, string>; target?: string }> = {
      'graph must be a mapping': { files: { 'kitchen.yaml': '- buy-flour\n' } },
      'name must be a string': { files: { 'kitchen.yaml': 'nodes: {}\n' } },
      'name must be a string: quote it as "<name>"': { files: { 'kitchen.yaml': 'name: 2027\nnodes: {}\n' } },
      'nodes must be a mapping': { files: { 'kitchen.yaml': 'name: Bake bread\nnodes:\n  - buy-flour\n' } },
      'id "<id>" does not match ^[a-z0-9][a-z0-9-]*$': { files: plan('  Buy_Flour: {}\n') },
      'node id <id> is not a string: quote it as "<id>"': { files: plan('  2027: {}\n') },
      'node id must be a string such as dig-beds': { files: plan('  1.5: {}\n') },
      '<file>: Map keys must be unique at line L, column C': { files: plan('  buy-flour: {}\n  buy-flour: {}\n') },
      'node "<id>": must be a mapping or empty': { files: kitchen('[knead]') },
      'node "<id>": needs must be a list': { files: { ...plan('  knead: {needs: buy-flour}\n  buy-flour: {}\n') } },
      'node "<id>": needs must be a list of ids': { files: plan('  knead: {needs: [[buy-flour]]}\n  buy-flour: {}\n') },
      'node "<id>": needs item <id> is not a string: quote it as "<id>"': { files: plan('  knead: {needs: [2027]}\n') },
      'node "<id>": needs item must be a string such as dig-beds': { files: plan('  knead: {needs: [1.5]}\n') },
      'node "<id>": md must be a string': { files: kitchen('{md: 5}') },
      'node "<id>": dir must be a string': { files: kitchen('{dir: [shop]}') },
      'node "<id>": depends on itself': { files: kitchen('{needs: [buy-flour]}') },
      'cycle: <first> -> <next> -> <first>': {
        files: {
          ...plan('  knead: {needs: [prove]}\n  prove: {needs: [knead]}\n'),
          'nodes/knead.context/knead.md': '---\ntitle: Knead\n---\n',
          'nodes/prove.context/prove.md': '---\ntitle: Prove\n---\n',
        },
      },
      'node "<id>": title must be a string': { files: kitchen('{}', 'title: [Buy flour]\n') },
      'node "<id>": description must be a string': { files: kitchen('{}', 'description: {kind: strong}\n') },
      'node "<id>": invalid status "<status>"': { files: kitchen('{}', 'status: started\n') },
      'node "<id>": tags must be an array of strings': { files: kitchen('{}', 'tags: shopping\n') },
      'node "<id>": due must be a date YYYY-MM-DD': { files: kitchen('{}', 'due: 2027-02-30\n') },
      'node "<id>": invalid priority "<priority>"': { files: kitchen('{}', 'priority: urgent\n') },
      'node "<id>": hold must be 1-200 characters': { files: kitchen('{}', 'hold: ""\n') },
      'node "<id>": frontmatter is not closed': { files: { ...kitchen('{}', null), 'nodes/buy-flour.context/buy-flour.md': '---\ntitle: Buy flour\n' } },
      'node "<id>": frontmatter must be a mapping': { files: kitchen('{}', '- Buy flour\n') },
      'node "<id>": Map keys must be unique at line L, column C': { files: kitchen('{}', 'title: Buy flour\ntitle: Buy rye\n') },
      'node "<id>": Nested mappings are not allowed in compact mappings at line L, column C': { files: kitchen('{}', 'title: Shop: flour and yeast\n') },
      'not found: <path>': { files: plan('  buy-flour: {}\n'), target: 'pantry' },
      '<file>: not a plan file (expected .yaml or .yml)': { files: { 'recipe.txt': 'flour, water, salt\n' }, target: 'recipe.txt' },
      '<path>: expected exactly one .yaml file at the top of the folder, found N: <files>': {
        files: { 'bread.yaml': 'name: Bread\nnodes: {}\n', 'cake.yaml': 'name: Cake\nnodes: {}\n' },
      },
      '<path>: expected a .yaml plan file at the top of the folder, found none': { files: { 'notes.txt': 'flour\n' } },
      '<path>: expected a .yaml plan file at the top of the folder, found none; <files> found: name the file explicitly or rename it to .yaml': {
        files: { 'kitchen.yml': 'name: Bake bread\nnodes: {}\n' },
      },
      '<name>.json: JSON graph files are no longer read; rewrite it as <name>.yaml (see README "From graph.json")': {
        files: { 'kitchen.json': '{"name": "Bake bread", "nodes": []}\n' },
      },
    }
    // Pinned elsewhere (src/cli/main.test.ts) or needing an unreadable file: in the table, not loaded here.
    const exempt = ['port N is in use', '<file>: cannot be read (<code>)']
    const rows = tableMessages(read(FORMAT_MD), '## Refusals')
    expect(exempt.filter(e => !rows.includes(e))).toEqual([])
    expect(Object.keys(refusals).sort()).toEqual(rows.filter(r => !exempt.includes(r)).sort())
    for (const [cell, { files, target }] of Object.entries(refusals)) expect(() => loadIn(files, target), cell).toThrow(messageRe(cell))
  })

  it('every warning in the table is what the loader prints', () => {
    const many: Record<string, string> = {}
    for (let i = 0; i < 500; i++) many[`nodes/buy-flour.context/receipts/r${String(i).padStart(3, '0')}.txt`] = 'paid\n'
    const warnings: Record<string, { files: Record<string, string>; target?: string }> = {
      'unknown top-level key "<key>" ignored': { files: { ...kitchen('{}'), 'kitchen.yaml': 'name: Bake bread\noven: hot\nnodes:\n  buy-flour: {}\n' } },
      'node "<id>": unknown key "<key>" ignored': { files: kitchen('{need: [knead]}') },
      'node "<id>": no md file': { files: kitchen('{}', null) },
      'node "<id>": md not found': { files: kitchen('{md: cards/flour.md}', null) },
      'node "<id>": md is outside the folder': { files: kitchen('{md: ../flour.md}', null) },
      'node "<id>": dir is outside the folder': { files: kitchen('{dir: ../shop}') },
      'node "<id>": dir not found': { files: kitchen('{dir: shop}') },
      'node "<id>": unknown dependency "<id>" dropped': { files: kitchen('{needs: [buy-yeast]}') },
      'node "<id>": more than 500 files, list cut': { files: { ...kitchen('{}'), ...many } },
    }
    const rows = tableMessages(read(FORMAT_MD), '## Warnings')
    expect(Object.keys(warnings).sort()).toEqual([...rows].sort())
    for (const [cell, { files, target }] of Object.entries(warnings)) {
      const r = loadIn(files, target)
      expect(r.warnings.some(w => messageRe(cell).test(w)), `${cell}: ${JSON.stringify(r.warnings)}`).toBe(true)
    }
  })

  it('reports several card errors in one run', () => {
    expect(() => loadIn(kitchen('{}', 'status: started\npriority: urgent\n'))).toThrow(/invalid status "started"; node "buy-flour": invalid priority "urgent"/)
  })

  it('hold length is counted after whitespace collapses', () => {
    const doubled = `${'a'.repeat(99)}  ${'b'.repeat(100)}`
    expect(doubled).toHaveLength(201)
    expect(loadIn(kitchen('{}', `hold: ${doubled}\n`)).plan.nodes[0].hold).toBe(doubled)
    const long = `${'a'.repeat(100)} ${'b'.repeat(100)}`
    expect(() => loadIn(kitchen('{}', `hold: ${long}\n`))).toThrow(/hold must be 1-200 characters/)
  })

  it('an empty card key is absent even over the YAML', () => {
    const r = loadIn(kitchen('{priority: high}', 'title: Buy flour\npriority:\n'))
    expect(r.warnings).toEqual([])
    expect(r.plan.nodes[0].priority).toBeUndefined()
  })

  it('a deleted folder at the plan root is ignored', () => {
    const card = (t: string) => `---\ntitle: ${t}\n---\n`
    const r = loadIn({
      'kitchen.yaml': 'name: Bake bread\nnodes:\n  a: {}\n  b: {needs: [a]}\n',
      'nodes/a.context/a.md': card('Buy flour'),
      'nodes/b.context/b.md': card('Knead'),
      'deleted/c.context/c.md': card('Buy yeast'),
    })
    expect(r.warnings).toEqual([])
    expect(r.plan.nodes.map(n => n.id)).toEqual(['a', 'b'])
  })

  it('card YAML line numbers count from the first frontmatter line', () => {
    // The duplicate title is on file line 3; the message counts from the line after the opening ---, so it says line 2.
    expect(() => loadIn(kitchen('{}', 'title: Buy flour\ntitle: Buy rye\n'))).toThrow(/^node "buy-flour": Map keys must be unique at line 2, column 1$/)
  })

  it('the table helpers read rows and match messages', () => {
    const md = '## Refusals\n\n| Message | Cause | Fix |\n| --- | --- | --- |\n| `node "<id>": line L` | x | y |\n\n## Warnings\n'
    expect(tableMessages(md, '## Refusals')).toEqual(['node "<id>": line L'])
    expect(messageRe('node "<id>": line L').test('node "buy-flour": line 12')).toBe(true)
    expect(messageRe('node "<id>": line L').test('node "buy-flour": line twelve')).toBe(false)
    expect(messageRe('id "<id>" does not match ^[a-z0-9]$').test('id "X" does not match ^[a-z0-9]$')).toBe(true)
  })
})

describe('references/viewer.md', () => {
  it('states the CLI as it is', () => {
    const md = read(VIEWER_MD)
    expect(md).toContain(USAGE.split('\n')[0])
    expect(md).toContain('serving on 0.0.0.0; anyone who can reach this port can read the plan and every node folder')
    expect(md).toContain('port N is in use')
    expect(md).toMatch(/#v\d+\.\d+\.\d+/)
    for (const code of ['`0`', '`1`', '`2`']) expect(md, code).toContain(code)
    expect(md).toContain('--no-watch --port 0')
    expect(md, 'the whole usage, as --help prints it').toContain(`\`\`\`text\n${USAGE}\n\`\`\``)
  })
})

/** The school play plan and a card at each step, as files under `play/`. */
function playFiles(): Record<string, string> {
  const text = read(SKILL_MD)
  const play = fences(text, 'yaml').find(b => (parse(b) as { name?: unknown } | null)?.name === 'Spring school play')!
  const files: Record<string, string> = { 'play/play.yaml': play }
  for (const id of PLAY_IDS) files[`play/nodes/${id}.context/${id}.md`] = fences(text, 'markdown')[0]
  return files
}

describe('the check is validate', () => {
  const command = `npx --yes ${pkg.repository}#v${pkg.version} validate play`

  it('SKILL.md and viewer.md give the validate command, and no file checks with a serving run', () => {
    for (const rel of [SKILL_MD, VIEWER_MD]) expect(fences(read(rel), 'sh'), rel).toContain(`${command}\n`)
    for (const f of skillFiles()) expect(f.text, f.path).not.toMatch(/check run/)
    const check = read(SKILL_MD).split('### Check the plan')[1].split('## Showing the plan')[0]
    expect(check).not.toMatch(/--port|--no-watch|kill/)
  })

  it('the exit codes in SKILL.md and viewer.md are the CLI\'s', () => {
    const skill = read(SKILL_MD)
    expect(skill).toContain(`- \`${VALIDATE_EXIT.clean}\`: the plan loads with no warnings.`)
    expect(skill).toContain(`- \`${VALIDATE_EXIT.warnings}\`: the plan loads, with warnings.`)
    expect(skill).toContain(`- \`${VALIDATE_EXIT.refused}\`: the plan is refused`)
    const viewer = read(VIEWER_MD)
    expect(viewer).toContain(`- Exit \`${VALIDATE_EXIT.clean}\`: the plan loads with no warnings.`)
    expect(viewer).toContain(`- Exit \`${VALIDATE_EXIT.warnings}\`: the plan loads, with warnings.`)
    expect(viewer).toContain(`- Exit \`${VALIDATE_EXIT.refused}\`: the plan is refused`)
    expect(viewer).toContain(`\`${summaryLine('<name>', 2, 2, 0).replace('2 steps, 2 links', 'N steps, M links')}\``)
  })

  it('SKILL.md and viewer.md tell an npx failure (exit 1, no summary line) from plan warnings', () => {
    for (const rel of [SKILL_MD, VIEWER_MD]) expect(read(rel), rel).toContain('Exit `1` with no summary line on stdout is npx itself failing')
  })

  it('the summary line in SKILL.md is what validate prints for the school play', () => {
    const r = loadIn(playFiles(), 'play')
    const line = summaryLine(r.plan.name, r.plan.nodes.length, r.plan.nodes.reduce((n, x) => n + x.depends_on.length, 0), r.warnings.length)
    expect(line).toBe('Spring school play: 8 steps, 9 links, no warnings')
    expect(read(SKILL_MD)).toContain(`\`${line}\``)
  })

  it.skipIf(!existsSync(join(repo, 'lib/cli/validate.js')))('the built CLI prints that line and exits 0 for the school play', () => {
    const dir = makeFolder(playFiles())
    const r = spawnSync(process.execPath, [join(repo, 'bin/depgraph-view.js'), 'validate', 'play'], { cwd: dir, encoding: 'utf8', timeout: 10000 })
    expect({ status: r.status, stdout: r.stdout, stderr: r.stderr }).toEqual({ status: VALIDATE_EXIT.clean, stdout: 'Spring school play: 8 steps, 9 links, no warnings\n', stderr: '' })
  })
})

/** The text of a README section: from its `## heading` line to the next `## ` heading. */
function readmeSection(readme: string, heading: string): string {
  const start = readme.indexOf(`\n${heading}\n`)
  expect(start, heading).toBeGreaterThan(-1)
  const rest = readme.slice(start + heading.length + 2)
  const end = rest.search(/\n## /)
  return end === -1 ? rest : rest.slice(0, end)
}

describe('README', () => {
  it('the README documents the skill', () => {
    const readme = read('README.md')
    const at = (heading: string) => readme.indexOf(`\n${heading}\n`)
    expect(at('## Install')).toBeGreaterThan(-1)
    expect(at('## Install the skill')).toBeGreaterThan(at('## Install'))
    expect(at('## CLI reference')).toBeGreaterThan(at('## Install the skill'))
    const section = readmeSection(readme, '## Install the skill')
    const add = `npx skills add ${pkg.repository.replace(/^github:/, '')}`
    expect(section).toContain(`\`\`\`sh\n${add}\n`)
    expect(section).toContain(`${add} -g -a claude-code`)
    expect(section).toContain('skills/depgraph/SKILL.md')
    expect(readmeSection(readme, '## Development')).toContain('skills/')
  })
})
