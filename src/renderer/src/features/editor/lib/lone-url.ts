/**
 * Whether `text` is nothing but one http(s) URL — the "trust the gesture"
 * check that lets pasting a URL over a selection turn the selection into a
 * link rather than replacing it with the raw address.
 *
 * Deliberately narrow: a URL followed by trailing prose ("see
 * https://example.com for more") is not this — it must be the *whole* pasted
 * text, or the intent to link specifically (as opposed to just pasting a
 * sentence that happens to contain a link) is a guess, not a read.
 */
const LONE_URL_RE = /^https?:\/\/\S+$/i

export function loneUrl(text: string): string | null {
  const trimmed = text.trim()
  return LONE_URL_RE.test(trimmed) ? trimmed : null
}
