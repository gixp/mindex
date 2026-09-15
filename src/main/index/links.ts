import path from 'node:path'
import type { DeadLink, LinkHealth, NoteMeta, OrphanNote } from '@shared/types'
import { isManagedFilename } from '@shared/managed-files'
import { buildWikilinkIndex, resolveWikilinkTarget } from '@shared/wikilink'

/**
 * Notes that are never linked to by design, so calling them orphans would be
 * noise rather than a finding: the per-folder context files Mindex generates
 * itself, and binary assets (an unreferenced image is a real thing, but it is
 * a different question from "a note nothing points at").
 */
function canBeOrphan(meta: NoteMeta): boolean {
  if (meta.isDirectory) return false
  if (meta.type === 'asset') return false
  if (isManagedFilename(path.basename(meta.relPath))) return false
  return meta.relPath.toLowerCase().endsWith('.md')
}

/**
 * Dead links and orphan notes, computed together because they are two readings
 * of the same pass: resolve every link once, then ask which links found
 * nothing and which notes were never found.
 *
 * Cost is one index build plus one lookup per link — the naive shape (resolve
 * each link by scanning every note) is links × notes, which on a real vault is
 * tens of millions of comparisons.
 */
export function computeLinkHealth(notes: readonly NoteMeta[]): LinkHealth {
  const index = buildWikilinkIndex(notes)
  const linked = new Set<string>()
  const deadByTarget = new Map<string, Set<string>>()

  for (const note of notes) {
    for (const raw of note.outgoingLinks) {
      const resolved = resolveWikilinkTarget(raw, index)
      if (resolved) {
        // A note linking to itself does not stop it being an orphan — nothing
        // else points at it, which is the whole question.
        if (resolved !== note.path) linked.add(resolved)
        continue
      }
      const sources = deadByTarget.get(raw) ?? new Set<string>()
      sources.add(note.relPath)
      deadByTarget.set(raw, sources)
    }
  }

  const dead: DeadLink[] = [...deadByTarget]
    .map(([target, sources]) => ({ target, sources: [...sources].sort() }))
    .sort((a, b) => b.sources.length - a.sources.length || a.target.localeCompare(b.target))

  const orphans: OrphanNote[] = notes
    .filter((n) => canBeOrphan(n) && !linked.has(n.path))
    .map((n) => ({ path: n.path, relPath: n.relPath, title: n.title, type: n.type }))
    .sort((a, b) => a.relPath.localeCompare(b.relPath))

  return { dead, orphans, checkedNotes: notes.length }
}

/**
 * Notes that link to `absPath`, resolved by the same rule the editor uses when
 * you click a link — so what the backlinks panel shows and what the dead-link
 * report considers a link can no longer disagree.
 */
export function computeBacklinks(notes: readonly NoteMeta[], absPath: string): NoteMeta[] {
  const index = buildWikilinkIndex(notes)
  const out: NoteMeta[] = []
  for (const note of notes) {
    if (note.path === absPath) continue
    for (const raw of note.outgoingLinks) {
      if (resolveWikilinkTarget(raw, index) === absPath) {
        out.push(note)
        break
      }
    }
  }
  return out
}
