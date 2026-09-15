import type { NoteMeta } from '@shared/types'

/**
 * Notes the tree starts out with folded away, but which the user can still
 * reveal and un-hide one by one.
 *
 * The per-folder context files used to be listed here. They are not hidden
 * any more, they are simply not in the tree — see `buildTree` — because they
 * are Mindex's own bookkeeping rather than a note someone might want back.
 * Reaching one goes through the Context button on the folder's page.
 */
export const DEFAULT_HIDDEN_BASENAMES: ReadonlySet<string> = new Set(['QUICK-IDEAS.md'])

export function basenameOf(absPath: string): string {
  return absPath.split('/').pop() ?? absPath
}

/**
 * A note is hidden if the user explicitly hid it, or if it's one of the
 * default-hidden basenames and the user hasn't explicitly un-hidden that
 * particular path. Shared by the sidebar tree and the folder-view card grid
 * so both agree on what's hidden without duplicating the rule.
 */
export function computeEffectiveHidden(
  notes: NoteMeta[],
  userHidden: ReadonlySet<string>,
  userUnhidden: ReadonlySet<string>
): Set<string> {
  const set = new Set<string>(userHidden)
  for (const n of notes) {
    if (DEFAULT_HIDDEN_BASENAMES.has(basenameOf(n.path)) && !userUnhidden.has(n.path)) {
      set.add(n.path)
    }
  }
  return set
}
