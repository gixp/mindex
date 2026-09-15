/**
 * Where the note's body starts inside the raw source buffer.
 *
 * Source mode shows the frontmatter as literal YAML above the body, so an
 * offset into that buffer is not an offset into the note's body — and the body
 * is the only text the app has on disk to match a passage against. Anything
 * locating a selection in source mode has to subtract this first.
 *
 * Read off the buffer rather than off the stored frontmatter: the buffer is
 * what the person is editing, and while they are part-way through changing the
 * frontmatter the two disagree. Returns 0 when there is no frontmatter block,
 * which is the common case and needs no special handling by callers.
 */
export function bodyOffset(source: string): number {
  if (!source.startsWith('---')) return 0
  const afterOpen = source.indexOf('\n')
  if (afterOpen === -1) return 0

  // The closing fence is a line that is exactly `---`, which is why the search
  // is for the delimiter with newlines around it rather than for `---` on its
  // own: a horizontal rule inside the body is also three dashes.
  const close = source.indexOf('\n---', afterOpen)
  if (close === -1) return 0

  const lineEnd = source.indexOf('\n', close + 1)
  if (lineEnd === -1) return source.length

  // gray-matter drops the single blank line that conventionally follows the
  // closing fence, so the body the app holds begins after it when it is there.
  let start = lineEnd + 1
  if (source[start] === '\n') start += 1
  return start
}
