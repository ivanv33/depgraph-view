import { describe, expect, it } from 'vitest'
import { GraphError, parseGraphYaml } from './planYaml.js'

const err = (text: string) => { try { parseGraphYaml(text); return null } catch (e) { return e as GraphError } }

describe('parseGraphYaml', () => {
  it('reads name, ids in file order, needs, md, dir and common fallbacks', () => {
    const g = parseGraphYaml('# a garden\nname: Spring garden\nnodes:\n  dig-beds: {}\n  sow-peas: {needs: [dig-beds]}  # after digging\n  plant-tomatoes:\n    needs: [dig-beds]\n    md: notes/tomatoes.md\n    dir: notes/tomato-photos\n    title: Tomatoes\n')
    expect(g).toEqual({ name: 'Spring garden', warnings: [], entries: [
      { id: 'dig-beds', needs: [], common: {} },
      { id: 'sow-peas', needs: ['dig-beds'], common: {} },
      { id: 'plant-tomatoes', needs: ['dig-beds'], md: 'notes/tomatoes.md', dir: 'notes/tomato-photos', common: { title: 'Tomatoes' } },
    ] })
  })
  it('an empty node value and needs: [] both mean no needs', () => {
    expect(parseGraphYaml('name: G\nnodes:\n  a:\n  b: {needs: []}\n').entries.map(e => e.needs)).toEqual([[], []])
  })
  it('needs: with no value means no needs', () => expect(parseGraphYaml('name: G\nnodes:\n  a: {needs: }\n').entries[0].needs).toEqual([]))
  it('nodes: {} is an empty plan', () => expect(parseGraphYaml('name: G\nnodes: {}\n').entries).toEqual([]))
  it('a quoted numeric id is a string', () => expect(parseGraphYaml('name: G\nnodes:\n  "2026": {}\n').entries[0].id).toBe('2026'))
  it('an unquoted id YAML reads as a non-string rejects with a hint to quote it', () => {
    for (const k of ['2026', '1e3', 'true', 'null'])
      expect(err(`name: G\nnodes:\n  ${k}: {}\n`)?.message).toBe(`node id ${k} is not a string: quote it as "${k}"`)
  })
  it('a needs item YAML reads as a non-string rejects with the same hint', () => {
    expect(err('name: G\nnodes:\n  a: {needs: [2026]}\n')?.message).toBe('node "a": needs item 2026 is not a string: quote it as "2026"')
  })
  it('a duplicate id is a YAML error', () => {
    const e = err('name: G\nnodes:\n  a: {}\n  a: {}\n')
    expect(e).toBeInstanceOf(GraphError)
    expect(e?.yaml).toBe(true)
  })
  it('a YAML syntax error is a GraphError marked yaml, first line only', () => {
    const e = err('name: [unclosed\n')
    expect(e?.yaml).toBe(true)
    expect(e?.message).not.toContain('\n')
  })
  it('rejects every file-level and node-level shape error with its message, marked not yaml', () => {
    const cases: [string, string][] = [
      ['', 'graph must be a mapping'],
      ['- a\n', 'graph must be a mapping'],
      ['nodes: {}\n', 'name must be a string'],
      ['name: G\nnodes: [a]\n', 'nodes must be a mapping'],
      ['name: G\n', 'nodes must be a mapping'],
      ['name: G\nnodes:\n  Bad: {}\n', 'id "Bad" does not match ^[a-z0-9][a-z0-9-]*$'],
      ['name: G\nnodes:\n  a: 3\n', 'node "a": must be a mapping or empty'],
      ['name: G\nnodes:\n  a: {needs: dig-beds}\n', 'node "a": needs must be a list'],
      ['name: G\nnodes:\n  a: {needs: [{b: 1}]}\n', 'node "a": needs must be a list of ids'],
      ['name: G\nnodes:\n  a: {md: 3}\n', 'node "a": md must be a string'],
      ['name: G\nnodes:\n  a: {dir: [x]}\n', 'node "a": dir must be a string'],
    ]
    for (const [text, message] of cases) {
      const e = err(text)
      expect(e?.message, text).toBe(message)
      expect(e?.yaml, text).toBe(false)
    }
  })
  it('warns on and ignores unknown node and top-level keys', () => {
    const g = parseGraphYaml('name: G\nlayout: x\nnodes:\n  a: {need: [b]}\n')
    expect(g.entries).toEqual([{ id: 'a', needs: [], common: {} }])
    expect(g.warnings).toEqual(['unknown top-level key "layout" ignored', 'node "a": unknown key "need" ignored'])
  })
  it('caps alias expansion', () => {
    const bomb = 'name: G\nx0: &a [1]\n' + Array.from({ length: 12 }, (_, i) => `x${i + 1}: &a${i + 1} [${Array(10).fill(i ? `*a${i}` : '*a').join(', ')}]\n`).join('') + 'nodes: {}\n'
    expect(err(bomb)?.yaml).toBe(true)
  })
})
