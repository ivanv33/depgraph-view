import { symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeFolder, planText, removeFolders } from './__tests__/folder.js'
import { GraphError, loadGraph, loadGraphFile, resolveGraphPath } from './loader.js'
import { listFiles } from './paths.js'

vi.mock('./paths.js', async importOriginal => {
  const real = await importOriginal<typeof import('./paths.js')>()
  return { ...real, listFiles: vi.fn(real.listFiles) }
})

afterEach(() => removeFolders())

describe('loadGraph', () => {
  it('reads title and status from frontmatter, and frontmatter wins over the YAML', () => {
    const root = makeFolder({ 'a.md': '---\ntitle: Sow the beans\nstatus: doing\n---\nBody here\n' })
    const r = loadGraph(root, planText('Garden', { a: { md: 'a.md', title: 'Ignored', status: 'done' } }))
    expect(r.plan).toEqual({ name: 'Garden', nodes: [expect.objectContaining({ id: 'a', title: 'Sow the beans', status: 'doing', depends_on: [] })] })
    expect(r.bodies.a).toBe('Body here\n')
  })
  it('falls back to the id and todo for an md without frontmatter', () => {
    const root = makeFolder({ 'a.md': 'Just text' })
    const r = loadGraph(root, planText('G', { a: { md: 'a.md' } }))
    expect(r.plan.nodes[0]).toMatchObject({ id: 'a', title: 'a', status: 'todo' })
    expect(r.bodies.a).toBe('Just text')
  })
  it('takes common keys from the YAML when the frontmatter has none', () => {
    const root = makeFolder({ 'a.md': '' })
    const r = loadGraph(root, planText('G', { a: { md: 'a.md', title: 'Water the pots', priority: 'high' } }))
    expect(r.plan.nodes[0]).toMatchObject({ title: 'Water the pots', priority: 'high' })
  })
  it('rejects a file-level shape error', () => {
    const root = makeFolder({ 'a.md': '' })
    expect(() => loadGraph(root, 'name: G\nnodes: [a]\n')).toThrow(GraphError)
  })
  it('rejects frontmatter that does not parse, naming the node', () => {
    const root = makeFolder({ 'a.md': '---\ntitle: [unclosed\n---\n' })
    expect(() => loadGraph(root, planText('G', { a: { md: 'a.md' } }))).toThrow(/node "a"/)
  })
  it('rejects a dependency cycle', () => {
    const root = makeFolder({ 'a.md': '', 'b.md': '' })
    expect(() => loadGraph(root, planText('G', { a: { md: 'a.md', needs: ['b'] }, b: { md: 'b.md', needs: ['a'] } }))).toThrow(GraphError)
  })
  it('drops a node whose md is missing, with a warning, and the edges to it', () => {
    const root = makeFolder({ 'b.md': '' })
    const r = loadGraph(root, planText('G', { a: { md: 'a.md' }, b: { md: 'b.md', needs: ['a'] } }))
    expect(r.plan.nodes.map(n => n.id)).toEqual(['b'])
    expect(r.plan.nodes[0].depends_on).toEqual([])
    expect(r.warnings).toEqual(['node "a": md not found', 'node "b": unknown dependency "a" dropped'])
  })
  it('drops edges to unknown ids with a warning', () => {
    const root = makeFolder({ 'b.md': '' })
    const r = loadGraph(root, planText('G', { b: { md: 'b.md', needs: ['ghost'] } }))
    expect(r.warnings).toEqual(['node "b": unknown dependency "ghost" dropped'])
  })
  it('drops a node whose md climbs out of the root', () => {
    const root = makeFolder({ 'in/a.md': '' })
    const r = loadGraph(join(root, 'in'), planText('G', { a: { md: '../in/../../etc/passwd' } }))
    expect(r.plan.nodes).toEqual([])
    expect(r.warnings).toEqual(['node "a": md is outside the folder'])
  })
  it('drops a node whose md is a symlink pointing outside the root', () => {
    const outside = makeFolder({ 'a.md': 'secret' })
    const root = makeFolder({})
    symlinkSync(join(outside, 'a.md'), join(root, 'a.md'))
    const r = loadGraph(root, planText('G', { a: { md: 'a.md' } }))
    expect(r.plan.nodes).toEqual([])
    expect(r.warnings).toEqual(['node "a": md is outside the folder'])
  })
  it('drops a node whose dir is a symlink pointing outside the root', () => {
    const outside = makeFolder({ 'secret.txt': 'x' })
    const root = makeFolder({ 'a.md': '' })
    symlinkSync(outside, join(root, 'link'))
    const r = loadGraph(root, planText('G', { a: { md: 'a.md', dir: 'link' } }))
    expect(r.warnings).toEqual(['node "a": dir is outside the folder'])
  })
  it('keeps a node whose dir is missing, with no files and no folder', () => {
    const root = makeFolder({ 'a.md': '' })
    const r = loadGraph(root, planText('G', { a: { md: 'a.md', dir: 'ctx/a' } }))
    expect(r.plan.nodes.map(n => n.id)).toEqual(['a'])
    expect(r.resources.a).toEqual([])
    expect(r.folders.a).toBeUndefined()
    expect(r.warnings).toEqual(['node "a": dir not found'])
  })
  it('lists the folder files sorted, dir first, md folder otherwise', () => {
    const root = makeFolder({ 'nodes/a.md': '', 'ctx/a/z.txt': '', 'ctx/a/sub/b.png': '' })
    const r = loadGraph(root, planText('G', { a: { md: 'nodes/a.md', dir: 'ctx/a' } }))
    expect(r.resources.a).toEqual(['sub/b.png', 'z.txt'])
    expect(r.folders.a).toBe(join(root, 'ctx/a'))
    expect(r.mdFiles.a).toBe(join(root, 'nodes/a.md'))
  })
  it('uses the md file\'s folder when there is no dir', () => {
    const root = makeFolder({ 'nodes/b/b.md': '', 'nodes/b/photo.png': '' })
    const r = loadGraph(root, planText('G', { b: { md: 'nodes/b/b.md' } }))
    expect(r.resources.b).toEqual(['b.md', 'photo.png'])
    expect(r.folders.b).toBe(join(root, 'nodes/b'))
  })
  it('caps a node\'s file list at 500 and warns', () => {
    const files: Record<string, string> = { 'a.md': '' }
    for (let i = 0; i < 510; i++) files[`f${String(i).padStart(3, '0')}.txt`] = ''
    const r = loadGraph(makeFolder(files), planText('G', { a: { md: 'a.md' } }))
    expect(r.resources.a).toHaveLength(500)
    expect(r.warnings).toContain('node "a": more than 500 files, list cut')
  })
  it('rejects a schema error from frontmatter', () => {
    const root = makeFolder({ 'a.md': '---\nstatus: maybe\n---\n' })
    expect(() => loadGraph(root, planText('G', { a: { md: 'a.md' } }))).toThrow(GraphError)
  })
  it('reads a node with neither md nor dir from nodes/<id>.context/<id>.md and lists that folder', () => {
    const root = makeFolder({ 'nodes/a.context/a.md': '---\ntitle: Sow\n---\nBody', 'nodes/a.context/seed.txt': 'x' })
    const r = loadGraph(root, planText('G', { a: {} }))
    expect(r.plan.nodes[0]).toMatchObject({ id: 'a', title: 'Sow' })
    expect(r.resources.a).toEqual(['a.md', 'seed.txt'])
    expect(r.warnings).toEqual([])
  })
  it('keeps a node whose default md is missing, with its id as title, status todo and one warning', () => {
    const r = loadGraph(makeFolder({ 'x.txt': '' }), planText('G', { a: {} }))
    expect(r.plan.nodes).toEqual([expect.objectContaining({ id: 'a', title: 'a', status: 'todo', depends_on: [] })])
    expect(r.bodies.a).toBe('')
    expect(r.resources.a).toEqual([])
    expect(r.mdFiles).not.toHaveProperty('a')
    expect(r.warnings).toEqual(['node "a": no md file'])
  })
  it('lists the default folder and sets folders[id] when the default md is missing but the folder exists', () => {
    const r = loadGraph(makeFolder({ 'nodes/a.context/seed.txt': 'x' }), planText('G', { a: {} }))
    expect(r.resources.a).toEqual(['seed.txt'])
    expect(r.folders.a).toBeDefined()
    expect(r.warnings).toEqual(['node "a": no md file'])
  })
  it('warns twice for a node that names a missing dir and has no default md', () => {
    const r = loadGraph(makeFolder({ 'x.txt': '' }), planText('G', { a: { dir: 'notes/a' } }))
    expect(r.warnings).toEqual(['node "a": no md file', 'node "a": dir not found'])
  })
  it('still drops a node whose explicit md is missing', () => {
    const r = loadGraph(makeFolder({ 'x.txt': '' }), planText('G', { a: { md: 'notes/a.md' } }))
    expect(r.plan.nodes).toEqual([])
    expect(r.warnings).toEqual(['node "a": md not found'])
  })
  it('sorts nodes by id whatever the file order', () => {
    const r = loadGraph(makeFolder({ 'x.txt': '' }), 'name: G\nnodes:\n  c: {}\n  a: {}\n  b: {needs: [a]}\n')
    expect(r.plan.nodes.map(n => n.id)).toEqual(['a', 'b', 'c'])
  })
  it('takes a common key from the YAML node when the md has none, frontmatter winning otherwise', () => {
    const root = makeFolder({ 'nodes/a.context/a.md': '---\nstatus: doing\n---\n' })
    expect(loadGraph(root, planText('G', { a: { title: 'Water the pots', status: 'done' } })).plan.nodes[0]).toMatchObject({ title: 'Water the pots', status: 'doing' })
  })
  it('passes the parser warnings through before the node warnings', () => {
    expect(loadGraph(makeFolder({ 'x.txt': '' }), 'name: G\nnodes:\n  a: {need: [b]}\n').warnings).toEqual(['node "a": unknown key "need" ignored', 'node "a": no md file'])
  })
})

describe('loadGraph folder walks', () => {
  it('walks a folder shared by several nodes once', () => {
    const root = makeFolder({ 'a.md': '', 'b.md': '', 'ctx/notes.txt': '' })
    vi.mocked(listFiles).mockClear()
    const r = loadGraph(root, planText('G', { a: { md: 'a.md', dir: 'ctx' }, b: { md: 'b.md', dir: 'ctx' } }))
    expect(r.resources.a).toEqual(['notes.txt'])
    expect(r.resources.b).toEqual(r.resources.a)
    expect(listFiles).toHaveBeenCalledTimes(1)
  })
})

describe('resolveGraphPath', () => {
  const json = (stem: string) => `${stem}.json: JSON graph files are no longer read; rewrite it as ${stem}.yaml (see README "From graph.json")`
  it('resolveGraphPath takes a folder with exactly one top-level yaml', () => {
    const root = makeFolder({ 'plan.yaml': '', 'nodes/x.yaml': '' })
    expect(resolveGraphPath(root)).toBe(join(root, 'plan.yaml'))
    expect(() => resolveGraphPath(makeFolder({ 'a.yaml': '', 'b.yaml': '' }))).toThrow(/exactly one .*found 2: a\.yaml, b\.yaml$/)
    expect(() => resolveGraphPath(makeFolder({ 'notes.txt': '' }))).toThrow(/found none$/)
    expect(() => resolveGraphPath(join(root, 'missing.yaml'))).toThrow(GraphError)
  })
  it('takes a yaml file path as it is', () => {
    const root = makeFolder({ 'plan.yaml': '' })
    expect(resolveGraphPath(join(root, 'plan.yaml'))).toBe(join(root, 'plan.yaml'))
  })
  it('a folder: <folder>/<basename>.yaml first, else its one top-level .yaml', () => {
    const named = makeFolder({ 'x.yaml': '', 'y.yaml': '' })
    expect(() => resolveGraphPath(named)).toThrow(/expected exactly one \.yaml file at the top of the folder, found 2: x\.yaml, y\.yaml$/)
    const one = makeFolder({ 'garden.yaml': '' })
    expect(resolveGraphPath(one)).toBe(join(one, 'garden.yaml'))
    const own = makeFolder({ 'garden/garden.yaml': '', 'garden/other.yaml': '' })
    expect(resolveGraphPath(join(own, 'garden'))).toBe(join(own, 'garden', 'garden.yaml'))
  })
  it('a folder with YAML and an old JSON uses the YAML', () => {
    const both = makeFolder({ 'graph.yaml': '', 'graph.json': '{}' })
    expect(resolveGraphPath(both)).toBe(join(both, 'graph.yaml'))
  })
  it('a folder with only JSON, or a .json path, is refused with the README pointer', () => {
    const old = makeFolder({ 'graph.json': '{}' })
    expect(() => resolveGraphPath(old)).toThrow(new GraphError(json('graph')))
    expect(() => resolveGraphPath(join(old, 'graph.json'))).toThrow(new GraphError(json('graph')))
  })
  it('.yml only when named; a folder of .yml finds none', () => {
    const yml = makeFolder({ 'plan.yml': '' })
    expect(resolveGraphPath(join(yml, 'plan.yml'))).toBe(join(yml, 'plan.yml'))
    expect(() => resolveGraphPath(yml)).toThrow(/expected a \.yaml plan file at the top of the folder, found none$/)
    expect(() => resolveGraphPath(join(makeFolder({ 'a.txt': '' }), 'a.txt'))).toThrow(/^a\.txt: not a plan file \(expected \.yaml or \.yml\)$/)
  })
})

describe('loadGraphFile', () => {
  it('reads the yaml next to its md files, past a leading BOM', () => {
    const root = makeFolder({ 'plan.yaml': '﻿' + planText('Kitchen', { bake: { md: 'bake.md' } }), 'bake.md': '---\ntitle: Bake bread\n---\n' })
    const r = loadGraphFile(join(root, 'plan.yaml'))
    expect(r.plan.name).toBe('Kitchen')
    expect(r.plan.nodes[0].title).toBe('Bake bread')
  })
  it('loadGraphFile reads a CRLF file with a BOM as the same plan', () => {
    const root = makeFolder({ 'plan.yaml': '﻿name: G\r\nnodes:\r\n  a: {}\r\n' })
    expect(loadGraphFile(join(root, 'plan.yaml')).plan).toEqual({ name: 'G', nodes: [expect.objectContaining({ id: 'a' })] })
  })
  it('names the file in a parse error', () => {
    const root = makeFolder({ 'plan.yaml': '{ nope' })
    expect(() => loadGraphFile(join(root, 'plan.yaml'))).toThrow(/^plan\.yaml: /)
    expect(() => loadGraphFile(join(root, 'plan.yaml'))).toThrow(GraphError)
  })
  it('loadGraphFile prefixes only a YAML error with the file name', () => {
    const bad = makeFolder({ 'plan.yaml': 'name: [unclosed\n' })
    expect(() => loadGraphFile(join(bad, 'plan.yaml'))).toThrow(/^plan\.yaml: /)
    const shape = makeFolder({ 'plan.yaml': 'name: 3\nnodes: {}\n' })
    expect(() => loadGraphFile(join(shape, 'plan.yaml'))).toThrow(/^name must be a string$/)
  })
  it('names an unreadable file by its base name and error code only', () => {
    const root = makeFolder({})
    expect(() => loadGraphFile(join(root, 'plan.yaml'))).toThrow(new GraphError('plan.yaml: cannot be read (ENOENT)'))
  })
  it('names a missing folder by its base name only', () => {
    const root = makeFolder({})
    expect(() => loadGraph(join(root, 'gone'), planText('G', {}))).toThrow(new GraphError('folder not found: gone'))
  })
})
