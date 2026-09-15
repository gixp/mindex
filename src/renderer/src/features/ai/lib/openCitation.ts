import type { Citation } from '@shared/ai'
import { useVaultStore } from '@/platform/workspace'
import { openDocument } from '@/platform/documents'

/**
 * Open the note a citation points at.
 *
 * The citation carries a vault-relative path, and the vault store already holds
 * every note's absolute path next to its relative one — so this is a lookup,
 * not an OS-path join (which would have to care which slash the platform uses).
 * A citation whose note has since been deleted or renamed simply does nothing.
 *
 * Scrolling to `lineStart` is deliberately not done yet: the editor has no
 * public "reveal line N" entry point until M1 wires one onto the same
 * mechanism the in-note search bar uses. Opening the note is the M0 promise.
 */
export async function openCitation(citation: Citation): Promise<void> {
  const notes = useVaultStore.getState().notes
  const match = notes.find((n) => n.relPath === citation.path)
  if (!match) return
  await openDocument(match.path)
}

/** `Pricing.md:12` / `Pricing.md:12–15` / `Pricing.md`, for a chip label. */
export function citationLabel(c: Citation): string {
  const name = c.path.split('/').pop() ?? c.path
  if (c.lineStart === undefined) return name
  if (c.lineEnd === undefined || c.lineEnd === c.lineStart) return `${name}:${c.lineStart}`
  return `${name}:${c.lineStart}–${c.lineEnd}`
}
