import { readdirSync, readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

type SourceFile = { path: string; text: string }

const FROM_RE = /\b(?:import|export)\b[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g
const BARE_RE = /\bimport\s*['"]([^'"]+)['"]/g
const DYNAMIC_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
const ENGINE_FORBIDDEN_TEXT = ['process.', 'Buffer', '__dirname', 'require(']

/** Every module specifier a file names in an import, re-export, side-effect import or dynamic import. */
function specifiers(text: string): string[] {
  return [FROM_RE, BARE_RE, DYNAMIC_RE].flatMap((re) => [...text.matchAll(re)].map((m) => m[1]))
}

const isTest = (file: string) => /\.test\.tsx?$/.test(file)
const isRelative = (s: string) => s.startsWith('.')
const isNodeBuiltin = (s: string) => s.startsWith('node:') || builtinModules.includes(s.split('/')[0])
const resolveFrom = (file: string, s: string) => path.posix.normalize(path.posix.join(path.posix.dirname(file), s))
const inside = (resolved: string, ...dirs: string[]) => dirs.some((d) => resolved === d || resolved.startsWith(d + '/'))

function layerOf(file: string): 'engine' | 'view' | 'server' | 'cli' | null {
  const m = /^src\/(engine|view|server|cli)\//.exec(file)
  return m ? (m[1] as 'engine' | 'view' | 'server' | 'cli') : null
}

/** One "<path>: <rule>" string per broken rule. Files outside the four layers carry no rules. */
export function violations(files: SourceFile[]): string[] {
  const out: string[] = []
  for (const { path: file, text } of files) {
    const layer = layerOf(file)
    if (!layer) continue
    const flag = (rule: string) => out.push(`${file}: ${rule}`)
    const test = isTest(file)
    for (const s of specifiers(text)) {
      const resolved = isRelative(s) ? resolveFrom(file, s) : null
      if (layer === 'engine') {
        if (resolved !== null) {
          if (!inside(resolved, 'src/engine')) flag('engine imports outside engine')
        } else if (!test) {
          if (isNodeBuiltin(s)) flag(`engine imports Node builtin ${s}`)
          else if (s !== 'three' && !s.startsWith('three/')) flag(`engine imports package ${s}`)
        }
      } else if (layer === 'view') {
        if (resolved !== null) {
          if (!inside(resolved, 'src/view', 'src/engine')) flag('view imports outside view and engine')
        } else if (!test && s.startsWith('node:')) flag(`view imports ${s}`)
      } else if (layer === 'server') {
        if (resolved !== null) {
          if (!inside(resolved, 'src/server') && resolved !== 'src/engine/schema.js') flag('server imports outside server and engine/schema')
        } else if (/^react(-dom)?(\/|$)/.test(s)) flag(`server imports ${s}`)
        else if (/(^|\/)src\/(view|cli)(\/|$)/.test(s)) flag(`server imports ${s}`)
      } else if (resolved !== null && !inside(resolved, 'src/cli', 'src/server')) {
        flag('cli imports outside cli and server')
      }
    }
    if (layer === 'engine' && !test) {
      for (const token of ENGINE_FORBIDDEN_TEXT) if (text.includes(token)) flag(`engine uses ${token}`)
    }
    if (layer === 'view' && text.includes('__depgraph')) flag('view uses __depgraph')
  }
  return out
}

/** Every .ts/.tsx file under dir, with posix paths relative to the working directory. */
export function readTree(dir: string): SourceFile[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.posix.join(dir, entry.name)
    if (entry.isDirectory()) return readTree(full)
    return /\.tsx?$/.test(entry.name) ? [{ path: full, text: readFileSync(full, 'utf8') }] : []
  })
}

describe('import boundaries', () => {
  it('flags an engine file importing view', () => {
    expect(violations([{ path: 'src/engine/a.ts', text: "import x from '../view/Graph.js'" }])).toEqual(['src/engine/a.ts: engine imports outside engine'])
  })
  it('flags Node globals in engine source but not in engine tests', () => {
    expect(violations([{ path: 'src/engine/a.ts', text: "import { readFileSync } from 'node:fs'" }])).toHaveLength(1)
    expect(violations([{ path: 'src/engine/a.test.ts', text: "import { readFileSync } from 'node:fs'" }])).toEqual([])
  })
  it('lets server import engine/schema only', () => {
    expect(violations([{ path: 'src/server/l.ts', text: "import { ID_RE } from '../engine/schema.js'" }])).toEqual([])
    expect(violations([{ path: 'src/server/l.ts', text: "import { layoutPlan } from '../engine/layered.js'" }])).toHaveLength(1)
    expect(violations([{ path: 'src/server/l.ts', text: "import React from 'react'" }])).toHaveLength(1)
  })
  it('flags a window.__depgraph write in view', () => {
    expect(violations([{ path: 'src/view/G.tsx', text: 'window.__depgraphGlides = h' }])).toHaveLength(1)
  })
  it('lets cli import server only', () => {
    expect(violations([{ path: 'src/cli/m.ts', text: "import { startServer } from '../server/start.js'" }])).toEqual([])
    expect(violations([{ path: 'src/cli/m.ts', text: "import { ID_RE } from '../engine/schema.js'" }])).toHaveLength(1)
  })
  it('the source tree keeps every rule', () => {
    expect(violations(readTree('src'))).toEqual([])
  })
})
