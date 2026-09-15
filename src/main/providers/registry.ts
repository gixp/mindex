import { spawn as spawnProcess } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { providerSearchPaths } from './paths'
import { PROVIDER_IDS, type InteractiveRequest, type ProviderId, type ProviderSpec } from './types'

const home = os.homedir()

async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

const claude: ProviderSpec = {
  id: 'claude',
  label: 'Claude Code',
  bin: 'claude',
  installHint: 'npm install -g @anthropic-ai/claude-code',
  npmPackage: '@anthropic-ai/claude-code',
  loginHint: 'claude login',
  /*
   * Aliases, and labels with no version number in them.
   *
   * The alias is the one worth storing: the CLI resolves it against the build
   * the user has, so a new Opus needs no Mindex release to become reachable.
   * The real, current list — with the vendor's own names and descriptions —
   * comes from ACP's `session/new` (see main/acp/catalogue.ts); this is only
   * the floor shown before that has ever answered.
   */
  models: [
    { value: 'opus', label: 'Opus', tier: 'flagship' },
    { value: 'fable', label: 'Fable', tier: 'flagship' },
    { value: 'sonnet', label: 'Sonnet', tier: 'balanced' },
    { value: 'haiku', label: 'Haiku', tier: 'light' }
  ],
  defaultModel: 'opus',
  extraPaths: () => providerSearchPaths('claude'),

  /*
   * Zed Industries' adapter, Apache-2.0, run through npx rather than bundled.
   *
   * Verified against a real connection: with `claude login` already done it
   * reports `authMethods: []` and opens a session with no sign-in step — the
   * adapter delegates credentials to the Claude Agent SDK, which reads the same
   * store the CLI does. So this changes the transport and nothing about who
   * pays or how the user signs in.
   */
  acp: { package: '@agentclientprotocol/claude-agent-acp', args: [] },

  interactiveArgs(req) {
    const args: string[] = []
    if (req.model) args.push('--model', req.model)
    if (req.sessionId) args.push(req.resume ? '--resume' : '--session-id', req.sessionId)
    // Here, unlike a scripted run, there is no allow-list to pair it with —
    // the user is at the keyboard and approves the first call the ordinary
    // way. That prompt is the point: these tools are here because Mindex
    // added them, and it should say so before one runs.
    if (req.mcpConfig) args.push('--mcp-config', req.mcpConfig)
    return args
  },

  async isAuthenticated() {
    if (process.env.ANTHROPIC_API_KEY) return true
    for (const p of [
      path.join(home, '.claude', '.credentials.json'),
      path.join(home, '.config', 'claude', 'credentials.json')
    ]) {
      if (await exists(p)) return true
    }
    // Claude Code keeps its OAuth token in the login keychain, not a file.
    return await keychainHas('Claude Code-credentials')
  }
}

const gemini: ProviderSpec = {
  id: 'gemini',
  label: 'Gemini CLI',
  bin: 'gemini',
  installHint: 'npm install -g @google/gemini-cli',
  npmPackage: '@google/gemini-cli',
  loginHint: 'gemini  (then complete the browser sign-in)',
  /*
   * Aliases, for a stronger reason than Claude's.
   *
   * Gemini resolves these against the account as well as the build — the
   * resolver reads `hasAccessToPreview` — so a pinned `gemini-3-pro-preview`
   * simply fails for a user without preview access, while `pro` gets them the
   * best model they can actually reach. The real, current list comes from ACP
   * (Gemini reports it as a separate `models` field, not `configOptions` —
   * see main/acp/surface.ts); this is only the floor shown before that has
   * ever answered.
   */
  models: [
    { value: 'pro', label: 'Gemini Pro', tier: 'flagship' },
    { value: 'flash', label: 'Gemini Flash', tier: 'balanced' },
    { value: 'flash-lite', label: 'Gemini Flash Lite', tier: 'light' }
  ],
  defaultModel: 'pro',
  extraPaths: () => providerSearchPaths('gemini'),

  /*
   * The only one needing no adapter at all: ACP is built into the CLI, so this
   * is the cheapest launch of the three (~1 s, no download, works offline).
   */
  acp: { package: null, args: ['--acp'] },

  interactiveArgs(req) {
    // `--skip-trust` is not optional. Since 0.55 Gemini refuses to run in a
    // directory it has not been told to trust, and headlessly that failure is
    // silent: empty stdout, the reason only on stderr. The vault is a folder
    // the user opened deliberately, which is exactly the workspace they meant
    // to trust — Claude and Codex simply take the cwd on the same footing.
    const args = ['--skip-trust']
    if (req.model) args.push('-m', req.model)
    if (req.sessionId) args.push(req.resume ? '--resume' : '--session-id', req.sessionId)
    return args
  },

  async isAuthenticated() {
    // Gemini has three sign-in modes and they store credentials in three
    // different places, so "is there a token file" is not a question with one
    // answer. Ask the same thing the CLI asks itself — `security.auth
    // .selectedType` in its settings — and then check that mode's store.
    //
    // Getting this wrong is not cosmetic: an API-key sign-in leaves
    // `google_accounts.json.active` null forever, so a check written only
    // against OAuth reports "not signed in" about a perfectly working install.
    const selected = await geminiAuthType()

    if (selected === 'gemini-api-key' || selected === null) {
      if (process.env.GEMINI_API_KEY) return true
      if (await keychainHas('gemini-cli-api-key')) return true
    }
    if (selected === 'vertex-ai' || selected === null) {
      if (process.env.GOOGLE_API_KEY || process.env.GOOGLE_CLOUD_PROJECT) return true
    }
    if (selected === 'oauth-personal' || selected === null) {
      // `active` holds the signed-in address and moves to `old` on sign-out,
      // so the file existing proves nothing — only a non-null `active` does.
      try {
        const raw = await readFile(path.join(home, '.gemini', 'google_accounts.json'), 'utf8')
        const parsed = JSON.parse(raw) as { active?: unknown }
        if (typeof parsed.active === 'string' && parsed.active.length > 0) return true
      } catch {
        /* no accounts file — fall through */
      }
    }
    return false
  }
}

const codex: ProviderSpec = {
  id: 'codex',
  label: 'Codex CLI',
  bin: 'codex',
  installHint: 'npm install -g @openai/codex',
  npmPackage: '@openai/codex',
  loginHint: 'codex login',
  /*
   * Concrete slugs, because Codex has no aliases. The real, current list —
   * with the vendor's own names, descriptions and effort-crossed variants —
   * comes from ACP; this is only the floor shown before that has ever
   * answered.
   */
  models: [
    { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', tier: 'flagship' },
    { value: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', tier: 'balanced' },
    { value: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', tier: 'light' },
    { value: 'gpt-5.5', label: 'GPT-5.5', tier: 'flagship' },
    { value: 'gpt-5.4', label: 'GPT-5.4', tier: 'balanced' },
    { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', tier: 'light' }
  ],
  defaultModel: 'gpt-5.6-sol',
  extraPaths: () => providerSearchPaths('codex'),

  /*
   * Bundles `@openai/codex` as its own dependency, which makes it the most
   * expensive first launch of the three (~7.5 s cold, under a second after).
   * `CODEX_PATH` would point it at a different binary; deliberately not set, so
   * it uses the version it was tested against.
   */
  acp: { package: '@agentclientprotocol/codex-acp', args: [] },

  interactiveArgs(req) {
    const args: string[] = req.sessionId && req.resume ? ['resume', req.sessionId] : []
    if (req.model) args.push('-m', req.model)
    if (req.mcpConfig) args.push('-c', req.mcpConfig)
    return args
  },

  async isAuthenticated() {
    if (process.env.OPENAI_API_KEY) return true
    return await exists(path.join(home, '.codex', 'auth.json'))
  }
}

/** Which sign-in mode Gemini is configured for, or null if it never said. */
async function geminiAuthType(): Promise<string | null> {
  try {
    const raw = await readFile(path.join(home, '.gemini', 'settings.json'), 'utf8')
    const parsed = JSON.parse(raw) as { security?: { auth?: { selectedType?: unknown } } }
    const t = parsed.security?.auth?.selectedType
    return typeof t === 'string' ? t : null
  } catch {
    return null
  }
}

/**
 * Does a keychain item exist? Existence only — never its value.
 *
 * `find-generic-password` without `-w` reports whether the item is there
 * without reading it, so macOS raises no unlock prompt. Asking for the secret
 * would put a password dialog in front of a background status check.
 */
function keychainHas(service: string): Promise<boolean> {
  if (process.platform !== 'darwin') return Promise.resolve(false)
  return new Promise((resolve) => {
    const child = spawnProcess('/usr/bin/security', ['find-generic-password', '-s', service], {
      stdio: 'ignore'
    })
    child.on('error', () => resolve(false))
    child.on('exit', (code) => resolve(code === 0))
  })
}

const SPECS: Record<ProviderId, ProviderSpec> = { claude, gemini, codex }

export function providerSpec(id: ProviderId): ProviderSpec {
  return SPECS[id]
}

export function allProviderSpecs(): ProviderSpec[] {
  return PROVIDER_IDS.map((id) => SPECS[id])
}

/** A provider's default model — for seeding, and for repairing a stale setting. */
export function defaultModelFor(id: ProviderId): string {
  return SPECS[id].defaultModel
}

/** Narrow an untrusted string (settings file, IPC payload) to a known provider. */
export function toProviderId(v: unknown): ProviderId | null {
  return typeof v === 'string' && (PROVIDER_IDS as string[]).includes(v) ? (v as ProviderId) : null
}

export type { InteractiveRequest }
