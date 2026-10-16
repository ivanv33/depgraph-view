import { isMap, parseDocument, type Document } from 'yaml'
import type { PlanNode } from '../engine/schema.js'

/** The keys the app reads and writes, in the order a new file gets them. */
export const COMMON_KEYS = ['title', 'description', 'status', 'tags', 'due', 'priority', 'hold'] as const
export type CommonKey = (typeof COMMON_KEYS)[number]

/** A node file's frontmatter that cannot be read or safely rewritten; `message` has no node prefix. */
export class NodeFileError extends Error {}

/** `open + frontmatter + close + body` is the text minus a leading BOM. `frontmatter` is null when there is none. */
export interface SplitFile { open: string; frontmatter: string | null; close: string; body: string }

export function splitNodeFile(input: string): SplitFile {
  const text = input.startsWith('﻿') ? input.slice(1) : input
  const first = /^---[ \t]*(\r?\n)/.exec(text)
  if (!first) return { open: '', frontmatter: null, close: '', body: text }
  const open = first[0]
  const rest = text.slice(open.length)
  const closing = /^---[ \t]*(\r?\n|$)/m.exec(rest)
  if (!closing) throw new NodeFileError('frontmatter is not closed')
  return {
    open,
    frontmatter: rest.slice(0, closing.index),
    close: closing[0],
    body: rest.slice(closing.index + closing[0].length),
  }
}

function parseDoc(frontmatter: string): Document.Parsed {
  const doc = parseDocument(frontmatter, { version: '1.2', uniqueKeys: true })
  if (doc.errors.length) throw new NodeFileError(doc.errors[0].message.split('\n')[0].replace(/:$/, ''))
  if (doc.contents !== null && !isMap(doc.contents)) throw new NodeFileError('frontmatter must be a mapping')
  return doc
}

/** Plain data of a parsed block; alias expansion is capped and its overflow is a NodeFileError. */
function dataOf(doc: Document.Parsed): Record<string, unknown> {
  try {
    return (doc.toJS({ maxAliasCount: 100 }) as Record<string, unknown> | null) ?? {}
  } catch (e) {
    throw new NodeFileError(e instanceof Error ? e.message.split('\n')[0] : 'frontmatter cannot be read')
  }
}

/** The frontmatter as plain data; `{}` for none or an empty block. Throws NodeFileError. */
export function parseFrontmatter(frontmatter: string | null): Record<string, unknown> {
  if (frontmatter === null) return {}
  return dataOf(parseDoc(frontmatter))
}

/** A number or boolean title or description (`title: 2026`, written by another tool) as text; anything else as it is. */
const asText = (v: unknown) => (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint' ? String(v) : v)

/**
 * The raw node `validatePlan` checks: common values from the file (null means absent), defaults
 * for absent title/description/status/tags, and the given dependencies. A scalar title or
 * description is read as text (the file keeps it until the user edits it). Unknown keys are left out.
 */
export function nodeFromFile(id: string, data: Record<string, unknown>, dependsOn: string[]): PlanNode {
  const get = (k: CommonKey) => (Object.hasOwn(data, k) && data[k] !== null ? data[k] : undefined)
  const out: Record<string, unknown> = {
    id,
    title: asText(get('title')) ?? id,
    description: asText(get('description')) ?? '',
    status: get('status') ?? 'todo',
    tags: get('tags') ?? [],
    depends_on: dependsOn,
  }
  for (const k of ['due', 'priority', 'hold'] as const) if (get(k) !== undefined) out[k] = get(k)
  return out as unknown as PlanNode // unchecked: validatePlan reports wrong types
}
