import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { makeFolder, removeFolders } from './__tests__/folder.js'
import { insideRoot, listFiles } from './paths.js'

afterEach(() => removeFolders())

describe('insideRoot', () => {
  it('refuses a path that climbs out of the root', () => {
    const root = makeFolder({ 'a.md': '' })
    expect(insideRoot(root, '../x')).toBeNull()
  })
  it('gives the realpath of a file inside the root', () => {
    const root = makeFolder({ 'a.md': '' })
    expect(insideRoot(root, 'a.md')).toBe(join(root, 'a.md'))
  })
  it('gives the root itself for an empty path', () => {
    const root = makeFolder({})
    expect(insideRoot(root, '')).toBe(root)
  })
  it('refuses a symlink to a file outside the root', () => {
    const outside = makeFolder({ 'secret.txt': 'x' })
    const root = makeFolder({})
    symlinkSync(join(outside, 'secret.txt'), join(root, 'link.txt'))
    expect(insideRoot(root, 'link.txt')).toBeNull()
  })
  it('refuses a path that does not exist', () => {
    expect(insideRoot(makeFolder({}), 'missing.md')).toBeNull()
  })
})

describe('listFiles', () => {
  it('lists files recursively, sorted, skipping node_modules and .git', () => {
    const root = makeFolder({ 'b.txt': '', 'a/c.md': '', 'node_modules/x/index.js': '', '.git/HEAD': '' })
    expect(listFiles(root)).toEqual({ files: ['a/c.md', 'b.txt'], truncated: false })
  })
  it('skips a symlink whose target leaves the folder', () => {
    const outside = makeFolder({ 'secret.txt': 'x' })
    const root = makeFolder({ 'a.txt': '' })
    symlinkSync(join(outside, 'secret.txt'), join(root, 'link.txt'))
    symlinkSync(outside, join(root, 'linkdir'))
    expect(listFiles(root).files).toEqual(['a.txt'])
  })
  it('keeps a symlink whose target stays inside', () => {
    const root = makeFolder({ 'a.txt': '' })
    mkdirSync(join(root, 'sub'))
    writeFileSync(join(root, 'sub', 'b.txt'), '')
    symlinkSync(join(root, 'a.txt'), join(root, 'sub', 'alias.txt'))
    expect(listFiles(root).files).toEqual(['a.txt', 'sub/alias.txt', 'sub/b.txt'])
  })
  it('cuts the list at the limit', () => {
    const root = makeFolder({ 'a.txt': '', 'b.txt': '', 'c.txt': '' })
    expect(listFiles(root, 2)).toEqual({ files: ['a.txt', 'b.txt'], truncated: true })
  })
  it.skipIf(process.getuid?.() === 0)('skips a subfolder it cannot read and lists the rest', () => {
    const root = makeFolder({ 'a.txt': '', 'locked/b.txt': '', 'open/c.txt': '' })
    chmodSync(join(root, 'locked'), 0o000)
    try {
      expect(listFiles(root).files).toEqual(['a.txt', 'open/c.txt'])
    } finally {
      chmodSync(join(root, 'locked'), 0o755)
    }
  })
})
