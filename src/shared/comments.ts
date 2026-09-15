/**
 * Anchoring for comments attached to a passage of a note.
 *
 * The stored anchor is a quote plus its surroundings, not a position: offsets
 * alone die the moment anything above them is edited, which for a note you are
 * actively writing is immediately. This is the shape the W3C Web Annotation
 * `TextQuoteSelector` settled on, and the same one OpenKnowledge uses — the
 * offsets are kept only as a hint for the fast path.
 */

/** How much text around the quote is kept to tell repeated quotes apart. */
export const CONTEXT_LENGTH = 32

export interface CommentAnchor {
  /** The quoted passage itself — the thing being commented on. */
  exact: string
  /** Text immediately before `exact`, used to disambiguate repeats. */
  prefix: string
  /** Text immediately after `exact`. */
  suffix: string
  /** Where it was last seen. A hint for the fast path, never trusted alone. */
  start: number
  end: number
  /**
   * Which match of `exact` this is, counting from the top of the note.
   *
   * Without it, two comments on the same words are the same anchor: they
   * resolve to the same place and highlight every copy of the phrase at once,
   * so a passage can only ever carry one of them. The index is what makes
   * "this occurrence" a thing an anchor can name.
   *
   * Absent on anchors written before it existed — those fall back to matching
   * by context alone.
   */
  occurrence?: number
}

export type CommentState = 'anchored' | 'orphaned'

export interface CommentMessage {
  id: string
  ts: number
  text: string
}

export interface CommentThread {
  id: string
  anchor: CommentAnchor
  state: CommentState
  resolved: boolean
  createdAt: number
  updatedAt: number
  messages: CommentMessage[]
}

/**
 * A thread plus where its quote currently sits in the note. `position` is
 * absent exactly when the thread is orphaned — the quote is gone, so there is
 * nowhere to point.
 */
export interface CommentThreadView extends CommentThread {
  position?: { start: number; end: number }
}

export interface CommentsFile {
  v: number
  relPath: string
  threads: CommentThread[]
}

export const COMMENTS_FILE_VERSION = 1

export function createAnchor(
  body: string,
  start: number,
  end: number,
  occurrence?: number
): CommentAnchor {
  const from = Math.max(0, Math.min(start, body.length))
  const to = Math.max(from, Math.min(end, body.length))
  const exact = body.slice(from, to)
  return {
    exact,
    prefix: body.slice(Math.max(0, from - CONTEXT_LENGTH), from),
    suffix: body.slice(to, to + CONTEXT_LENGTH),
    start: from,
    end: to,
    occurrence: occurrence ?? occurrenceAt(body, exact, from)
  }
}

/** How many copies of `exact` start before `at`. */
export function occurrenceAt(body: string, exact: string, at: number): number {
  if (!exact) return 0
  let count = 0
  let i = body.indexOf(exact)
  while (i !== -1 && i < at) {
    count++
    i = body.indexOf(exact, i + 1)
  }
  return count
}

export type RefindResult =
  | { status: 'anchored'; start: number; end: number; moved: boolean }
  | { status: 'orphaned' }

function allIndexesOf(haystack: string, needle: string): number[] {
  const out: number[] = []
  let i = haystack.indexOf(needle)
  while (i !== -1) {
    out.push(i)
    i = haystack.indexOf(needle, i + 1)
  }
  return out
}

/** Length of the longest common ending of `a` and `b`. */
function commonSuffixLength(a: string, b: string): number {
  let n = 0
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++
  return n
}

/** Length of the longest common beginning of `a` and `b`. */
function commonPrefixLength(a: string, b: string): number {
  let n = 0
  while (n < a.length && n < b.length && a[n] === b[n]) n++
  return n
}

/**
 * Find where an anchor's quote now lives, or report that it is gone.
 *
 * Three steps, cheapest first:
 *  1. still at the remembered offset — the overwhelmingly common case, since
 *     most edits happen somewhere else in the note;
 *  2. the quote appears exactly once — unambiguous, take it;
 *  3. it appears several times — score each occurrence by how much of the
 *     remembered surroundings still match, and take the best. Distance from
 *     the old position only breaks ties, so inserting a paragraph above does
 *     not drag the comment onto a different copy of the same sentence.
 *
 * A quote that no longer appears at all is *not* silently dropped: the caller
 * marks the thread orphaned and keeps it, quote and all, so the comment can be
 * re-attached by hand rather than lost with the text it described.
 */
export function refindAnchor(body: string, anchor: CommentAnchor): RefindResult {
  const { exact } = anchor
  // An empty quote can be "found" anywhere, which means it locates nothing.
  if (!exact) return { status: 'orphaned' }

  if (anchor.start >= 0 && body.slice(anchor.start, anchor.start + exact.length) === exact) {
    return {
      status: 'anchored',
      start: anchor.start,
      end: anchor.start + exact.length,
      moved: false
    }
  }

  const hits = allIndexesOf(body, exact)
  if (hits.length === 0) return { status: 'orphaned' }

  let best = hits[0] as number
  if (hits.length > 1) {
    let bestScore = -1
    let bestDistance = Number.POSITIVE_INFINITY
    for (const [index, hit] of hits.entries()) {
      let score =
        commonSuffixLength(anchor.prefix, body.slice(0, hit)) +
        commonPrefixLength(anchor.suffix, body.slice(hit + exact.length))
      // Landing on the copy this anchor was made from outweighs any amount of
      // matching context: when the same sentence appears twice, the words
      // around both copies are often identical, and only the index tells them
      // apart.
      if (anchor.occurrence !== undefined && index === anchor.occurrence) {
        score += CONTEXT_LENGTH * 2 + 1
      }
      const distance = Math.abs(hit - anchor.start)
      if (score > bestScore || (score === bestScore && distance < bestDistance)) {
        bestScore = score
        bestDistance = distance
        best = hit
      }
    }
  }

  return { status: 'anchored', start: best, end: best + exact.length, moved: true }
}
