import type { SyncMode, SyncStatus } from '@shared/types'
import { onFileChange } from '@main/vault/events'
import { getVaultSettings, patchVaultSettings } from '@main/settings/vault-settings'
import { runGit } from './spawn'
import { commit, pull, push } from './mutations'
import { getGitStatus, refreshGitStatusNow } from './status'
import { resolveGitHubToken } from './github-token'

/**
 * Keeping a vault in step with its remote, unattended.
 *
 * Deliberately conservative, because this is the only thing in Mindex that
 * writes to someone else's repository without being asked each time:
 *
 *  - **Off by default.** The user turns it on per vault.
 *  - **Never `--force`, ever.** Not as a fallback, not on a rejected push.
 *  - **A conflict stops the loop.** It is surfaced and left alone; merging on
 *    the user's behalf is how you lose someone's writing.
 *  - **`follow` never pushes.** Only `full` does, and only what is already
 *    committed plus whatever it commits itself.
 *
 * Cadence is a periodic tick plus a debounced nudge on file changes — the tick
 * catches other people's commits, the nudge catches yours without waiting out
 * the interval.
 */

const TICK_MS = 5 * 60 * 1000
/** Long enough that a burst of agent writes settles into one commit. */
const CHANGE_DEBOUNCE_MS = 20_000

let status: SyncStatus = { mode: 'off', state: 'disabled', lastSyncedAt: null }
let vaultRoot: string | null = null
let tickTimer: ReturnType<typeof setInterval> | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let offFileChange: (() => void) | null = null
let running = false

type StatusBroadcastFn = (status: SyncStatus) => void
let broadcastStatus: StatusBroadcastFn | null = null

/** Wired in once from `ipc/broadcast.ts`, with the real `BrowserWindow`. */
export function setSyncStatusBroadcast(fn: StatusBroadcastFn | null): void {
  broadcastStatus = fn
}

function broadcast(): void {
  broadcastStatus?.(status)
}

function setStatus(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch }
  broadcast()
}

export function getSyncStatus(): SyncStatus {
  return status
}

/** Start (or restart) the loop for a vault, reading its stored mode. */
export async function startAutoSync(root: string): Promise<void> {
  stopAutoSync()
  vaultRoot = root
  const settings = await getVaultSettings()
  const mode = settings.autoSync?.mode ?? 'off'
  status = {
    mode,
    state: mode === 'off' ? 'disabled' : 'idle',
    lastSyncedAt: null
  }
  broadcast()
  if (mode === 'off') return
  arm()
}

function arm(): void {
  tickTimer = setInterval(() => void cycle('tick'), TICK_MS)
  tickTimer.unref?.()
  offFileChange = onFileChange(() => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      void cycle('change')
    }, CHANGE_DEBOUNCE_MS)
  })
  // Don't sync the instant a vault opens: the indexer, the folder-context
  // runner and the living index all write on open, and committing that as the
  // user's work before they have touched anything is startling.
  setTimeout(() => void cycle('tick'), CHANGE_DEBOUNCE_MS)
}

export function stopAutoSync(): void {
  if (tickTimer) clearInterval(tickTimer)
  if (debounceTimer) clearTimeout(debounceTimer)
  tickTimer = null
  debounceTimer = null
  offFileChange?.()
  offFileChange = null
  vaultRoot = null
  status = { mode: status.mode, state: 'disabled', lastSyncedAt: status.lastSyncedAt }
}

export async function setSyncMode(mode: SyncMode): Promise<SyncStatus> {
  await patchVaultSettings({ autoSync: { mode } })
  const root = vaultRoot
  if (!root) {
    setStatus({ mode, state: 'disabled' })
    return status
  }
  await startAutoSync(root)
  return status
}

/** An explicit "sync now". Works in every mode, `off` included. */
export async function syncNow(): Promise<SyncStatus> {
  await cycle('manual')
  return status
}

/**
 * One pass: pull, then — in `full`, or when asked by hand — commit anything
 * outstanding and push.
 *
 * `reason` decides whether a push is allowed at all. A scheduled pass in
 * `follow` pulls and stops; a manual one pushes regardless of mode, because
 * the user pressed the button.
 */
async function cycle(reason: 'tick' | 'change' | 'manual'): Promise<void> {
  const root = vaultRoot
  if (!root || running) return
  if (reason !== 'manual' && status.mode === 'off') return
  // A conflict is a stop, not a pause: nothing automatic runs again until the
  // user has resolved it and asked for a sync by hand.
  if (status.state === 'conflict' && reason !== 'manual') return

  running = true
  setStatus({ state: 'syncing', message: undefined })
  try {
    const before = await getGitStatus(root)
    if (!before.isRepo) {
      setStatus({ state: 'disabled', message: 'This vault is not a git repository' })
      return
    }
    if (!before.branch.upstream) {
      setStatus({ state: 'error', message: 'This branch has no upstream to sync with' })
      return
    }
    if (!(await hasNetworkCredentials(root))) {
      setStatus({ state: 'auth-error', message: 'Not signed in to GitHub' })
      return
    }

    const pulled = await pull(root)
    if (pulled.hadConflicts) {
      setStatus({ state: 'conflict', message: 'Merge conflicts — resolve them in Source Control' })
      refreshGitStatusNow()
      return
    }

    const mayPush = reason === 'manual' || status.mode === 'full'
    if (mayPush) {
      const after = await getGitStatus(root)
      if (after.files.length > 0) {
        await runGit(['add', '-A'], { cwd: root, timeoutMs: 60_000 })
        await commit(root, autoCommitMessage(after.files.length))
      }
      const fresh = await getGitStatus(root)
      if (fresh.branch.ahead > 0) await push(root)
    }

    setStatus({ state: 'idle', lastSyncedAt: Date.now(), message: undefined })
    refreshGitStatusNow()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    setStatus({ state: classify(message), message })
  } finally {
    running = false
  }
}

function autoCommitMessage(count: number): string {
  return `Sync ${count} ${count === 1 ? 'change' : 'changes'}`
}

/**
 * Whether a push has any chance of authenticating.
 *
 * Only asked about GitHub remotes — a repository on another host may well have
 * working credentials configured in git itself, and refusing to sync it
 * because Mindex has no GitHub token would be wrong.
 */
async function hasNetworkCredentials(root: string): Promise<boolean> {
  const remote = await runGit(['remote', 'get-url', 'origin'], { cwd: root, timeoutMs: 5_000 })
  const url = remote.stdout.toString('utf8').trim()
  if (!/github\.com/i.test(url)) return true
  return (await resolveGitHubToken().catch(() => null)) !== null
}

function classify(message: string): SyncStatus['state'] {
  if (/authentication|permission denied|could not read (username|password)/i.test(message)) {
    return 'auth-error'
  }
  if (/could not resolve host|network is unreachable|timed out|offline/i.test(message)) {
    return 'offline'
  }
  if (/conflict/i.test(message)) return 'conflict'
  return 'error'
}
