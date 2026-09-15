/**
 * Enough of a web page to write a note about it.
 *
 * Not a reader and not a parser — a title and the visible words, which is all
 * the capture step needs to decide what a link is about. Anything cleverer
 * (readability heuristics, boilerplate stripping) is a library's job and a
 * later decision; this is deliberately the smallest thing that turns a bare
 * address into something worth filing.
 *
 * Every failure is ordinary: a page can be behind a login, be too large, take
 * too long, or not be a page at all. None of those is an error worth stopping
 * a capture for — the address itself is still worth keeping — so this returns
 * null and the caller carries on with what it had.
 */

const TIMEOUT_MS = 8_000
/** Past this, a page is not an article and reading more of it buys nothing. */
const MAX_BYTES = 512 * 1024

export interface WebPage {
  url: string
  title: string
  /** Visible text, collapsed and cut to something a prompt can hold. */
  text: string
}

const BLOCK_TAGS = /<\/(p|div|section|article|li|h[1-6]|tr|blockquote)>/gi

export function extractTitle(html: string): string | null {
  const og = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(html)
  if (og?.[1]) return decodeEntities(og[1]).trim() || null
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  return t?.[1] ? decodeEntities(t[1]).replace(/\s+/g, ' ').trim() || null : null
}

export function extractText(html: string, limit = 6000): string {
  const body = html
    // Whole elements whose content is never readable text. Dropped before the
    // tag strip below, which would otherwise leave their innards behind as
    // "words" — a page's stylesheet is not a page's article.
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(BLOCK_TAGS, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  return (
    decodeEntities(body)
      // The non-breaking space is written as an escape: as a literal it is a
      // character nobody can see in the source and a linter rightly rejects.
      .replace(/[ \t\u00a0]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .join('\n')
      .slice(0, limit)
  )
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…'
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith('#')) {
      const code =
        body[1]?.toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : Number(body.slice(1))
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[body.toLowerCase()] ?? whole
  })
}

/** A single address, or null when the text is anything else. */
export function loneUrl(text: string): string | null {
  const t = text.trim()
  if (/\s/.test(t) || !/^https?:\/\//i.test(t)) return null
  try {
    return new URL(t).toString()
  } catch {
    return null
  }
}

export async function fetchPage(url: string, signal?: AbortSignal): Promise<WebPage | null> {
  const control = new AbortController()
  const timer = setTimeout(() => control.abort(), TIMEOUT_MS)
  signal?.addEventListener('abort', () => control.abort(), { once: true })
  try {
    const res = await fetch(url, {
      signal: control.signal,
      redirect: 'follow',
      headers: { accept: 'text/html,application/xhtml+xml' }
    })
    if (!res.ok) return null
    if (!/text\/html|xhtml/i.test(res.headers.get('content-type') ?? '')) return null
    const buf = await res.arrayBuffer()
    const html = new TextDecoder().decode(buf.slice(0, MAX_BYTES))
    return { url, title: extractTitle(html) ?? url, text: extractText(html) }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
