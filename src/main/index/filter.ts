import type { NoteMeta } from '@shared/types'
import { buildWikilinkIndex, normalizeLinkTarget, resolveWikilinkTarget } from '@shared/wikilink'
import type { WikilinkIndex } from '@shared/wikilink'
import { bracketedTargets, relationTargets } from '@shared/relations'
import { isRelationKey } from '@main/types/registry'

/**
 * The filter language.
 *
 * ```
 * type:project status:ACTIVE            every filter must match
 * status:ACTIVE,PLANNING                a list is "any of"
 * status:!=DONE,CANCELLED               negated, it is "none of"
 * title:~report                         substring
 * deadline:>2026-01-01                  comparison (numeric when both sides are)
 * deadline:*      deadline:!*           has a value / has none
 * company:[[Acme]]                      relationship — see below
 * participants:&[[Ann]],[[Bob]]         all of
 * budget:"12 000"                       quotes protect spaces and commas
 * ```
 *
 * On a **relationship** field the comparison is not textual: both sides are
 * resolved to the note they name, so `company:Acme`, `company:[[Acme]]`,
 * `company:acme.md` and `company:Organizations/Acme` all match the same
 * projects. A key counts as a relationship when the note's type declares it
 * (`relations` in `types/registry.ts`) or when its value is written with
 * `[[brackets]]`, whatever the type.
 */

type Op = '=' | '!=' | '>' | '<' | '>=' | '<=' | '~' | '&' | 'empty' | 'notEmpty'

interface Filter {
  key: string
  op: Op
  /** Alternatives for `=`/`!=`/`~`, all of them for `&`, unused when empty. */
  values: string[]
}

/** Keys that name something Mindex tracks itself, not a frontmatter field. */
const BUILTIN_KEYS = new Set(['type', 'title', 'path', 'tag', 'tags', 'id', 'mtime'])

function tokenize(expr: string): string[] {
  const tokens: string[] = []
  let buf = ''
  let inQuote = false
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i]
    if (ch === undefined) continue
    if (ch === '"') {
      inQuote = !inQuote
      buf += ch
      continue
    }
    if (!inQuote && /\s/.test(ch)) {
      if (buf.length > 0) {
        tokens.push(buf)
        buf = ''
      }
      continue
    }
    buf += ch
  }
  if (buf.length > 0) tokens.push(buf)
  return tokens
}

function unquote(s: string): string {
  return s.startsWith('"') && s.endsWith('"') && s.length >= 2 ? s.slice(1, -1) : s
}

/**
 * Split a value on commas, except inside quotes — so a note titled
 * `"Acme, Inc"` can still be named, and a bare `A,B` is a list of two.
 */
function splitValues(rest: string): string[] {
  const out: string[] = []
  let buf = ''
  let inQuote = false
  for (const ch of rest) {
    if (ch === '"') {
      inQuote = !inQuote
      buf += ch
      continue
    }
    if (ch === ',' && !inQuote) {
      out.push(buf)
      buf = ''
      continue
    }
    buf += ch
  }
  out.push(buf)
  return out.map(unquote).filter((v) => v.length > 0)
}

function parseFilters(expr: string): Filter[] {
  const filters: Filter[] = []

  for (const token of tokenize(expr)) {
    const colon = token.indexOf(':')
    if (colon <= 0) continue
    const key = token.slice(0, colon)
    let rest = token.slice(colon + 1)
    let op: Op = '='

    // `!*` before `!=`: both start with `!`, and only one of them is an
    // emptiness test.
    if (rest === '!*') {
      filters.push({ key, op: 'empty', values: [] })
      continue
    }
    if (rest === '*') {
      filters.push({ key, op: 'notEmpty', values: [] })
      continue
    }

    if (rest.startsWith('!=')) {
      op = '!='
      rest = rest.slice(2)
    } else if (rest.startsWith('>=')) {
      op = '>='
      rest = rest.slice(2)
    } else if (rest.startsWith('<=')) {
      op = '<='
      rest = rest.slice(2)
    } else if (rest.startsWith('>')) {
      op = '>'
      rest = rest.slice(1)
    } else if (rest.startsWith('<')) {
      op = '<'
      rest = rest.slice(1)
    } else if (rest.startsWith('~')) {
      op = '~'
      rest = rest.slice(1)
    } else if (rest.startsWith('&')) {
      op = '&'
      rest = rest.slice(1)
    }

    const values = splitValues(rest)
    if (values.length === 0) continue
    filters.push({ key, op, values })
  }
  return filters
}

function getValue(meta: NoteMeta, key: string): unknown {
  if (key === 'type') return meta.type
  if (key === 'title') return meta.title
  if (key === 'path') return meta.relPath
  if (key === 'tag' || key === 'tags') return meta.tags
  if (key === 'id') return meta.id
  if (key === 'mtime') return meta.mtime
  return meta.frontmatter[key]
}

function isEmptyValue(v: unknown): boolean {
  if (v === undefined || v === null) return true
  if (typeof v === 'string') return v.trim().length === 0
  if (Array.isArray(v)) return v.every(isEmptyValue)
  return false
}

/**
 * Is this key a relationship on this note? Declared by the type, or evident
 * from the value — someone who wrote `owner: "[[Ann]]"` on an untyped note
 * meant a link even though no schema says so.
 */
function isRelation(meta: NoteMeta, key: string, value: unknown): boolean {
  if (BUILTIN_KEYS.has(key)) return false
  if (isRelationKey(meta.type, key)) return true
  return bracketedTargets(value).length > 0
}

/**
 * `[[Acme]]` typed into a query means the link, not the brackets. Values read
 * out of a note arrive already unwrapped; values typed by hand do not.
 */
function unbracket(value: string): string {
  const wrapped = value.trim().match(/^\[\[(.*)\]\]$/)
  return wrapped ? (wrapped[1] ?? '') : value
}

/**
 * The identity of a link target: the note it resolves to, or — when nothing
 * answers to it — its own normalised text, so two dead links to the same
 * missing note still compare equal.
 */
function targetKey(raw: string, index: WikilinkIndex): string {
  const target = unbracket(raw)
  return resolveWikilinkTarget(target, index) ?? normalizeLinkTarget(target).toLowerCase()
}

function matchRelation(meta: NoteMeta, f: Filter, value: unknown, index: WikilinkIndex): boolean {
  const raw = relationTargets(value, isRelationKey(meta.type, f.key))
  if (f.op === 'empty') return raw.length === 0
  if (f.op === 'notEmpty') return raw.length > 0

  // `~` stays textual on purpose: `company:~acm` is a search for a name you
  // half remember, which resolution would defeat rather than help.
  if (f.op === '~') {
    const haystack = raw.map((t) => t.toLowerCase())
    return f.values.some((v) => {
      const needle = unbracket(v).toLowerCase()
      return haystack.some((t) => t.includes(needle))
    })
  }

  const held = new Set(raw.map((t) => targetKey(t, index)))
  const wanted = f.values.map((v) => targetKey(v, index))
  if (f.op === '=') return wanted.some((w) => held.has(w))
  if (f.op === '!=') return !wanted.some((w) => held.has(w))
  if (f.op === '&') return wanted.every((w) => held.has(w))
  return false
}

function matchScalar(f: Filter, v: unknown): boolean {
  if (f.op === 'empty') return isEmptyValue(v)
  if (f.op === 'notEmpty') return !isEmptyValue(v)
  if (v === undefined || v === null) return f.op === '!='

  if (Array.isArray(v)) {
    const held = v.map((x) => String(x).toLowerCase())
    const has = (want: string): boolean => held.includes(want.toLowerCase())
    if (f.op === '=') return f.values.some(has)
    if (f.op === '!=') return !f.values.some(has)
    if (f.op === '&') return f.values.every(has)
    if (f.op === '~') {
      return f.values.some((want) => held.some((x) => x.includes(want.toLowerCase())))
    }
    return false
  }

  const sv = String(v).toLowerCase()
  if (f.op === '=') return f.values.some((x) => sv === x.toLowerCase())
  if (f.op === '!=') return !f.values.some((x) => sv === x.toLowerCase())
  if (f.op === '~') return f.values.some((x) => sv.includes(x.toLowerCase()))
  // "All of" has no meaning for a single value beyond equality with one thing.
  if (f.op === '&') return f.values.length === 1 && sv === (f.values[0] ?? '').toLowerCase()

  // Comparisons take one bound; a list here is a query that means nothing.
  const raw = String(v)
  const fv = f.values[0] ?? ''
  const ln = Number(raw)
  const rn = Number(fv)
  if (Number.isNaN(ln) || Number.isNaN(rn)) {
    if (f.op === '>') return raw > fv
    if (f.op === '<') return raw < fv
    if (f.op === '>=') return raw >= fv
    if (f.op === '<=') return raw <= fv
    return false
  }
  if (f.op === '>') return ln > rn
  if (f.op === '<') return ln < rn
  if (f.op === '>=') return ln >= rn
  if (f.op === '<=') return ln <= rn
  return false
}

function matchFilter(meta: NoteMeta, f: Filter, index: WikilinkIndex): boolean {
  const v = getValue(meta, f.key)
  if (isRelation(meta, f.key, v)) return matchRelation(meta, f, v, index)
  return matchScalar(f, v)
}

/**
 * Kept apart from `runQuery` so the language is a pure function of the notes
 * handed to it: `runQuery` reaches into the live index, which needs an open
 * vault and an Electron process, and neither is a precondition for deciding
 * whether a filter matches.
 */
export function filterNotes(notes: readonly NoteMeta[], expr: string): NoteMeta[] {
  const filters = parseFilters(expr)
  if (filters.length === 0) return [...notes]
  // One index for the whole query rather than one per comparison: resolution
  // is what makes a relationship filter more than string matching, and it is
  // only affordable done once.
  const index = buildWikilinkIndex(notes)
  return notes.filter((m) => filters.every((f) => matchFilter(m, f, index)))
}
