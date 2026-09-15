/**
 * What the assistant already wrote about a folder, as plain running text.
 *
 * The Purpose section of a folder's context file is free-form markdown — a
 * sentence, a paragraph, sometimes a bullet list. Nowhere that shows it has
 * room for markdown, so it is flattened here once and read from in two
 * shapes: the whole thing at the top of a folder's own page, and a clipped
 * line on a folder card in the grid. Nothing is fetched: the text is already
 * in the context overview the app keeps live for the tree's status dots.
 */

const MAX_CHARS = 150

/** Markdown out, one paragraph of running text in its place. */
export function flattenPurpose(purpose: string | undefined | null): string {
  if (!purpose) return ''
  return purpose
    .split('\n')
    .map(stripMarkup)
    .filter((line) => line.length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The same text, cut to something that fits on a card. */
export function summarizePurpose(purpose: string | undefined | null): string {
  const flat = flattenPurpose(purpose)
  if (flat.length <= MAX_CHARS) return flat
  const cut = flat.slice(0, MAX_CHARS)
  const lastSpace = cut.lastIndexOf(' ')
  // Only break on a space if there is one reasonably late in the cut —
  // otherwise a single very long token would shrink the line to nothing.
  const kept = lastSpace > MAX_CHARS * 0.6 ? cut.slice(0, lastSpace) : cut
  return `${kept.replace(/[\s,;:.—-]+$/, '')}…`
}

/** Markdown that would read as punctuation noise once the text is inline. */
function stripMarkup(line: string): string {
  return line
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/^\s*\d+[.)]\s+/, '')
    .replace(/^\s*>\s?/, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target, alias) => alias || target)
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)(.+?)\1/g, '$2')
    .trim()
}
