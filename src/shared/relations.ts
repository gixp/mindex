import { normalizeLinkTarget } from './wikilink'

/**
 * Frontmatter fields that point at other notes.
 *
 * A vault written by hand mixes two conventions for the same thing:
 *
 * ```yaml
 * company: "[[Acme]]"      # an explicit link
 * company: Acme            # the same relation, written plainly
 * participants: ["[[Ann]]", "[[Bob]]"]
 * ```
 *
 * Both are relations. The brackets are the unambiguous case — whoever wrote
 * them meant a link, wherever they put it — while a bare string only counts
 * when the note's type declares that key as a relation (`relations` on the
 * type spec in `types/registry.ts`). That split is deliberate: it keeps a
 * plain `area: Finance` out of the link graph, and keeps a mistyped company
 * name out of the dead-link report, while still letting both be filtered on.
 */

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g

/** The `[[bracketed]]` targets inside one frontmatter value, at any depth. */
export function bracketedTargets(value: unknown): string[] {
  const out: string[] = []
  collect(value, (s) => {
    for (const match of s.matchAll(WIKILINK_RE)) {
      const target = normalizeLinkTarget(match[1] ?? '')
      if (target) out.push(target)
    }
  })
  return out
}

/**
 * Every note this frontmatter links to explicitly, deduplicated.
 *
 * The indexer merges this into `outgoingLinks` alongside the body's links, so
 * a link written in frontmatter counts for backlinks and dead-link reporting
 * exactly like one written in prose. Rename already rewrites these — it works
 * on the whole file, not just the body — so leaving them out of the graph was
 * an inconsistency, not a policy.
 */
export function frontmatterLinkTargets(frontmatter: Record<string, unknown>): string[] {
  const out = new Set<string>()
  for (const value of Object.values(frontmatter)) {
    for (const target of bracketedTargets(value)) out.add(target)
  }
  return [...out]
}

/**
 * The note references held by a relationship field's value.
 *
 * Per element rather than per field: `["[[Ann]]", "Bob"]` is a list of two
 * people, one of whom happens to have been written without brackets. An
 * element with brackets contributes only what is inside them — the prose
 * around a link is not a second relation.
 *
 * `bare` is on when the key is a declared relation for the note's type; with
 * it off, only bracketed values count.
 */
export function relationTargets(value: unknown, bare: boolean): string[] {
  const out: string[] = []
  collect(value, (s) => {
    const bracketed = bracketedTargets(s)
    if (bracketed.length > 0) {
      out.push(...bracketed)
      return
    }
    if (!bare) return
    const plain = normalizeLinkTarget(s)
    if (plain) out.push(plain)
  })
  return out
}

/** Walks strings out of a YAML value, whatever shape it arrived in. */
function collect(value: unknown, visit: (s: string) => void): void {
  if (typeof value === 'string') {
    visit(value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collect(item, visit)
  }
}
