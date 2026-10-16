import { symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { makeFolder, removeFolders } from './__tests__/folder.js'
import { GraphError, loadGraph, loadGraphFile, resolveGraphPath } from './loader.js'

afterEach(() => removeFolders())

describe('loadGraph', () => {
  it('reads title and status from frontmatter, and frontmatter wins over the JSON', () => {
    const root = makeFolder({ 'a.md': '---\ntitle: Sow the beans\nstatus: doing\n---\nBody here\n' })
    const r = loadGraph(root, { name: 'Garden', nodes: [{ id: 'a', md: 'a.md', title: 'Ignored', status: 'done' }] })
    expect(r.plan).toEqual({ name: 'Garden', nodes: [expect.objectContaining({ id: 'a', title: 'Sow the beans', status: 'doing', depends_on: [] })] })
    expect(r.bodies.a).toBe('Body here\n')
  })
  it('falls back to the id and todo for an md without frontmatter', () => {
    const root = makeFolder({ 'a.md': 'Just text' })
    const r = loadGraph(root, { name: 'G', nodes: [{ id: 'a', md: 'a.md' }] })
    expect(r.plan.nodes[0]).toMatchObject({ id: 'a', title: 'a', status: 'todo' })
    expect(r.bodies.a).toBe('Just text')
  })
  it('takes common keys from the JSON when the frontmatter has none', () => {
    const root = makeFolder({ 'a.md': '' })
    const r = loadGraph(root, { name: 'G', nodes: [{ id: 'a', md: 'a.md', title: 'Water the pots', priority: 'high' }] })
    expect(r.plan.nodes[0]).toMatchObject({ title: 'Water the pots', priority: 'high' })
  })
  it('rejects duplicate ids', () => {
    const root = makeFolder({ 'a.md': '' })
    expect(() => loadGraph(root, { name: 'G', nodes: [{ id: 'a', md: 'a.md' }, { id: 'a', md: 'a.md' }] })).toThrow(/duplicate id "a"/)
  })
  it('rejects file-level shape errors', () => {
    const root = makeFolder({ 'a.md': '' })
    const bad: unknown[] = [
      null,
      [],
      { nodes: [] },
      { name: 'G', nodes: {} },
      { name: 'G', nodes: [1] },
      { name: 'G', nodes: [{ id: 'Bad Id', md: 'a.md' }] },
      { name: 'G', nodes: [{ id: 'a' }] },
      { name: 'G', nodes: [{ id: 'a', md: 3 }] },
      { name: 'G', nodes: [{ id: 'a', md: 'a.md', dir: 3 }] },
      { name: 'G', nodes: [{ id: 'a', md: 'a.md', depends_on: 'b' }] },
      { name: 'G', nodes: [{ id: 'a', md: 'a.md', depends_on: [1] }] },
    ]
    for (const json of bad) expect(() => loadGraph(root, json), JSON.stringify(json)).toThrow(GraphError)
  })
  it('rejects frontmatter that does not parse, naming the node', () => {
    const root = makeFolder({ 'a.md': '---\ntitle: [unclosed\n---\n' })
    expect(() => loadGraph(root, { name: 'G', nodes: [{ id: 'a', md: 'a.md' }] })).toThrow(/node "a"/)
  })
  it('rejects a dependency cycle', () => {
    const root = makeFolder({ 'a.md': '', 'b.md': '' })
    expect(() => loadGraph(root, { name: 'G', nodes: [{ id: 'a', md: 'a.md', depends_on: ['b'] }, { id: 'b', md: 'b.md', depends_on: ['a'] }] })).toThrow(GraphError)
  })
  it('drops a node whose md is missing, with a warning, and the edges to it', () => {
    const root = makeFolder({ 'b.md': '' })
    const r = loadGraph(root, { name: 'G', nodes: [{ id: 'a', md: 'a.md' }, { id: 'b', md: 'b.md', depends_on: ['a'] }] })
    expect(r.plan.nodes.map(n => n.id)).toEqual(['b'])
    expect(r.plan.nodes[0].depends_on).toEqual([])
    expect(r.warnings).toEqual(['node "a": md not found', 'node "b": unknown dependency "a" dropped'])
  })
  it('drops edges to unknown ids with a warning', () => {
    const root = makeFolder({ 'b.md': '' })
    const r = loadGraph(root, { name: 'G', nodes: [{ id: 'b', md: 'b.md', depends_on: ['ghost'] }] })
    expect(r.warnings).toEqual(['node "b": unknown dependency "ghost" dropped'])
  })
  it('drops a node whose md climbs out of the root', () => {
    const root = makeFolder({ 'in/a.md': '' })
    const r = loadGraph(join(root, 'in'), { name: 'G', nodes: [{ id: 'a', md: '../in/../../etc/passwd' }] })
    expect(r.plan.nodes).toEqual([])
    expect(r.warnings).toEqual(['node "a": md is outside the folder'])
  })
  it('drops a node whose md is a symlink pointing outside the root', () => {
    const outside = makeFolder({ 'a.md': 'secret' })
    const root = makeFolder({})
    symlinkSync(join(outside, 'a.md'), join(root, 'a.md'))
    const r = loadGraph(root, { name: 'G', nodes: [{ id: 'a', md: 'a.md' }] })
    expect(r.plan.nodes).toEqual([])
    expect(r.warnings).toEqual(['node "a": md is outside the folder'])
  })
  it('drops a node whose dir is a symlink pointing outside the root', () => {
    const outside = makeFolder({ 'secret.txt': 'x' })
    const root = makeFolder({ 'a.md': '' })
    symlinkSync(outside, join(root, 'link'))
    const r = loadGraph(root, { name: 'G', nodes: [{ id: 'a', md: 'a.md', dir: 'link' }] })
    expect(r.warnings).toEqual(['node "a": dir is outside the folder'])
  })
  it('keeps a node whose dir is missing, with no files and no folder', () => {
    const root = makeFolder({ 'a.md': '' })
    const r = loadGraph(root, { name: 'G', nodes: [{ id: 'a', md: 'a.md', dir: 'ctx/a' }] })
    expect(r.plan.nodes.map(n => n.id)).toEqual(['a'])
    expect(r.resources.a).toEqual([])
    expect(r.folders.a).toBeUndefined()
    expect(r.warnings).toEqual(['node "a": dir not found'])
  })
  it('lists the folder files sorted, dir first, md folder otherwise', () => {
    const root = makeFolder({ 'nodes/a.md': '', 'ctx/a/z.txt': '', 'ctx/a/sub/b.png': '' })
    const r = loadGraph(root, { name: 'G', nodes: [{ id: 'a', md: 'nodes/a.md', dir: 'ctx/a' }] })
    expect(r.resources.a).toEqual(['sub/b.png', 'z.txt'])
    expect(r.folders.a).toBe(join(root, 'ctx/a'))
    expect(r.mdFiles.a).toBe(join(root, 'nodes/a.md'))
  })
  it('uses the md file\'s folder when there is no dir', () => {
    const root = makeFolder({ 'nodes/b/b.md': '', 'nodes/b/photo.png': '' })
    const r = loadGraph(root, { name: 'G', nodes: [{ id: 'b', md: 'nodes/b/b.md' }] })
    expect(r.resources.b).toEqual(['b.md', 'photo.png'])
    expect(r.folders.b).toBe(join(root, 'nodes/b'))
  })
  it('caps a node\'s file list at 500 and warns', () => {
    const files: Record<string, string> = { 'a.md': '' }
    for (let i = 0; i < 510; i++) files[`f${String(i).padStart(3, '0')}.txt`] = ''
    const r = loadGraph(makeFolder(files), { name: 'G', nodes: [{ id: 'a', md: 'a.md' }] })
    expect(r.resources.a).toHaveLength(500)
    expect(r.warnings).toContain('node "a": more than 500 files, list cut')
  })
  it('rejects a schema error from frontmatter', () => {
    const root = makeFolder({ 'a.md': '---\nstatus: maybe\n---\n' })
    expect(() => loadGraph(root, { name: 'G', nodes: [{ id: 'a', md: 'a.md' }] })).toThrow(GraphError)
  })
})

describe('resolveGraphPath', () => {
  it('resolveGraphPath takes a folder with exactly one top-level json', () => {
    const root = makeFolder({ 'plan.json': '{}', 'nodes/x.json': '{}' })
    expect(resolveGraphPath(root)).toBe(join(root, 'plan.json'))
    expect(() => resolveGraphPath(makeFolder({ 'a.json': '{}', 'b.json': '{}' }))).toThrow(/exactly one/)
    expect(() => resolveGraphPath(join(root, 'missing.json'))).toThrow(GraphError)
  })
  it('takes a json file path as it is', () => {
    const root = makeFolder({ 'plan.json': '{}' })
    expect(resolveGraphPath(join(root, 'plan.json'))).toBe(join(root, 'plan.json'))
  })
})

describe('loadGraphFile', () => {
  it('reads the json next to its md files, past a leading BOM', () => {
    const root = makeFolder({ 'plan.json': '﻿{"name":"Kitchen","nodes":[{"id":"bake","md":"bake.md"}]}', 'bake.md': '---\ntitle: Bake bread\n---\n' })
    const r = loadGraphFile(join(root, 'plan.json'))
    expect(r.plan.name).toBe('Kitchen')
    expect(r.plan.nodes[0].title).toBe('Bake bread')
  })
  it('names the file in a parse error', () => {
    const root = makeFolder({ 'plan.json': '{ nope' })
    expect(() => loadGraphFile(join(root, 'plan.json'))).toThrow(/^plan\.json: /)
    expect(() => loadGraphFile(join(root, 'plan.json'))).toThrow(GraphError)
  })
})
