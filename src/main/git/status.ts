import path from 'node:path'
import type { GitBranchInfo, GitFileEntry, GitFileState, GitStatusSnapshot } from '@shared/types'
import { runGit } from './spawn'
import { onFileChange } from '@main/vault/events'

const EMPTY_BRANCH: GitBranchInfo = {
  name: null,
  upstream: null,
  ahead: 0,
  behind: 0,
  detached: false
}
const NOT_A_REPO: GitStatusSnapshot = {
  branch: EMPTY_BRANCH,
  files: [],
  isRepo: false,
  gitAvailable: true
}
const NO_GIT: GitStatusSnapshot = { ...NOT_A_REPO, gitAvailable: false }

/**
 * Is git runnable here?
 *
 * A yes is remembered for the rest of the launch — git does not get
 * uninstalled while an app is open, and a spawn on every status read is not
 * free. A no is not remembered: the whole reason the app says "install it" is
 * that someone might go and do exactly that, and re-asking is what lets the
 * answer change without a restart. It costs one spawn per read, and only on a
 * machine where nothing git-related works anyway.
 */
let gitPresent = false

export async function isGitAvailable(): Promise<boolean> {
  if (gitPresent) return true
  const r = await runGit(['--version'], { cwd: process.cwd(), timeoutMs: 5_000 })
  gitPresent = r.code === 0
  return gitPresent
}

function mapStateChar(c: string): GitFileState {
  switch (c) {
    case 'M':
      return 'modified'
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'copied'
    case 'U':
      return 'unmerged'
    default:
      return 'unmodified'
  }
}

/**
 * `git status --porcelain=v2 --branch -z` — one call for branch name,
 * ahead/behind, and every file's status, all NUL-delimited (not
 * newline-delimited: filenames can contain literal newlines).
 *
 * Rename/copy records are the one subtlety `-z` changes: without `-z` the
 * two paths share one field joined by a tab, but with `-z` they become two
 * separate NUL-terminated records — the second has no type marker, it is
 * just the bare original path. That's why this parser consumes an extra
 * record for `2 ` (rename/copy) entries specifically.
 */
export function parsePorcelainV2(stdout: Buffer): { branch: GitBranchInfo; files: GitFileEntry[] } {
  const records = stdout
    .toString('utf8')
    .split('\0')
    .filter((r) => r.length > 0)

  const branch: GitBranchInfo = { ...EMPTY_BRANCH }
  const files: GitFileEntry[] = []

  for (let i = 0; i < records.length; i++) {
    const rec = records[i] ?? ''
    if (rec.startsWith('# branch.head ')) {
      const name = rec.slice('# branch.head '.length)
      if (name === '(detached)') {
        branch.detached = true
      } else {
        branch.name = name
      }
      continue
    }
    if (rec.startsWith('# branch.upstream ')) {
      branch.upstream = rec.slice('# branch.upstream '.length)
      continue
    }
    if (rec.startsWith('# branch.ab ')) {
      const m = /^# branch\.ab \+(\d+) -(\d+)/.exec(rec)
      if (m) {
        branch.ahead = Number(m[1])
        branch.behind = Number(m[2])
      }
      continue
    }
    if (rec.startsWith('# ')) continue // branch.oid and any future header lines

    if (rec.startsWith('1 ')) {
      // "1 XY sub mH mI mW hH hI <path>" — 7 metadata fields after the "1".
      const fields = rec.split(' ')
      const xy = fields[1] ?? '..'
      const filePath = fields.slice(8).join(' ')
      files.push({
        path: filePath,
        indexState: mapStateChar(xy[0] ?? '.'),
        worktreeState: mapStateChar(xy[1] ?? '.'),
        conflicted: false
      })
      continue
    }

    if (rec.startsWith('2 ')) {
      // "2 XY sub mH mI mW hH hI X<score> <path>" then, with -z, a *separate*
      // following record holding the bare original path.
      const fields = rec.split(' ')
      const xy = fields[1] ?? '..'
      const filePath = fields.slice(9).join(' ')
      const origPath = records[i + 1]
      i++ // consumed the origPath record
      files.push({
        path: filePath,
        origPath,
        indexState: mapStateChar(xy[0] ?? '.'),
        worktreeState: mapStateChar(xy[1] ?? '.'),
        conflicted: false
      })
      continue
    }

    if (rec.startsWith('u ')) {
      // "u XY sub m1 m2 m3 mW h1 h2 h3 <path>" — 9 metadata fields after "u".
      const fields = rec.split(' ')
      const xy = fields[1] ?? '..'
      const filePath = fields.slice(10).join(' ')
      files.push({
        path: filePath,
        indexState: mapStateChar(xy[0] ?? 'U'),
        worktreeState: mapStateChar(xy[1] ?? 'U'),
        conflicted: true
      })
      continue
    }

    if (rec.startsWith('? ')) {
      files.push({
        path: rec.slice(2),
        indexState: 'untracked',
        worktreeState: 'untracked',
        conflicted: false
      })
      continue
    }

    if (rec.startsWith('! ')) continue // ignored — not requested (no --ignored flag), but skip defensively
  }

  return { branch, files }
}

export async function isGitRepo(vaultRoot: string): Promise<boolean> {
  const result = await runGit(['rev-parse', '--is-inside-work-tree'], {
    cwd: vaultRoot,
    timeoutMs: 5_000
  })
  return result.code === 0 && result.stdout.toString('utf8').trim() === 'true'
}

export async function getGitStatus(vaultRoot: string): Promise<GitStatusSnapshot> {
  if (!(await isGitAvailable())) return NO_GIT
  if (!(await isGitRepo(vaultRoot))) return NOT_A_REPO
  const result = await runGit(['status', '--porcelain=v2', '--branch', '-z'], {
    cwd: vaultRoot,
    timeoutMs: 15_000
  })
  if (result.code !== 0) return NOT_A_REPO
  const { branch, files } = parsePorcelainV2(result.stdout)
  return { branch, files, isRepo: true, gitAvailable: true }
}

let listener: ((s: GitStatusSnapshot) => void) | null = null
export function setGitStatusListener(l: ((s: GitStatusSnapshot) => void) | null): void {
  listener = l
}

function snapshotsEqual(a: GitStatusSnapshot, b: GitStatusSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

const DEBOUNCE_MS = 700

interface FeatureHandle {
  stop(): void
  refreshNow(): void
}

let active: FeatureHandle | null = null

export function startGitStatusFeature(opts: { vaultRoot: string }): FeatureHandle {
  active?.stop()
  const root = opts.vaultRoot
  let last: GitStatusSnapshot | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let running = false
  let stopped = false

  async function runAndBroadcast(): Promise<void> {
    if (stopped || running) return
    running = true
    try {
      const snapshot = await getGitStatus(root)
      if (stopped) return
      if (!last || !snapshotsEqual(last, snapshot)) {
        last = snapshot
        listener?.(snapshot)
      }
    } finally {
      running = false
    }
  }

  function scheduleRefresh(): void {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      void runAndBroadcast()
    }, DEBOUNCE_MS)
  }

  const off = onFileChange(() => {
    scheduleRefresh()
  })

  void runAndBroadcast()

  const handle: FeatureHandle = {
    stop() {
      stopped = true
      off()
      if (debounceTimer) clearTimeout(debounceTimer)
      if (active === handle) active = null
    },
    refreshNow() {
      if (debounceTimer) {
        clearTimeout(debounceTimer)
        debounceTimer = null
      }
      void runAndBroadcast()
    }
  }
  active = handle
  return handle
}

export function stopGitStatusFeature(): void {
  active?.stop()
}

export function refreshGitStatusNow(): void {
  active?.refreshNow()
}

/** For the diff viewer — `null` when the path doesn't exist at HEAD (a new
 *  or untracked file), rather than throwing. */
export async function showFileAtHead(vaultRoot: string, relPath: string): Promise<string | null> {
  const posixPath = relPath.split(path.sep).join('/')
  const result = await runGit(['show', `HEAD:${posixPath}`], { cwd: vaultRoot, timeoutMs: 10_000 })
  if (result.code !== 0) return null
  return result.stdout.toString('utf8')
}
