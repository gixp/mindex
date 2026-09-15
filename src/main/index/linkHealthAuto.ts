import { onFileChange } from '@main/vault/events'
import { getCachedAppSettings } from '@main/settings/app-settings'
import { getLinkHealth } from './indexer'
import type { LinkHealth } from '@shared/types'

/**
 * Recomputing link health (dead links, orphan notes) on its own, the same
 * off/manual/auto idea as Auto Context — except there's no cost to gate here:
 * `computeLinkHealth` is a pure read over the already-loaded note index, not
 * an AI call, so a manual check is always available regardless of this
 * setting. This only decides whether it *also* happens on its own.
 *
 * `applyFileChange` (vault/opener.ts) already updates the in-memory index
 * for the changed file before it calls `emitFileChange` — so by the time
 * this listener runs, there's nothing to wait on. The debounce is purely to
 * let a burst of saves (fast typing, an agent editing several files, a git
 * pull) settle into one recompute instead of one per file.
 */
const DEBOUNCE_MS = 2_000

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let offFileChange: (() => void) | null = null

type UpdateBroadcastFn = (health: LinkHealth) => void
let broadcastUpdate: UpdateBroadcastFn | null = null

/** Wired in once from `ipc/broadcast.ts`, with the real `BrowserWindow`. */
export function setLinkHealthBroadcast(fn: UpdateBroadcastFn | null): void {
  broadcastUpdate = fn
}

/** Call once at startup — installs a standing listener that only actually
 *  does anything while `settings.linkHealth.autoEnabled` is true. */
export function installLinkHealthAuto(): void {
  if (offFileChange) return
  offFileChange = onFileChange(() => {
    if (!getCachedAppSettings().linkHealth?.autoEnabled) return
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      broadcastUpdate?.(getLinkHealth())
    }, DEBOUNCE_MS)
  })
}
