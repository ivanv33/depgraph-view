import { describe, expect, it } from 'vitest'
import {
  findCycle, isDate, isOldIndex, normalizePlan, serializeIndex, serializePlan, slugify, uniqueId, validateIndex, validatePlan, type Plan,
} from './schema.js'

const node = (id: string, depends_on: string[] = [], extra: Partial<Plan['nodes'][number]> = {}) => ({
  id, title: id, description: '', status: 'todo' as const, tags: [], depends_on, ...extra,
})

describe('validatePlan', () => {
  it('accepts a valid plan', () => {
    expect(validatePlan({ name: 'p', nodes: [node('a'), node('b', ['a'])] })).toEqual([])
  })
  it('rejects non-object input', () => {
    expect(validatePlan(null)).toEqual(['plan must be an object'])
    expect(validatePlan('x')).toEqual(['plan must be an object'])
  })
  it('requires name and nodes', () => {
    expect(validatePlan({})).toEqual(['name must be a string', 'nodes must be an array'])
  })
  it('rejects bad id format', () => {
    expect(validatePlan({ name: 'p', nodes: [node('Bad Id')] })).toEqual(['node 0: id "Bad Id" does not match ^[a-z0-9][a-z0-9-]*$'])
  })
  it('rejects duplicate ids', () => {
    expect(validatePlan({ name: 'p', nodes: [node('a'), node('a')] })).toEqual(['node 1: duplicate id "a"'])
  })
  it('rejects bad status', () => {
    expect(validatePlan({ name: 'p', nodes: [node('a', [], { status: 'nope' as never })] })).toEqual(['node "a": invalid status "nope"'])
  })
  it('rejects unknown dependency', () => {
    expect(validatePlan({ name: 'p', nodes: [node('a', ['zzz'])] })).toEqual(['node "a": unknown dependency "zzz"'])
  })
  it('rejects self dependency', () => {
    expect(validatePlan({ name: 'p', nodes: [node('a', ['a'])] })).toEqual(['node "a": depends on itself'])
  })
  it('rejects a 3-node cycle', () => {
    const errors = validatePlan({ name: 'p', nodes: [node('a', ['c']), node('b', ['a']), node('c', ['b'])] })
    expect(errors).toEqual(['cycle: a -> c -> b -> a'])
  })
  it('rejects non-string tags and non-string description', () => {
    expect(validatePlan({ name: 'p', nodes: [node('a', [], { tags: [1] as never, description: 2 as never })] }))
      .toEqual(['node "a": description must be a string', 'node "a": tags must be an array of strings'])
  })
})

describe('findCycle', () => {
  it('returns null for a DAG', () => {
    expect(findCycle([node('a'), node('b', ['a']), node('c', ['a', 'b'])])).toBeNull()
  })
  it('returns the cycle path', () => {
    expect(findCycle([node('a', ['b']), node('b', ['a'])])).toEqual(['a', 'b', 'a'])
  })
})

describe('normalizePlan', () => {
  it('sorts nodes and depends_on, fills defaults, does not mutate input', () => {
    const input = {
      name: 'p',
      nodes: [
        { id: 'b', title: 'B', depends_on: ['z', 'a'] },
        { id: 'a', title: 'A' },
        { id: 'z', title: 'Z' },
      ],
    } as unknown as Plan
    const out = normalizePlan(input)
    expect(out.nodes.map(n => n.id)).toEqual(['a', 'b', 'z'])
    expect(out.nodes[1].depends_on).toEqual(['a', 'z'])
    expect(out.nodes[0]).toEqual({ id: 'a', title: 'A', description: '', status: 'todo', tags: [], depends_on: [] })
    expect(input.nodes[0].id).toBe('b')
  })
})

describe('serializePlan', () => {
  it('is deterministic with 2-space indent and trailing newline', () => {
    const plan: Plan = { name: 'p', nodes: [node('b'), node('a')] }
    const text = serializePlan(plan)
    expect(text.endsWith('\n')).toBe(true)
    expect(text).toBe(JSON.stringify(normalizePlan(plan), null, 2) + '\n')
    expect(serializePlan(JSON.parse(text))).toBe(text)
  })
})

describe('slugify / uniqueId', () => {
  it('slugifies', () => {
    expect(slugify('  Size 6-12mo Runway! ')).toBe('size-6-12mo-runway')
    expect(slugify('___')).toBe('untitled')
    expect(slugify('-leading')).toBe('leading')
  })
  it('dedupes with -2, -3', () => {
    expect(uniqueId('a', ['a', 'a-2'])).toBe('a-3')
    expect(uniqueId('b', ['a'])).toBe('b')
  })
})

describe('hold', () => {
  const held = (hold: unknown) => ({ name: 'p', nodes: [node('a', [], { hold: hold as string })] })
  it('accepts 1 to 200 characters after trimming', () => {
    expect(validatePlan(held('until a home is picked'))).toEqual([])
    expect(validatePlan(held('x'.repeat(200)))).toEqual([])
    expect(validatePlan(held('😀'.repeat(200)))).toEqual([])
  })
  it('rejects empty, blank, too long and non-string', () => {
    const msg = ['node "a": hold must be 1-200 characters']
    expect(validatePlan(held(''))).toEqual(msg)
    expect(validatePlan(held('   '))).toEqual(msg)
    expect(validatePlan(held('x'.repeat(201)))).toEqual(msg)
    expect(validatePlan(held(5))).toEqual(msg)
    expect(validatePlan(held(null))).toEqual(msg)
  })
  it('normalizes: trims, and keeps the key after depends_on only when present', () => {
    const out = normalizePlan({ name: 'p', nodes: [node('a', ['b'], { hold: '  later  ' }), node('b')] })
    expect(out.nodes[0].hold).toBe('later')
    expect(Object.keys(out.nodes[0])).toEqual(['id', 'title', 'description', 'status', 'tags', 'depends_on', 'hold'])
    expect('hold' in out.nodes[1]).toBe(false)
    expect('hold' in normalizePlan({ name: 'p', nodes: [node('a', [], { hold: '  ' })] }).nodes[0]).toBe(false)
  })
  it('collapses whitespace runs, newlines included, in hold to one space', () => {
    const out = normalizePlan({ name: 'p', nodes: [node('a', [], { hold: ' well\n\n  understood\tnow ' })] })
    expect(out.nodes[0].hold).toBe('well understood now')
    expect(validatePlan({ name: 'p', nodes: [node('a', [], { hold: 'a\nb' })] })).toEqual([])
    // Validated on the collapsed form: 200 characters once collapsed is in range.
    expect(validatePlan({ name: 'p', nodes: [node('a', [], { hold: 'x'.repeat(100) + '\n\n\n' + 'y'.repeat(99) })] })).toEqual([])
  })
  it('plans without hold serialize unchanged', () => {
    expect(serializePlan({ name: 'p', nodes: [node('a')] })).not.toContain('hold')
  })
})

describe('due and priority', () => {
  const withNode = (extra: Record<string, unknown>) => ({ name: 'p', nodes: [node('a', [], extra as never)] })
  it('isDate accepts real calendar dates only', () => {
    expect(isDate('2028-02-29')).toBe(true)
    for (const s of ['2026-02-30', '2026-13-01', '26-01-01', '2026-1-1', '2026-01-01T00:00', 20260101, null, undefined])
      expect(isDate(s)).toBe(false)
  })
  it('validates due', () => {
    expect(validatePlan(withNode({ due: '2099-01-01' }))).toEqual([])
    expect(validatePlan(withNode({ due: '2026-02-30' }))).toEqual(['node "a": due must be a date YYYY-MM-DD'])
    expect(validatePlan(withNode({ due: 5 }))).toEqual(['node "a": due must be a date YYYY-MM-DD'])
  })
  it('validates priority', () => {
    expect(validatePlan(withNode({ priority: 'high' }))).toEqual([])
    expect(validatePlan(withNode({ priority: 'urgent' }))).toEqual(['node "a": invalid priority "urgent"'])
  })
  it('normalize emits due then priority after hold, only when set, dropping normal', () => {
    const out = normalizePlan(withNode({ priority: 'high', due: '2099-01-01', hold: 'x' }) as Plan)
    expect(Object.keys(out.nodes[0])).toEqual(['id', 'title', 'description', 'status', 'tags', 'depends_on', 'hold', 'due', 'priority'])
    const plain = normalizePlan(withNode({ priority: 'normal' }) as Plan).nodes[0]
    expect('priority' in plain).toBe(false)
    expect('due' in plain).toBe(false)
  })
})

describe('plan JSON (connections only)', () => {
  it('detects the old format by any key besides id and depends_on', () => {
    expect(isOldIndex({ name: 'P', nodes: [{ id: 'a', depends_on: [] }] })).toBe(false)
    expect(isOldIndex({ name: 'P', nodes: [{ id: 'a', title: 'A' }] })).toBe(true)
    expect(isOldIndex(null)).toBe(false)
  })
  it('validates the shape with validatePlan messages', () => {
    expect(validateIndex({ name: 'P', nodes: [{ id: 'a' }, { id: 'b', depends_on: ['a'] }] })).toEqual([])
    expect(validateIndex([])).toEqual(['plan must be an object'])
    expect(validateIndex({ nodes: 'x' })).toEqual(['name must be a string', 'nodes must be an array'])
    expect(validateIndex({ name: 'P', nodes: [1, { id: 'A' }, { id: 'a' }, { id: 'a' }, { id: 'b', depends_on: 'a' }] })).toEqual([
      'node 0: must be an object',
      'node 1: id "A" does not match ^[a-z0-9][a-z0-9-]*$',
      'node 3: duplicate id "a"',
      'node "b": depends_on must be an array of strings',
    ])
  })
  it('serializes ids and sorted depends_on only, sorted by id', () => {
    const plan = { name: 'P', nodes: [
      { id: 'b', title: 'B', description: '', status: 'todo' as const, tags: [], depends_on: ['c', 'a'] },
      { id: 'a', title: 'A', description: 'x', status: 'done' as const, tags: ['t'], depends_on: [], due: '2026-11-26' },
    ] }
    expect(serializeIndex(plan)).toBe(
      '{\n  "name": "P",\n  "nodes": [\n    {\n      "id": "a",\n      "depends_on": []\n    },\n' +
        '    {\n      "id": "b",\n      "depends_on": [\n        "a",\n        "c"\n      ]\n    }\n  ]\n}\n',
    )
  })
})
