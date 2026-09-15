import { useVaultStore } from '@/platform/workspace'
import { openDocument } from '@/platform/documents'
import {
  buildWikilinkIndex,
  resolveWikilinkTarget,
  type LinkableNote,
  type WikilinkIndex
} from '@shared/wikilink'

/**
 * The index is rebuilt only when the notes array identity changes, which for a
 * zustand store means "when the vault actually changed". Rebuilding on every
 * click would be pointless work on a large vault, and resolving by scanning
 * every note — what this did before — was the same cost paid per link.
 */
let cachedFor: readonly LinkableNote[] | null = null
let cachedIndex: WikilinkIndex | null = null

function indexFor(notes: readonly LinkableNote[]): WikilinkIndex {
  if (cachedFor !== notes || !cachedIndex) {
    cachedFor = notes
    cachedIndex = buildWikilinkIndex(notes)
  }
  return cachedIndex
}

/**
 * Resolve a `[[target]]` to an absolute path, using the same rule main uses
 * for backlinks and dead links — see `@shared/wikilink` for why that matters.
 */
export function resolveWikilink(rawTarget: string, notes: readonly LinkableNote[]): string | null {
  return resolveWikilinkTarget(rawTarget, indexFor(notes))
}

export function openWikilink(rawData: string): void {
  if (!rawData) return
  const notes = useVaultStore.getState().notes
  // `resolveWikilinkTarget` strips the alias and anchor itself, so the raw
  // body goes straight through.
  const resolved = resolveWikilink(rawData, notes)
  if (!resolved) return
  void openDocument(resolved)
}

export function handleWikilinkClick(target: EventTarget | null): boolean {
  const el = (target as HTMLElement | null)?.closest?.('.wikilink')
  if (!el) return false
  openWikilink(el.getAttribute('data-wikilink') ?? '')
  return true
}
