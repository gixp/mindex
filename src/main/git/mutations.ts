import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { fileExists } from '@main/util/fs-helpers'
import { runGit, lastStderrLine, type GitRunResult } from './spawn'
import { resolveGitHubToken } from './github-token'

/**
 * A GitHub token for a network call, when there is one to be had.
 *
 * Returns undefined rather than throwing: a repository on some other host, or
 * a user with git credentials already configured, must keep working exactly as
 * it did before any of this existed.
 */
async function networkAuth(): Promise<string | undefined> {
  const resolved = await resolveGitHubToken().catch(() => null)
  return resolved?.token
}

const AUTH_FAILURE_PATTERNS = [
  /permission denied/i,
  /authentication failed/i,
  /could not read username/i,
  /could not read password/i,
  /terminal prompts disabled/i
]

function isAuthFailure(stderr: string): boolean {
  return AUTH_FAILURE_PATTERNS.some((re) => re.test(stderr))
}

function requireOk(result: GitRunResult, action: string): void {
  if (result.timedOut) throw new Error(`git ${action} timed out`)
  if (result.code !== 0) {
    const stderr = result.stderr.toString('utf8')
    if (isAuthFailure(stderr)) {
      throw new Error(
        'Authentication required — configure git credentials outside Mindex and try again'
      )
    }
    throw new Error(lastStderrLine(result) || `git ${action} failed`)
  }
}

export async function stageFiles(vaultRoot: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return
  const result = await runGit(['add', '--', ...paths], { cwd: vaultRoot })
  requireOk(result, 'add')
}

export async function unstageFiles(vaultRoot: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return
  const result = await runGit(['restore', '--staged', '--', ...paths], { cwd: vaultRoot })
  requireOk(result, 'restore --staged')
}

/** Tracked files go through `git checkout --` (restores from the index);
 *  untracked files aren't in git's index at all, so they're removed
 *  directly instead — NOT via `git clean`, which can't be safely scoped to
 *  an arbitrary caller-supplied path list. */
export async function discardFiles(
  vaultRoot: string,
  paths: string[],
  untracked: string[] = []
): Promise<void> {
  if (paths.length > 0) {
    const result = await runGit(['checkout', '--', ...paths], { cwd: vaultRoot })
    requireOk(result, 'checkout')
  }
  for (const rel of untracked) {
    const abs = path.join(vaultRoot, rel)
    if (await fileExists(abs)) await fsp.rm(abs, { force: true })
  }
}

export async function commit(vaultRoot: string, message: string): Promise<{ hash: string }> {
  const trimmed = message.trim()
  if (!trimmed) throw new Error('Commit message is empty')
  const result = await runGit(['commit', '-F', '-'], { cwd: vaultRoot, stdin: trimmed })
  requireOk(result, 'commit')
  const hashResult = await runGit(['rev-parse', 'HEAD'], { cwd: vaultRoot })
  return { hash: hashResult.stdout.toString('utf8').trim() }
}

export async function push(
  vaultRoot: string,
  opts?: { setUpstream?: boolean }
): Promise<{ output: string }> {
  const args = opts?.setUpstream ? ['push', '--set-upstream', 'origin', 'HEAD'] : ['push']
  const result = await runGit(args, {
    cwd: vaultRoot,
    timeoutMs: 60_000,
    allowNetwork: true,
    githubToken: await networkAuth()
  })
  requireOk(result, 'push')
  return { output: result.stdout.toString('utf8') || result.stderr.toString('utf8') }
}

export async function pull(vaultRoot: string): Promise<{ output: string; hadConflicts: boolean }> {
  const result = await runGit(['pull'], {
    cwd: vaultRoot,
    timeoutMs: 60_000,
    allowNetwork: true,
    githubToken: await networkAuth()
  })
  const combined = result.stdout.toString('utf8') + result.stderr.toString('utf8')
  const hadConflicts = /conflict/i.test(combined)
  if (result.code !== 0 && !hadConflicts) requireOk(result, 'pull')
  return { output: combined, hadConflicts }
}

/**
 * Deletes the vault's `.git` directory — "stop tracking with Git," not a
 * git operation itself. Resolves the real git-dir first and refuses unless
 * it sits directly at `<vaultRoot>/.git`: a worktree or submodule gitdir
 * pointer can resolve elsewhere, and blindly `rm -rf`ing that path could
 * remove a repository this vault doesn't own (e.g. an ancestor folder's).
 */
export async function removeGitRepo(vaultRoot: string): Promise<void> {
  const result = await runGit(['rev-parse', '--git-dir'], { cwd: vaultRoot, timeoutMs: 5_000 })
  if (result.code !== 0) throw new Error('Not a git repository')
  const gitDirRaw = result.stdout.toString('utf8').trim()
  const gitDir = path.resolve(vaultRoot, gitDirRaw)
  const expected = path.join(vaultRoot, '.git')
  if (gitDir !== expected) {
    throw new Error('This folder is part of a larger git repository — remove it there instead')
  }
  await fsp.rm(expected, { recursive: true, force: true })
}

/**
 * What a vault should not publish, appended to `.gitignore` before the first
 * commit.
 *
 * `.mindex/` holds chat transcripts, note history and comments — everything
 * about how the notes were written, as opposed to the notes. Pushing that to a
 * repository the user may later make public is the one step in publishing that
 * cannot be undone by deleting the repo, because the history stays in every
 * clone. Existing entries are left alone; only missing lines are added.
 */
const DEFAULT_IGNORES = ['.mindex/', '.DS_Store', 'node_modules/']

export async function ensureGitignore(vaultRoot: string): Promise<void> {
  const file = path.join(vaultRoot, '.gitignore')
  const existing = await fsp.readFile(file, 'utf8').catch(() => '')
  const lines = new Set(
    existing
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
  )
  const missing = DEFAULT_IGNORES.filter((entry) => !lines.has(entry))
  if (missing.length === 0) return
  const prefix = existing.length === 0 || existing.endsWith('\n') ? '' : '\n'
  await fsp.writeFile(file, `${existing}${prefix}${missing.join('\n')}\n`, 'utf8')
}

/**
 * Turn the vault into a repository with one commit in it.
 *
 * `-b main` rather than whatever `init.defaultBranch` happens to be: the
 * remote about to be created will be on `main`, and a local `master` would
 * push a second branch and leave the repository's default one empty.
 *
 * Safe to call on a folder that is already a repository — it stops before
 * committing rather than making a redundant commit.
 */
export async function initRepo(vaultRoot: string): Promise<{ created: boolean }> {
  const probe = await runGit(['rev-parse', '--git-dir'], { cwd: vaultRoot, timeoutMs: 5_000 })
  if (probe.code === 0) return { created: false }

  const init = await runGit(['init', '-b', 'main'], { cwd: vaultRoot })
  requireOk(init, 'init')
  await ensureGitignore(vaultRoot)
  const add = await runGit(['add', '-A'], { cwd: vaultRoot, timeoutMs: 60_000 })
  requireOk(add, 'add')
  const commitResult = await runGit(['commit', '-F', '-'], {
    cwd: vaultRoot,
    stdin: 'Initial commit',
    timeoutMs: 60_000
  })
  // An empty vault has nothing to commit. That is not a failure — the push
  // below will simply create an empty repository, which is a fine outcome.
  if (commitResult.code !== 0 && !/nothing to commit/i.test(commitResult.stdout.toString('utf8'))) {
    requireOk(commitResult, 'commit')
  }
  return { created: true }
}

/** Point `origin` at `url`, adding it or moving it as needed. */
export async function setOrigin(vaultRoot: string, url: string): Promise<void> {
  const existing = await runGit(['remote', 'get-url', 'origin'], {
    cwd: vaultRoot,
    timeoutMs: 5_000
  })
  const args =
    existing.code === 0 ? ['remote', 'set-url', 'origin', url] : ['remote', 'add', 'origin', url]
  const result = await runGit(args, { cwd: vaultRoot })
  requireOk(result, 'remote')
}

export async function cloneRepo(url: string, destDir: string): Promise<{ root: string }> {
  if (!path.isAbsolute(destDir)) throw new Error(`Destination must be absolute: ${destDir}`)
  if (await fileExists(destDir)) {
    const entries = await fsp.readdir(destDir).catch(() => [] as string[])
    if (entries.length > 0) throw new Error(`Folder already exists and is not empty: ${destDir}`)
  }
  const result = await runGit(['clone', url, destDir], {
    cwd: path.dirname(destDir),
    timeoutMs: 120_000,
    allowNetwork: true,
    githubToken: await networkAuth()
  })
  if (result.timedOut) throw new Error('git clone timed out')
  if (result.code !== 0) {
    const stderr = result.stderr.toString('utf8')
    if (isAuthFailure(stderr)) {
      throw new Error(
        'Authentication required — configure git credentials outside Mindex and try again'
      )
    }
    throw new Error(lastStderrLine(result) || 'git clone failed')
  }
  return { root: destDir }
}
