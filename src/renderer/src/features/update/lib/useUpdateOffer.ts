import type { UpdateStatus } from '@shared/types'
import { useUiStore } from '@/platform/app-settings'
import { useUpdateStatus } from './useUpdateStatus'
import { useUpdateNoticeStore } from '@/features/update/store'

/**
 * One answer to "is there an update, and should it be on screen".
 *
 * Two surfaces ask it now — the button in the header and the notice in the
 * corner — and they must not disagree, which two copies of the same conditions
 * eventually would.
 *
 * The two questions are genuinely different, and that is the point of this
 * hook. **Offered** is a fact about the build: there is a newer version, or one
 * is already downloading, staged, or failed. **Shown** is about the moment: an
 * offer someone has already waved away is still offered, and still reachable
 * from the header, but it does not come back on its own.
 */
export interface UpdateOffer {
  status: UpdateStatus | null
  version: string | null
  /** There is something to act on. The header button follows this. */
  offered: boolean
  /** It should be on screen right now. The notice follows this. */
  shown: boolean
  /** Mid-flight: no choice to make, and nothing to close. */
  working: boolean
}

/**
 * The whole rule, as a function of four values.
 *
 * Pure and exported so it can be read and tested on its own: this is the part
 * that decides whether something appears over somebody's work, and it is worth
 * being able to state exactly when that happens without mounting a window.
 */
export function decideOffer(input: {
  phase: UpdateStatus['phase'] | undefined
  version: string | undefined
  /** The version turned down for good, from the settings. */
  dismissed: string | undefined
  /** The version whose notice was closed during this run. */
  closedFor: string | null
}): { offered: boolean; shown: boolean; working: boolean } {
  const { phase, dismissed, closedFor } = input
  const offered =
    phase === 'available' ||
    phase === 'downloading' ||
    phase === 'ready' ||
    phase === 'installing' ||
    phase === 'manual' ||
    phase === 'error'
  const working = phase === 'downloading' || phase === 'installing'
  const version = offered ? (input.version ?? null) : null
  if (!version) return { offered: false, shown: false, working }

  // Work already under way is never hidden: the download is paid for and this
  // is the only view of it.
  if (working) return { offered: true, shown: true, working }
  // Staged, or failed. Neither is the offer the stored dismissal was about —
  // that answered "not this version", and this is the same version part-way
  // installed — so only closing it here takes it off screen.
  if (phase === 'ready' || phase === 'manual' || phase === 'error') {
    return { offered: true, shown: closedFor !== version, working }
  }
  return { offered: true, shown: dismissed !== version && closedFor !== version, working }
}

export function useUpdateOffer(): UpdateOffer {
  const status = useUpdateStatus()
  const dismissed = useUiStore((s) => s.settings?.dismissedUpdateVersion)
  const closedFor = useUpdateNoticeStore((s) => s.closedFor)

  const { offered, shown, working } = decideOffer({
    phase: status?.phase,
    version: status?.latestVersion,
    dismissed,
    closedFor
  })

  return {
    status: status ?? null,
    version: offered ? (status?.latestVersion ?? null) : null,
    offered,
    shown,
    working
  }
}
