/**
 * One definition of what a `[[wikilink]]` points at, shared by the renderer
 * (opening a link on click) and main (backlinks, dead links, orphans).
 *
 * It exists because there were two: the renderer resolved a target by path,
 * then case-insensitively by basename or title, while `getBacklinks` in the
 * indexer matched only an exact, case-sensitive basename or path. So
 * `[[my note]]` pointing at `My Note.md` opened fine in the editor but did not
 * appear in that note's backlinks — and a dead-link report built on either
 * rule alone would have contradicted the other. Whatever the rule is, both
 * sides now have to agree on it.
 */

export interface LinkableNote {
  path: string
  relPath: string
  title: string
}

/**
 * Lookup tiers, most specific first. Kept as separate maps rather than one
 * merged map so a path match always beats a title match, even when a
 * different note owns the title.
 */
export interface WikilinkIndex {
  byPath: Map<string, string>
  byBasename: Map<string, string>
  byTitle: Map<string, string>
}

function norm(s: string): string {
  return s.trim().toLowerCase()
}

function stripExt(s: string): string {
  return s.replace(/\.md$/i, '')
}

function basenameOf(relPath: string): string {
  return relPath.split('/').pop() ?? relPath
}

/** First note wins on a collision, so resolution is stable for a given order. */
function claim(map: Map<string, string>, key: string, value: string): void {
  if (key && !map.has(key)) map.set(key, value)
}

export function buildWikilinkIndex(notes: readonly LinkableNote[]): WikilinkIndex {
  const byPath = new Map<string, string>()
  const byBasename = new Map<string, string>()
  const byTitle = new Map<string, string>()

  for (const note of notes) {
    const rel = norm(note.relPath)
    claim(byPath, rel, note.path)
    claim(byPath, stripExt(rel), note.path)

    const base = norm(basenameOf(note.relPath))
    claim(byBasename, base, note.path)
    claim(byBasename, stripExt(base), note.path)

    claim(byTitle, norm(note.title), note.path)
  }

  return { byPath, byBasename, byTitle }
}

/**
 * Reduce a raw link body to the target it names.
 *
 * `extractWikilinks` already drops `#anchor` and `|alias` when building the
 * index, but click handling passes the raw body through, so this handles both
 * and callers do not have to remember which shape they hold.
 */
export function normalizeLinkTarget(raw: string): string {
  const pipe = raw.indexOf('|')
  const withoutAlias = pipe >= 0 ? raw.slice(0, pipe) : raw
  const hash = withoutAlias.indexOf('#')
  const withoutAnchor = hash >= 0 ? withoutAlias.slice(0, hash) : withoutAlias
  return withoutAnchor.trim()
}

/**
 * The absolute path a target resolves to, or `null` if nothing answers to it —
 * which is exactly what makes a link "dead".
 *
 * Matching is case-insensitive at every tier. A target containing `/` is a
 * path and is only ever matched as one: `[[Projects/Notes]]` must not silently
 * land on a note merely titled "Projects/Notes".
 */
export function resolveWikilinkTarget(raw: string, index: WikilinkIndex): string | null {
  const target = normalizeLinkTarget(raw)
  if (!target) return null
  const key = norm(target)

  const byPath = index.byPath.get(key)
  if (byPath) return byPath
  if (target.includes('/')) return null

  return index.byBasename.get(key) ?? index.byTitle.get(key) ?? null
}
