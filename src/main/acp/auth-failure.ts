/**
 * Recognising an assistant that has been signed out mid-conversation.
 *
 * The pre-flight check in `job.ts` asks the disk whether credentials exist,
 * which answers "is anyone signed in" and not "is that sign-in still good". An
 * OAuth session that expired leaves the keychain entry exactly where it was, so
 * the first sign of it is the turn itself failing — and what comes back is
 * prose, written by whichever vendor's CLI said it.
 *
 * Hence matching on text, which is a thing to do sparingly. It is confined to
 * a turn that already failed: the cost of a false positive there is a sign-in
 * button nobody needed, and the cost of a miss is the adapter's own log tail
 * shown to somebody who cannot act on it.
 */

/**
 * Phrases seen from the three CLIs, lowercased.
 *
 * The first is Claude's, quoted from a real failure. The rest are the wordings
 * the others use for the same state. Deliberately not 'unauthorized' or
 * 'forbidden' on their own — those are ordinary words in an answer about an
 * HTTP problem, and this text can contain the assistant's own prose.
 */
const PHRASES = [
  'oauth session expired',
  'oauth token expired',
  'could not be refreshed',
  'failed to authenticate',
  'authentication failed',
  'not authenticated',
  'invalid api key',
  'authentication_error',
  'please run /login',
  'please sign in',
  'please log in',
  'session has expired',
  'credentials have expired',
  're-authenticate'
]

/** Whether this failure is an assistant asking to be signed in again. */
export function looksLikeAuthFailure(...texts: Array<string | undefined>): boolean {
  const haystack = texts
    .filter((t): t is string => !!t)
    .join('\n')
    .toLowerCase()
  if (!haystack) return false
  return PHRASES.some((p) => haystack.includes(p))
}

/**
 * The line a person reads, with the raw text kept underneath.
 *
 * The chip shows the first line and the details panel shows all of it, so this
 * is how the assistant's own words survive without being the headline. The
 * headline mattered: the raw text of this failure is the adapter's log tail,
 * which says `phase=read-transcript` and nothing about signing in.
 */
export function authFailureMessage(label: string, raw: string): string {
  return `${label} is signed out — its session expired.\n\n${raw}`.trim()
}
