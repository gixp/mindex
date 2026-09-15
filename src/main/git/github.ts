import type {
  GitHubAuthState,
  GitHubDeviceCode,
  GitHubIdentity,
  GitHubOwner,
  GitHubRepoSummary
} from '@shared/types'
import { clearStoredToken, findGhBinary, resolveGitHubToken, storeToken } from './github-token'
import { githubClientId } from '@main/config'

/**
 * Talking to GitHub's REST API, and signing in to it.
 *
 * Plain `fetch` rather than Octokit: seven endpoints do not justify a
 * dependency, and every one of them is a single documented GET or POST.
 *
 * Sign-in is the OAuth **device flow** — the browser-based flow would need a
 * client secret, which a desktop app cannot keep, and a redirect URI, which it
 * does not have. The device flow needs neither: the app shows a code, the user
 * types it into github.com, and the app polls until it is approved. The client
 * id is public by design.
 */

const API = 'https://api.github.com'
const CLIENT_ID = githubClientId()
/** Create repositories, push to them, and read the account's own name. */
const SCOPES = 'repo read:org'

export function isDeviceFlowConfigured(): boolean {
  return CLIENT_ID.length > 0
}

// --- requests ---------------------------------------------------------------

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH'
  body?: unknown
  /** 404 is an answer, not a failure, for "does this repo exist". */
  allow404?: boolean
  timeoutMs?: number
}

class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

async function api<T>(path: string, token: string, opts: ApiOptions = {}): Promise<T | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15_000)
  try {
    const res = await fetch(`${API}${path}`, {
      method: opts.method ?? 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {})
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal
    })
    if (res.status === 404 && opts.allow404) return null
    if (!res.ok) {
      const detail = await res
        .json()
        .then((b: unknown) =>
          b && typeof b === 'object' && 'message' in b
            ? String((b as { message: unknown }).message)
            : ''
        )
        .catch(() => '')
      throw new GitHubError(detail || `GitHub returned HTTP ${res.status}`, res.status)
    }
    return (await res.json()) as T
  } catch (err) {
    if (err instanceof GitHubError) throw err
    if (err instanceof Error && err.name === 'AbortError') {
      throw new GitHubError('GitHub did not respond in time', 0)
    }
    throw new GitHubError(err instanceof Error ? err.message : 'GitHub request failed', 0)
  } finally {
    clearTimeout(timer)
  }
}

/** The token, or a refusal the UI can show verbatim. */
async function requireToken(): Promise<string> {
  const resolved = await resolveGitHubToken()
  if (!resolved) throw new Error('Not signed in to GitHub')
  return resolved.token
}

// --- state ------------------------------------------------------------------

let cachedIdentity: GitHubIdentity | null = null

interface UserResponse {
  login: string
  name?: string | null
  avatar_url?: string | null
}

export async function githubAuthState(): Promise<GitHubAuthState> {
  const resolved = await resolveGitHubToken()
  const ghAvailable = (await findGhBinary()) !== null
  if (!resolved) {
    cachedIdentity = null
    return {
      signedIn: false,
      identity: null,
      ghCliAvailable: ghAvailable,
      deviceFlowAvailable: isDeviceFlowConfigured()
    }
  }
  try {
    const user = await api<UserResponse>('/user', resolved.token)
    cachedIdentity = user
      ? {
          login: user.login,
          name: user.name ?? null,
          avatarUrl: user.avatar_url ?? null,
          source: resolved.source
        }
      : null
  } catch {
    // A token that no longer works is the same situation as no token, as far
    // as anything the user can do about it goes.
    cachedIdentity = null
  }
  return {
    signedIn: cachedIdentity !== null,
    identity: cachedIdentity,
    ghCliAvailable: ghAvailable,
    deviceFlowAvailable: isDeviceFlowConfigured()
  }
}

type AuthBroadcastFn = (state: GitHubAuthState) => void
let broadcastAuthState: AuthBroadcastFn | null = null

/** Wired in once from `ipc/broadcast.ts`, with the real `BrowserWindow`. */
export function setGithubAuthBroadcast(fn: AuthBroadcastFn | null): void {
  broadcastAuthState = fn
}

function broadcastAuth(state: GitHubAuthState): void {
  broadcastAuthState?.(state)
}

async function announceAuth(): Promise<GitHubAuthState> {
  const state = await githubAuthState()
  broadcastAuth(state)
  return state
}

// --- device flow ------------------------------------------------------------

interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

interface TokenResponse {
  access_token?: string
  error?: string
  interval?: number
}

let polling = false

type OpenExternalFn = (url: string) => void
let openExternal: OpenExternalFn | null = null

/** Wired in once from `ipc/broadcast.ts`, with Electron's real `shell`. */
export function setOpenExternal(fn: OpenExternalFn | null): void {
  openExternal = fn
}

/**
 * Ask GitHub for a device code, open the verification page, and start polling
 * in the background.
 *
 * Returns as soon as there is a code to show. Completion arrives as a
 * `githubAuth` broadcast rather than a resolved promise, because approving in
 * the browser can take minutes and nothing should be awaiting that.
 */
export async function startDeviceLogin(): Promise<GitHubDeviceCode> {
  if (!isDeviceFlowConfigured()) {
    throw new Error('GitHub sign-in is not configured in this build')
  }
  if (polling) throw new Error('A GitHub sign-in is already in progress')

  const res = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID, scope: SCOPES })
  })
  if (!res.ok) throw new Error(`GitHub refused the sign-in request (HTTP ${res.status})`)
  const data = (await res.json()) as DeviceCodeResponse

  polling = true
  void poll(data).finally(() => {
    polling = false
  })

  openExternal?.(data.verification_uri)
  return {
    verificationUri: data.verification_uri,
    userCode: data.user_code,
    expiresInSec: data.expires_in
  }
}

async function poll(data: DeviceCodeResponse): Promise<void> {
  const deadline = Date.now() + data.expires_in * 1000
  // GitHub's own interval, honoured — polling faster earns `slow_down` and
  // then a longer wait than just following instructions would have cost.
  let waitMs = Math.max(data.interval, 5) * 1000

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, waitMs))
    let body: TokenResponse
    try {
      const res = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: CLIENT_ID,
          device_code: data.device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        })
      })
      body = (await res.json()) as TokenResponse
    } catch {
      // A dropped connection mid-flow is not a refusal — keep waiting until
      // the code itself expires.
      continue
    }

    if (body.access_token) {
      await storeToken(body.access_token)
      await announceAuth()
      return
    }
    if (body.error === 'authorization_pending') continue
    if (body.error === 'slow_down') {
      waitMs += 5_000
      continue
    }
    // access_denied, expired_token, or anything else: the user is not going
    // to approve this code, so stop rather than poll a dead request.
    return
  }
}

export async function githubSignOut(): Promise<GitHubAuthState> {
  await clearStoredToken()
  cachedIdentity = null
  // Deliberately does NOT touch `gh`. Signing out of Mindex must not sign the
  // user out of a tool they use elsewhere — but it does mean that with `gh`
  // signed in, this leaves them still signed in, which the UI has to say.
  return announceAuth()
}

// --- repositories -----------------------------------------------------------

interface OrgResponse {
  login: string
  avatar_url?: string | null
}

/** The account itself, then every org it can create repositories in. */
export async function listOwners(): Promise<GitHubOwner[]> {
  const token = await requireToken()
  const user = await api<UserResponse>('/user', token)
  const orgs = (await api<OrgResponse[]>('/user/orgs?per_page=100', token)) ?? []
  const owners: GitHubOwner[] = []
  if (user) {
    owners.push({ login: user.login, kind: 'user', avatarUrl: user.avatar_url ?? null })
  }
  for (const org of orgs) {
    owners.push({ login: org.login, kind: 'org', avatarUrl: org.avatar_url ?? null })
  }
  return owners
}

/**
 * Whether `owner/name` is free.
 *
 * A 404 means nothing is there. Anything else — including a private repo the
 * token cannot see, which answers 404 as well — is reported as taken, because
 * creating over it would fail anyway.
 */
export async function checkRepoName(owner: string, name: string): Promise<boolean> {
  const token = await requireToken()
  const existing = await api<unknown>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
    token,
    { allow404: true }
  )
  return existing === null
}

interface RepoResponse {
  name: string
  full_name: string
  private: boolean
  clone_url: string
  html_url: string
  description?: string | null
  updated_at?: string
  owner?: { login: string }
}

function toSummary(r: RepoResponse): GitHubRepoSummary {
  return {
    name: r.name,
    fullName: r.full_name,
    owner: r.owner?.login ?? r.full_name.split('/')[0] ?? '',
    private: r.private,
    cloneUrl: r.clone_url,
    htmlUrl: r.html_url,
    description: r.description ?? null,
    updatedAt: r.updated_at ?? null
  }
}

export async function createRepo(input: {
  owner: string
  name: string
  private: boolean
  description?: string
}): Promise<GitHubRepoSummary> {
  const token = await requireToken()
  const owners = await listOwners()
  const isOrg = owners.find((o) => o.login === input.owner)?.kind === 'org'
  const path = isOrg ? `/orgs/${encodeURIComponent(input.owner)}/repos` : '/user/repos'
  const created = await api<RepoResponse>(path, token, {
    method: 'POST',
    body: {
      name: input.name,
      private: input.private,
      description: input.description || undefined,
      // No README, no .gitignore, no licence: the first push carries the
      // vault's own history, and an initial commit made by GitHub would make
      // that push a rejected non-fast-forward.
      auto_init: false
    },
    timeoutMs: 30_000
  })
  if (!created) throw new Error('GitHub did not return the new repository')
  return toSummary(created)
}

/**
 * The account's repositories, newest activity first.
 *
 * `query` filters the fetched page rather than calling the search API: search
 * is separately rate-limited (30/min), lags behind by up to a minute for fresh
 * repositories, and a hundred of your own repos is a list you can filter
 * locally in a keystroke.
 */
export async function listRepos(query = ''): Promise<GitHubRepoSummary[]> {
  const token = await requireToken()
  const repos =
    (await api<RepoResponse[]>(
      '/user/repos?sort=updated&per_page=100&affiliation=owner,collaborator,organization_member',
      token,
      {
        timeoutMs: 30_000
      }
    )) ?? []
  const q = query.trim().toLowerCase()
  const all = repos.map(toSummary)
  if (!q) return all
  return all.filter((r) => r.fullName.toLowerCase().includes(q))
}
