
/**
 * A rewrite that has been offered and not yet answered.
 *
 * These outlive the editor that produced them. A suggestion used to live only
 * in the open view's plugin state, so switching tabs or closing one threw away
 * an answer the assistant had already spent tokens producing — and the person
 * had no way to get it back. They are written to the vault instead, and a note
 * carries however many of them are still undecided.
 *
 * Only the text is stored, never a position: the passage is found again the
 * way a comment's quote is, so the offer survives edits elsewhere in the note
 * and survives the app being closed.
 */
/**
 * Where the passage is, by its words.
 *
 * Deliberately not a `CommentAnchor`: that carries `start`/`end` offsets as a
 * fast path, and an offer has none to give — the editor knows document
 * positions, which are not file offsets, and the file may have moved on since.
 * It is found by its text every time.
 */
export interface RewriteAnchor {
  exact: string
  prefix: string
  suffix: string
  occurrence: number
}

export interface PendingSuggestion {
  id: string
  /** Where the passage is, in the markdown on disk. */
  anchor: RewriteAnchor
  /** The wording offered in its place. */
  added: string
  /** Which rewrite produced it — 'shorten', 'expand', … */
  kind: string
  /** The assistant that produced it, so the offer keeps its colour. */
  provider: string
  createdAt: number
}

export interface PendingSuggestionsFile {
  v: number
  relPath: string
  suggestions: PendingSuggestion[]
}

export const PENDING_SUGGESTIONS_VERSION = 1

/** What the editor hands over when an offer is first made. */
export interface SaveRewriteInput {
  anchor: RewriteAnchor
  added: string
  kind: string
  provider: string
}
