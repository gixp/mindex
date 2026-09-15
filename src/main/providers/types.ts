/**
 * The agent CLIs Mindex can drive.
 *
 * All three are the same shape of thing: a locally installed binary that
 * speaks ACP. Mindex never talks to a model API directly — it drives whichever
 * CLI the user has already installed and signed in to, which is why there are
 * no API keys anywhere in this codebase.
 */
export type ProviderId = 'claude' | 'gemini' | 'codex'

/** Display and preference order. Kept in step with src/renderer/src/lib/providers.ts. */
export const PROVIDER_IDS: ProviderId[] = ['claude', 'codex', 'gemini']

/** What we could learn about a provider without running anything interactive. */
export interface ProviderStatus {
  id: ProviderId
  installed: boolean
  version?: string
  authenticated: boolean
}

/**
 * Roughly what a model costs to run, in the vendor's own terms.
 *
 * Used to steer the context-engine choice. That job re-reads and re-summarises
 * the vault on a schedule, so it burns far more tokens than chatting does —
 * pointing it at the flagship tier is the most expensive mistake a new user can
 * make without noticing. Every vendor ships the same three rungs under
 * different names, so this is the one axis worth normalising.
 */
export type ModelTier = 'flagship' | 'balanced' | 'light'

export interface ModelOption {
  value: string
  label: string
  tier?: ModelTier
}

/** Mindex's permission vocabulary — used only by the terminal tab's own login/model flags now. */
export type AgentPermissionMode = 'default' | 'acceptEdits' | 'plan' | 'auto'

/**
 * How to start this provider's ACP agent.
 *
 * Two shapes exist in practice. Gemini speaks ACP itself — `gemini --acp`,
 * nothing to install. Claude and Codex need a separate adapter package, run
 * through `npx` on demand and never bundled into the Mindex installer (see
 * ../acp/launch.ts for why).
 */
export interface AcpLaunchSpec {
  /** The npm package to run, or `null` when `bin` already speaks ACP. */
  package: string | null
  /** Arguments after the command. `['--acp']` for a CLI that speaks it natively. */
  args: string[]
}

export interface InteractiveRequest {
  sessionId?: string
  /** True when a transcript for this session already exists on disk. */
  resume?: boolean
  model?: string
  /** A JSON `mcpServers` document, for the one CLI that takes it per invocation. */
  mcpConfig?: string
}

export interface ProviderSpec {
  id: ProviderId
  /** Shown in the UI. */
  label: string
  /** The executable, resolved through PATH. */
  bin: string
  /** Told to the user when the binary is missing. */
  installHint: string
  /** The `npm install -g` target behind installHint — what the download button actually runs. */
  npmPackage: string
  /** Told to the user when the binary is there but nobody is signed in. */
  loginHint: string

  models: ModelOption[]
  /** Used when nothing has been chosen yet. Always a real model, never blank. */
  defaultModel: string

  /** Extra directories to put on PATH before looking for `bin`. */
  extraPaths(): string[]

  /** How to start this provider's ACP agent. */
  acp: AcpLaunchSpec

  /**
   * Argv for the real terminal tab — the one place a user types into this CLI
   * directly, unrelated to ACP or to any of Mindex's own conversation
   * plumbing. Kept per-provider because each CLI still spells "resume this
   * session" and "which model" its own way on the command line.
   */
  interactiveArgs(req: InteractiveRequest): string[]

  /**
   * Whether credentials exist, decided by reading disk and env only.
   *
   * Deliberately never by running the CLI: an unauthenticated `gemini -p …`
   * does not fail, it prints "Opening authentication page in your browser.
   * Do you want to continue? [Y/n]" and waits forever on stdin. A detection
   * routine that shells out would hang exactly when the answer matters most.
   */
  isAuthenticated(): Promise<boolean>
}
