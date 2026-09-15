import { spawn } from 'node:child_process'
import type { ProviderId, ProviderStatus } from './types'
import { PROVIDER_IDS } from './types'
import { allProviderSpecs, providerSpec } from './registry'
import { ensureProviderPath } from './paths'

const VERSION_TIMEOUT_MS = 8_000

/**
 * Is the binary there, and what version?
 *
 * `--version` is the only subcommand safe to run blind: it never opens a
 * browser, never waits on stdin, and never touches the user's files. Anything
 * further — asking the CLI whether it is signed in, say — risks the failure
 * mode Gemini has, where an unauthenticated invocation prints a yes/no question
 * and then blocks forever.
 */
function probeVersion(id: ProviderId): Promise<{ installed: boolean; version?: string }> {
  const spec = providerSpec(id)
  return new Promise((resolve) => {
    let out = ''
    let settled = false
    const done = (r: { installed: boolean; version?: string }): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(r)
    }

    const child = spawn(spec.bin, ['--version'], {
      env: ensureProviderPath(process.env, id),
      stdio: ['ignore', 'pipe', 'pipe']
    })

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      done({ installed: false })
    }, VERSION_TIMEOUT_MS)

    child.stdout?.on('data', (d: Buffer) => {
      out += d.toString()
    })
    child.on('error', () => done({ installed: false }))
    child.on('exit', (code) => {
      if (code !== 0) return done({ installed: false })
      // Every one of the three prints its version differently — a bare number,
      // "2.1.226 (Claude Code)", "codex-cli 0.145.0". Take the first
      // dotted-numeric run and ignore the branding around it.
      const m = /\d+\.\d+\.\d+[^\s]*/.exec(out)
      done({ installed: true, version: m?.[0] ?? out.trim().split('\n')[0] })
    })
  })
}

export async function detectProvider(id: ProviderId): Promise<ProviderStatus> {
  const { installed, version } = await probeVersion(id)
  if (!installed) return { id, installed: false, authenticated: false }
  const authenticated = await providerSpec(id)
    .isAuthenticated()
    .catch(() => false)
  return { id, installed: true, version, authenticated }
}

/** All three at once — the shape the Settings screen and onboarding both want. */
export async function detectAllProviders(): Promise<ProviderStatus[]> {
  return await Promise.all(allProviderSpecs().map((s) => detectProvider(s.id)))
}

/**
 * The first provider that is actually usable, preferring `preferred`.
 *
 * Used to pick a sane default when nothing has been configured yet, and to fall
 * back when the configured provider has since been uninstalled or signed out —
 * a stale setting should not leave the app with no engine at all.
 */
export async function firstUsableProvider(preferred?: ProviderId): Promise<ProviderId | null> {
  const statuses = await detectAllProviders()
  const usable = new Set(statuses.filter((s) => s.installed && s.authenticated).map((s) => s.id))
  if (preferred && usable.has(preferred)) return preferred
  return PROVIDER_IDS.find((id) => usable.has(id)) ?? null
}
