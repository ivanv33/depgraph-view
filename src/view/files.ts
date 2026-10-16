/** The server's URL for `rel`, a path inside step `id`'s folder: every segment percent-encoded on its own. */
export function fileUrl(id: string, rel: string): string {
  return `/files/${encodeURIComponent(id)}/${rel.split('/').map(encodeURIComponent).join('/')}`
}

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i

/**
 * The /files URL for an href or image src written in step `id`'s markdown, read relative to the step's folder; null
 * when it is not a path inside that folder: it has a scheme, starts with `/`, `//` or `#`, names no file, or climbs
 * above the folder once `.` and `..` are resolved. The href is read as a URL: percent escapes are decoded once (the
 * result is encoded again by fileUrl) and a query is dropped; a `#fragment` is kept.
 */
export function resolveRelative(id: string, href: string): string | null {
  if (SCHEME_RE.test(href) || href.startsWith('/') || href.startsWith('#')) return null
  const hash = href.indexOf('#')
  const fragment = hash >= 0 ? href.slice(hash) : ''
  const beforeHash = hash >= 0 ? href.slice(0, hash) : href
  const query = beforeHash.indexOf('?')
  const raw = query >= 0 ? beforeHash.slice(0, query) : beforeHash
  const parts: string[] = []
  for (const encoded of raw.split('/')) {
    let seg: string
    try {
      seg = decodeURIComponent(encoded)
    } catch {
      return null
    }
    if (seg.includes('/') || seg.includes('\\')) return null
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (parts.length === 0) return null
      parts.pop()
    } else parts.push(seg)
  }
  if (parts.length === 0) return null
  return fileUrl(id, parts.join('/')) + fragment
}
