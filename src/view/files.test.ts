import { describe, expect, it } from 'vitest'
import { fileUrl, resolveRelative } from './files.js'

describe('fileUrl', () => {
  it('fileUrl encodes each segment', () => {
    expect(fileUrl('a', 'sub dir/my #1?.png')).toBe('/files/a/sub%20dir/my%20%231%3F.png')
  })
})

describe('resolveRelative', () => {
  it('resolveRelative keeps relative paths in the folder', () => {
    expect(resolveRelative('a', './img/x.png')).toBe('/files/a/img/x.png')
    expect(resolveRelative('a', 'notes.md#part')).toBe('/files/a/notes.md#part')
    for (const h of ['https://example.com/x.png', '/etc/x', '../x', 'a/../../x', '#top', 'javascript:alert(1)', '//host/x']) expect(resolveRelative('a', h), h).toBeNull()
  })
  it('normalises inner climbs that stay in the folder', () => {
    expect(resolveRelative('a', 'img/../notes.md')).toBe('/files/a/notes.md')
  })
  it('rejects every scheme, whatever its case', () => {
    for (const h of ['JavaScript:alert(1)', 'data:image/png;base64,AAAA', 'mailto:x@example.com', 'file:///etc/x']) expect(resolveRelative('a', h), h).toBeNull()
  })
  it('reads percent-encoded hrefs once, so they are not encoded twice', () => {
    expect(resolveRelative('a', 'my%20sketch.png')).toBe('/files/a/my%20sketch.png')
    expect(resolveRelative('a', '%2e%2e/x')).toBeNull()
    expect(resolveRelative('a', 'bad%zz.png')).toBeNull()
  })
  it('drops a query and rejects an href naming no file', () => {
    expect(resolveRelative('a', 'x.png?v=2')).toBe('/files/a/x.png')
    for (const h of ['', '.', './', 'img/..']) expect(resolveRelative('a', h), h).toBeNull()
  })
})
