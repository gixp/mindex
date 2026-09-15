/**
 * A view of markdown with its syntax taken out, and a way back.
 *
 * The editor hands over the passage a person selected as **plain text** — its
 * document tree has no asterisks, no hashes, no link brackets, because those
 * are the syntax that produced the tree rather than part of it. The file on
 * disk still has all of them. So a selection reading "the plan is **five
 * dollars**" arrives as "the plan is five dollars" and is nowhere to be found
 * in the file, which is exactly the failure that used to be reported as "try
 * selecting plain text" — an excuse rather than a behaviour.
 *
 * This produces the same plain reading of the file, plus an index back to
 * where each character came from, so a passage located in the plain view can
 * be turned into a real range in the real file.
 *
 * It is a projection, not a parser. It does not need to understand markdown;
 * it needs to drop exactly the characters the editor's own tree drops, and to
 * remember what it dropped.
 */

export interface PlainProjection {
  /** The text as the editor would show it. */
  text: string
  /** `map[i]` is where `text[i]` sits in the original source. */
  map: number[]
}

const LINE_PREFIX =
  /^(?:[ \t]*(?:>[ \t]?)*)(?:#{1,6}[ \t]+|[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d+[.)][ \t]+)?/

export function projectPlain(source: string): PlainProjection {
  const out: string[] = []
  const map: number[] = []
  let i = 0
  let atLineStart = true

  const push = (ch: string, from: number): void => {
    out.push(ch)
    map.push(from)
  }

  while (i < source.length) {
    if (atLineStart) {
      // Whatever opens the line and is not part of its words: quote markers,
      // heading hashes, a bullet, a number, a task box.
      const rest = source.slice(
        i,
        source.indexOf('\n', i) === -1 ? undefined : source.indexOf('\n', i)
      )
      const m = LINE_PREFIX.exec(rest)
      if (m && m[0].length > 0) i += m[0].length
      atLineStart = false
      continue
    }

    const ch = source[i] as string

    if (ch === '\n') {
      push('\n', i)
      i += 1
      atLineStart = true
      continue
    }

    // A backslash escape contributes the character it protects, not itself.
    if (ch === '\\' && i + 1 < source.length) {
      push(source[i + 1] as string, i + 1)
      i += 2
      continue
    }

    // Emphasis and code fences around words. Runs are skipped whole so `**`
    // does not leave a stray `*` behind.
    if (ch === '*' || ch === '_' || ch === '~' || ch === '`') {
      let n = 0
      while (source[i + n] === ch) n++
      i += n
      continue
    }

    // `[[Target]]` / `[[Target|Alias]]` — the editor shows the alias when
    // there is one, and the target otherwise.
    if (source.startsWith('[[', i)) {
      const close = source.indexOf(']]', i + 2)
      if (close !== -1) {
        const inner = source.slice(i + 2, close)
        const bar = inner.indexOf('|')
        const shownFrom = bar === -1 ? i + 2 : i + 2 + bar + 1
        const shown = bar === -1 ? inner : inner.slice(bar + 1)
        for (let k = 0; k < shown.length; k++) push(shown[k] as string, shownFrom + k)
        i = close + 2
        continue
      }
    }

    // `[text](target)` and `![alt](target)` — the words stay, the plumbing goes.
    if (ch === '[' || (ch === '!' && source[i + 1] === '[')) {
      const open = ch === '!' ? i + 1 : i
      const close = source.indexOf(']', open + 1)
      if (close !== -1 && source[close + 1] === '(') {
        const end = source.indexOf(')', close + 2)
        if (end !== -1) {
          // An image contributes nothing readable, so its alt text is dropped
          // with it — the editor shows a picture, not the words.
          if (ch !== '!') {
            for (let k = open + 1; k < close; k++) push(source[k] as string, k)
          }
          i = end + 1
          continue
        }
      }
    }

    push(ch, i)
    i += 1
  }

  return { text: out.join(''), map }
}

/** Emphasis and code marks, which come in pairs and must not be orphaned. */
const INLINE_MARK = /[*_~`]/

/**
 * Where a plain-view range `[from, to)` sits in the original source.
 *
 * The ends are pushed outward over any emphasis marks immediately beside them.
 * Without that, selecting a sentence whose first word is bold produces a range
 * starting *inside* the `**`, and replacing it would leave those two asterisks
 * behind, opening emphasis that never closes and italicising the rest of the
 * note. Marks in the middle need no such care: the range is one unbroken span
 * of the file, so anything between the ends is carried along already.
 *
 * Only inline marks, deliberately. A bullet or a heading's hashes sit at the
 * start of a line and are not paired with anything, so swallowing them would
 * silently delete the bullet rather than protect it.
 */
export function toSourceRange(
  projection: PlainProjection,
  from: number,
  to: number,
  source: string
): { start: number; end: number } | null {
  if (to <= from || from < 0 || to > projection.map.length) return null
  const first = projection.map[from]
  const last = projection.map[to - 1]
  if (first === undefined || last === undefined) return null

  let start = first
  while (start > 0 && INLINE_MARK.test(source[start - 1] as string)) start -= 1

  let end = last + 1
  while (end < source.length && INLINE_MARK.test(source[end] as string)) end += 1

  return { start, end }
}
