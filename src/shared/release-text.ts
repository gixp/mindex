/**
 * A release summary worth showing, or nothing.
 *
 * `null` and `undefined` are here as the words, not the values. The release
 * feed is written by a shell script, and a value that was absent when it got
 * there arrives as those four or nine characters — which is what 0.3.7
 * published, and what the update notice then dutifully printed under the
 * version number.
 *
 * Shared rather than owned by the feed parser, and applied at both ends: the
 * parser cleans what arrives, and the notice refuses to draw it whatever it
 * was handed. Belt and braces on purpose — the app half only re-reads the feed
 * at launch and once an hour, so a status already in memory outlives a fix
 * that lives only in the parser, and no feed already published can be edited
 * from here.
 */
export function releaseText(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed === 'null' || trimmed === 'undefined' ? '' : trimmed
}
