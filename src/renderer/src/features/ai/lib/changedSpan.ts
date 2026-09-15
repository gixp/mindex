/**
 * The part of a note a proposal actually changes.
 *
 * A rewrite replaces one passage and leaves the rest of the file alone, so
 * showing it as a two-column diff of the whole document is the wrong shape
 * twice over: the columns are unreadable at the width a card can afford, and
 * almost every line in them is unchanged. Trimming the matching head and tail
 * leaves exactly the passage that moved, which is the thing being decided.
 *
 * Exact, not approximate — a common prefix and a common suffix — so for a
 * single splice, which is what a rewrite produces, it recovers precisely the
 * replacement that was made.
 */
export interface ChangedSpan {
  /** Text the proposal takes out. Empty when it only adds. */
  removed: string
  /** Text the proposal puts in. Empty when it only deletes. */
  added: string
}

export function changedSpan(before: string, after: string): ChangedSpan {
  if (before === after) return { removed: '', added: '' }

  const limit = Math.min(before.length, after.length)

  let head = 0
  while (head < limit && before[head] === after[head]) head++

  let tail = 0
  while (
    tail < limit - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail++
  }

  // A replacement is then pushed out to whole words at both ends. Cutting to
  // the exact differing characters is precise and reads badly: "renewed"
  // against "renewing" comes out as "ed" against "ing", and the reader has to
  // rebuild the word to see what happened. Only a replacement is widened — for
  // a pure insertion or deletion the exact text is the whole story, and
  // padding it with words that did not change would say otherwise.
  if (head < before.length - tail && head < after.length - tail) {
    while (head > 0 && /\S/.test(before[head - 1] as string)) head--
    // Moving the far end *outward* means taking characters off the common
    // suffix, so the counter goes down, not up. Growing it instead ate
    // backwards into the very text being described.
    while (tail > 0 && /\S/.test(before[before.length - tail] as string)) tail--
  }

  return {
    removed: before.slice(head, before.length - tail).trim(),
    added: after.slice(head, after.length - tail).trim()
  }
}
