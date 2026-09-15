import type { NoteHit } from './protocol'

/**
 * What a conversation is allowed to reach through Mindex's own vault tools.
 *
 * The composer has had a Scope row for a while, and until now it was a
 * sentence in the prompt: "work from this note, do not go looking". An
 * assistant that decides otherwise was free to, because nothing stopped it.
 * This is the part that stops it.
 *
 * ## What it fences, and what it cannot
 *
 * It fences the six tools Mindex serves — search, query, backlinks, read,
 * create, update. Those run in this process, so a request for a note outside
 * the scope is refused and a search result outside it never comes back.
 *
 * It does **not** fence the assistant's own file tools. A CLI that can open a
 * file on disk can still open any file in the vault, and no setting Mindex
 * sends over the protocol changes that. So this narrows what Mindex hands over
 * and what it will answer; it is not a sandbox, and saying otherwise would be
 * the kind of promise a person relies on and then discovers was decoration.
 */

export type ScopeKind = 'note' | 'folder' | 'vault'

export interface Scope {
  kind: ScopeKind
  /**
   * The note the conversation is anchored to, vault-relative.
   *
   * Empty when nothing is open, which makes every scope behave as the whole
   * vault — a fence around nothing would refuse every call rather than narrow
   * anything.
   */
  note: string
}

/** The folder a note lives in, vault-relative. Empty at the root. */
export function folderOf(relPath: string): string {
  const at = relPath.lastIndexOf('/')
  return at === -1 ? '' : relPath.slice(0, at)
}

/** Compared with separators, so `Projects` never matches `Projects-old`. */
function isInsideFolder(relPath: string, folder: string): boolean {
  if (folder === '') return true
  return relPath === folder || relPath.startsWith(`${folder}/`)
}

/**
 * Whether one note is reachable under this scope.
 *
 * Paths are compared vault-relative and with forward slashes; anything else is
 * a caller that has not normalised, and is refused rather than guessed at.
 */
export function allows(scope: Scope | null | undefined, relPath: string): boolean {
  if (!scope || scope.kind === 'vault') return true
  if (!scope.note) return true
  const path = relPath.replace(/\\/g, '/').replace(/^\.\//, '')
  if (path.startsWith('/') || path.includes('..')) return false
  if (scope.kind === 'note') return path === scope.note
  return isInsideFolder(path, folderOf(scope.note))
}

/** The same rule over a list of results. */
export function withinScope<T extends { path: string }>(
  scope: Scope | null | undefined,
  hits: T[]
): T[] {
  if (!scope || scope.kind === 'vault') return hits
  return hits.filter((h) => allows(scope, h.path))
}

/** What a refusal says. Names the scope, so the assistant can act on it. */
export function refusal(scope: Scope, relPath: string): string {
  const where = scope.kind === 'note' ? scope.note : folderOf(scope.note) || 'the vault root'
  return (
    `Out of scope: ${relPath}. This conversation is limited to ${where}. ` +
    `Ask the person to widen the scope if you need more.`
  )
}

/**
 * The assistant's own tools to switch off while the scope is narrow.
 *
 * The second half of the fence, and the only half that reaches past Mindex's
 * own tools. Where an adapter accepts it — Claude's does, on `session/new` —
 * these are the ways a CLI reads or searches the disk directly, going round
 * the vault tools that would have refused.
 *
 * Deliberately not `Write` or `Edit`: a narrow scope is about what may be
 * *read*, and switching off writing would silently break "write the answer
 * into this note", which is a different row entirely.
 *
 * Names are Claude's own. An adapter that does not know them ignores the list,
 * which is the right failure — the vault tools stay fenced for it either way.
 */
export const READ_TOOLS_OUTSIDE_MINDEX = ['Read', 'Glob', 'Grep', 'Bash', 'WebFetch']

/**
 * What to switch off for a scope, or nothing at all.
 *
 * Empty for the whole vault, which is almost every conversation — so the
 * ordinary case sends no `_meta` and opens exactly the session it always did.
 */
export function toolsToSilence(scope: Scope | null | undefined): string[] {
  return normalise(scope) ? READ_TOOLS_OUTSIDE_MINDEX : []
}

/** Narrowed to nothing is not a scope; treat it as the whole vault. */
export function normalise(scope: Scope | null | undefined): Scope | null {
  if (!scope) return null
  if (scope.kind === 'vault' || !scope.note) return null
  return scope
}

export type { NoteHit }
