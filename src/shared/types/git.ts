/** Version control and syncing a workspace with its remote. */

export type GitFileState =
  | 'unmodified'
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'unmerged'
  | 'untracked'
  | 'ignored'

export interface GitFileEntry {
  path: string
  origPath?: string
  indexState: GitFileState
  worktreeState: GitFileState
  conflicted: boolean
}

export interface GitBranchInfo {
  name: string | null
  upstream: string | null
  ahead: number
  behind: number
  detached: boolean
}

export interface GitStatusSnapshot {
  branch: GitBranchInfo
  files: GitFileEntry[]
  isRepo: boolean
  /**
   * Whether git can be run on this machine at all.
   *
   * Separate from `isRepo` because the two used to be the same answer, and
   * they are not the same problem. Every failed git command collapsed into
   * "not a repository", so a machine with no git looked exactly like a vault
   * nobody had put under version control — and the app offered to publish it,
   * which could not work and only said so at the end, after a name had been
   * typed and a visibility chosen.
   */
  gitAvailable: boolean
}

export interface GitInfo {
  version: string | null
  userName: string | null
  userEmail: string | null
  remoteUrl: string | null
}

// --- GitHub -----------------------------------------------------------------
/** Who Mindex is talking to GitHub as, and how it got the right to. */
export interface GitHubIdentity {
  login: string
  name: string | null
  avatarUrl: string | null
  /** `gh-cli` means the token is the GitHub CLI's, re-read on every use and
   *  never stored here — signing out of `gh` signs out of Mindex too. */
  source: 'mindex' | 'gh-cli'
}

export interface GitHubAuthState {
  signedIn: boolean
  identity: GitHubIdentity | null
  /** The GitHub CLI is installed — the sign-in that costs the user nothing. */
  ghCliAvailable: boolean
  /** This build carries an OAuth client id, so it can sign in by itself. */
  deviceFlowAvailable: boolean
}

/** What to show while the browser half of the device flow is happening. */
export interface GitHubDeviceCode {
  verificationUri: string
  userCode: string
  expiresInSec: number
}

export interface GitHubOwner {
  login: string
  kind: 'user' | 'org'
  avatarUrl: string | null
}

export interface GitHubRepoSummary {
  name: string
  fullName: string
  owner: string
  private: boolean
  cloneUrl: string
  htmlUrl: string
  description: string | null
  updatedAt: string | null
}

// --- Automatic sync ---------------------------------------------------------
/**
 * What runs on a schedule.
 *
 *  - `off`    — nothing. The default.
 *  - `follow` — scheduled fetch and fast-forward. Never a scheduled push.
 *  - `full`   — both directions.
 *
 * Only `full` ever pushes on its own initiative. An explicit Push in Source
 * Control works in every mode, `off` included — the mode governs what happens
 * unattended, not what the user is allowed to do.
 */
export type SyncMode = 'off' | 'follow' | 'full'

export type SyncState =
  | 'disabled'
  | 'idle'
  | 'syncing'
  | 'conflict'
  | 'offline'
  | 'auth-error'
  | 'error'

export interface SyncStatus {
  mode: SyncMode
  state: SyncState
  /** Epoch ms of the last completed cycle, or null if none yet. */
  lastSyncedAt: number | null
  /** Why it stopped. Set for `conflict`, `auth-error` and `error`. */
  message?: string
}
