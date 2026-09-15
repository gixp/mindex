import matter from 'gray-matter'
import { ulid } from 'ulid'
import type { NoteTypeId } from '@shared/types'

const ID_PREFIX: Record<NoteTypeId, string> = {
  project: 'prj',
  person: 'per',
  organization: 'org',
  goal: 'gol',
  payment: 'pay',
  expense: 'exp',
  'call-transcript': 'trn',
  'call-debrief': 'deb',
  knowledge: 'knw',
  'claude-chat': 'cht',
  'daily-note': 'day',
  asset: 'ast',
  untyped: 'nte'
}

export function generateId(type: NoteTypeId): string {
  return `${ID_PREFIX[type]}_${ulid().toLowerCase()}`
}

export function parseFrontmatter(raw: string): {
  data: Record<string, unknown>
  body: string
} {
  try {
    const parsed = matter(raw)
    const body = (parsed.content ?? '').replace(/^\n+/, '')
    return {
      data: (parsed.data ?? {}) as Record<string, unknown>,
      body
    }
  } catch {
    return { data: {}, body: raw }
  }
}

export function serializeFrontmatter(data: Record<string, unknown>, body: string): string {
  const hasFm = Object.keys(data).length > 0
  if (!hasFm) return body
  return matter.stringify(body, data)
}

export function extractTitle(body: string, fallback: string): string {
  const h1 = body.match(/^#\s+(.+?)\s*$/m)
  if (h1 && h1[1]) return h1[1].trim()
  return fallback
}

export function extractTags(data: Record<string, unknown>): string[] {
  const t = data['tags']
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === 'string')
  if (typeof t === 'string') return t.split(/[,\s]+/).filter(Boolean)
  return []
}

const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g

export function extractWikilinks(body: string): string[] {
  const found = new Set<string>()
  for (const match of body.matchAll(WIKILINK_RE)) {
    const target = match[1]?.trim()
    if (target) found.add(target)
  }
  return [...found]
}

export function rewriteWikilinks(body: string, oldTarget: string, newTarget: string): string {
  const escaped = oldTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`\\[\\[${escaped}(#[^\\]|]+)?(\\|[^\\]]+)?\\]\\]`, 'g')
  return body.replace(re, (_full, anchor: string | undefined, alias: string | undefined) => {
    return `[[${newTarget}${anchor ?? ''}${alias ?? ''}]]`
  })
}
