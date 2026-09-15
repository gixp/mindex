import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, readFile, rm, writeFile } from 'node:fs/promises'
import { appConfigDir, appConfigFile } from '@main/util/paths'
import { ensureDir } from '@main/util/fs-helpers'
import { commonPaths } from '@main/providers/paths'
import { secretStore } from '@main/util/secret-store'

/**
 * Where a GitHub token comes from, and where ours is kept.
 *
 * Two sources, checked in this order:
 *
 *  1. **A token Mindex obtained itself** (the OAuth device flow), stored here.
 *  2. **The GitHub CLI.** `gh auth token` prints the token of whoever is
 *     signed in to `gh`. Nothing is stored for this one — it is re-read every
 *     time, so signing out of `gh` signs out of Mindex too, with no stale copy
 *     left behind.
 *
 * Ours wins because it is the one the user chose from inside the app; `gh` is
 * the free ride for people who already have it.
 */

const STORE_FILE = appConfigFile('github-token.enc')

/**
 * Same macOS reasoning as `auth/index.ts`: `safeStorage` on macOS is the
 * Keychain, the Keychain keys on the code signature, and our ad-hoc signature
 * changes with every build — so an encrypted store would prompt for the
 * system password after every update. Until macOS builds carry a stable
 * Developer ID, this is a 0600 file instead.
 *
 * The trade is worse here than it is for the identity token: a GitHub token
 * with `repo` scope can read and write the user's repositories. It is still
 * the better of the two options — a password prompt that looks exactly like
 * malware teaches people to click through prompts — but it is the reason
 * signing in with `gh` is offered first, where the token is never ours to
 * keep at all.
 */
const MAC_KEYCHAIN = false

function encryptionEnabled(): boolean {
  if (process.platform === 'darwin' && !MAC_KEYCHAIN) return false
  return secretStore().isAvailable()
}

let memToken: string | null | undefined

export async function readStoredToken(): Promise<string | null> {
  if (memToken !== undefined) return memToken
  try {
    const raw = await readFile(STORE_FILE)
    memToken = decode(raw)
  } catch {
    memToken = null
  }
  return memToken
}

function decode(raw: Buffer): string | null {
  const text = raw.toString('utf8')
  // A plaintext store starts with the token itself; an encrypted one is
  // binary. Try the cheap read first, the same order `auth/index.ts` uses.
  if (/^gh[pousr]_[A-Za-z0-9]+$/.test(text.trim())) return text.trim()
  try {
    if (!secretStore().isAvailable()) return null
    const decrypted = secretStore().decrypt(raw).trim()
    return decrypted || null
  } catch {
    return null
  }
}

export async function storeToken(token: string): Promise<void> {
  memToken = token
  await ensureDir(appConfigDir())
  if (encryptionEnabled()) {
    await writeFile(STORE_FILE, secretStore().encrypt(token))
  } else {
    await writeFile(STORE_FILE, token, { mode: 0o600 })
  }
  // Set explicitly rather than relying on the create mode: an existing file
  // keeps its old permissions through a rewrite.
  await chmod(STORE_FILE, 0o600).catch(() => {})
}

export async function clearStoredToken(): Promise<void> {
  memToken = null
  await rm(STORE_FILE, { force: true }).catch(() => {})
}

// --- the GitHub CLI ---------------------------------------------------------

/**
 * Where `gh` lives when it isn't on PATH.
 *
 * A GUI launch on macOS inherits `launchd`'s PATH (`/usr/bin:/bin:/usr/sbin:
 * /sbin`), not the user's shell PATH — so a Homebrew `gh` is invisible to the
 * packaged app even though it works fine in their terminal. Same problem
 * `providers/paths.ts` already solves for the agent CLIs, and the same list.
 */
function ghCandidates(): string[] {
  return ['gh', ...commonPaths().map((dir) => `${dir}/gh`)]
}

function run(bin: string, args: string[], timeoutMs = 5_000): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: timeoutMs, encoding: 'utf8' }, (err, stdout) => {
      resolve(err ? null : stdout.trim() || null)
    })
  })
}

/** The `gh` binary that answers, or null. */
export async function findGhBinary(): Promise<string | null> {
  for (const candidate of ghCandidates()) {
    if (candidate !== 'gh' && !existsSync(candidate)) continue
    const out = await run(candidate, ['--version'], 3_000)
    if (out) return candidate
  }
  return null
}

/** The token `gh` is signed in with, or null if it isn't (or isn't installed). */
export async function ghToken(): Promise<string | null> {
  const bin = await findGhBinary()
  if (!bin) return null
  const out = await run(bin, ['auth', 'token'])
  return out && out.startsWith('gh') ? out : null
}

/**
 * The token to use, from whichever source has one.
 *
 * Returns null rather than throwing: every caller has a "not signed in"
 * branch to show, and a thrown error there would turn a normal state into a
 * failure dialog.
 */
export async function resolveGitHubToken(): Promise<{
  token: string
  source: 'mindex' | 'gh-cli'
} | null> {
  const stored = await readStoredToken()
  if (stored) return { token: stored, source: 'mindex' }
  const fromGh = await ghToken()
  if (fromGh) return { token: fromGh, source: 'gh-cli' }
  return null
}
