/** A new version: whether there is one, and what the person has chosen to do. */

/**
 * Where the update flow currently is.
 *
 *  - 'idle'        : nothing to do, or nothing asked for yet.
 *  - 'checking'    : asking the feed.
 *  - 'available'   : a newer version exists. Nothing has been downloaded — the
 *                    person decides.
 *  - 'downloading' : they said yes.
 *  - 'ready'       : downloaded and staged. It installs when the app next
 *                    closes; they can also close it now.
 *  - 'installing'  : applying it, which on macOS means quitting first.
 *  - 'manual'      : this build cannot install it for them (not packaged, a
 *                    .deb install, a Linux package the app does not own) — the
 *                    download page is the way through.
 *  - 'error'       : the attempt failed and said why.
 *
 * There is no state in which the app installs something nobody asked for, and
 * none in which the person is blocked from working. Both used to exist.
 */
export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'manual'
  | 'error'

export interface UpdateStatus {
  phase: UpdatePhase
  currentVersion: string
  /** The version the feed offers, when there is one. */
  latestVersion?: string
  /** One line about the release, from the published notes. */
  description?: string
  /** What changed, as published. May be empty. */
  notes?: string[]
  /** 0..1 while downloading. */
  progress?: number
  error?: string
}
