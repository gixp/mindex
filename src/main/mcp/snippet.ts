const WINDOW = 320

function tokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1)
}

/**
 * A window of the note around the first query term that appears in it.
 *
 * The whole point of handing the agent search results instead of file paths is
 * that it can decide what to open without opening everything, and a path with
 * a title is not enough to decide on. MiniSearch does not keep the body, so
 * this cuts the window from the file the caller has already read.
 *
 * Falls back to the opening of the note when no term matches — that happens
 * for fuzzy and prefix hits, which are matches on a form of the word that is
 * not literally in the text.
 */
export function snippetFor(body: string, query: string): string {
  const flat = body.replace(/\s+/g, ' ').trim()
  if (flat.length <= WINDOW) return flat

  const haystack = flat.toLowerCase()
  let at = -1
  for (const token of tokens(query)) {
    const found = haystack.indexOf(token)
    if (found !== -1 && (at === -1 || found < at)) at = found
  }
  if (at === -1) return `${flat.slice(0, WINDOW).trimEnd()}…`

  const start = Math.max(0, at - WINDOW / 3)
  const end = Math.min(flat.length, start + WINDOW)
  const lead = start > 0 ? '…' : ''
  const tail = end < flat.length ? '…' : ''
  return `${lead}${flat.slice(start, end).trim()}${tail}`
}
