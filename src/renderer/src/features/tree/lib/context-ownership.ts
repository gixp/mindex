import type { ContextOverview } from '@shared/suggestions'
import type { FolderStatusEntry } from '@shared/types'

/**
 * Which folders a tree row speaks for.
 *
 * The rule is visibility, not depth: **the row you can see answers for the
 * folders you cannot**.
 *
 * - An **expanded** folder answers only for itself. Everything under it has a
 *   row of its own on screen, and that row carries its own button — a parent
 *   repeating it would be duplicate noise, and the old code's version of that
 *   repeat was worse than noise: it rendered a *disabled* button, an
 *   affordance that could not be pressed.
 * - A **collapsed** folder answers for itself and everything beneath it. Its
 *   descendants have no rows, so if it stayed silent their work would be
 *   invisible until the user happened to expand the right branch.
 *
 * Nesting takes care of itself. A row only renders when every ancestor is
 * expanded, so for any hidden folder the first collapsed ancestor is the
 * deepest row still on screen — exactly one row claims it, and it is the one
 * the user is looking at.
 *
 * One consequence is deliberate: the button on a collapsed folder can stand
 * for several pending regenerations at once, and pressing it starts all of
 * them.
 */
export interface OwnedContextWork {
  /** Regenerating right now. */
  running: string[]
  /** Last run failed — pressing retries these. */
  failed: string[]
  /** Has a context file, but the notes have moved on since it was written. */
  stale: string[]
  /** Has no context file at all, and is not excluded from context. */
  missing: string[]
}

export function ownedContextWork(
  folderRel: string,
  collapsed: boolean,
  byFolder: Record<string, FolderStatusEntry>,
  overview: ContextOverview | null
): OwnedContextWork {
  const metrics = new Map((overview?.folders ?? []).map((f) => [f.folderRel, f]))
  const candidates = new Set<string>([folderRel, ...Object.keys(byFolder), ...metrics.keys()])

  const out: OwnedContextWork = { running: [], failed: [], stale: [], missing: [] }
  const prefix = folderRel ? `${folderRel}/` : ''

  for (const rel of candidates) {
    if (rel !== folderRel) {
      if (!collapsed) continue
      if (!rel.startsWith(prefix)) continue
    }
    const status = byFolder[rel]?.status
    const own = metrics.get(rel)

    if (status === 'running') {
      out.running.push(rel)
      continue
    }
    if (status === 'failed') {
      out.failed.push(rel)
      continue
    }
    // Stale before missing, matching what the icons meant before: a folder
    // that was touched this session reads as "needs updating" even if it has
    // no context file yet.
    //
    // `status` only knows staleness from a file-touch seen this session; it
    // never sees a folder that went stale before the watcher started or while
    // the app was closed. `staleness` is the disk-computed truth (note mtimes
    // against the file's `generatedAt`) and covers that case too.
    if (status === 'pending' || own?.staleness === 'behind') {
      out.stale.push(rel)
      continue
    }
    if (own && !own.hasContextFile && !own.aiDisabled) out.missing.push(rel)
  }

  out.running.sort()
  out.failed.sort()
  out.stale.sort()
  out.missing.sort()
  return out
}
