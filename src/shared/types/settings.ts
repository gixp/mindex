/** Everything stored for the app as a whole rather than for one workspace. */

import type { ProviderId } from './engine'
import type { RecentVault } from './vault'

export interface AppSettings {
  recentVaults: RecentVault[]
  // Workspaces pinned to the workspace switcher — added automatically when
  // opened, removed only by an explicit close (unlike `recentVaults`, which
  // is an auto-pruned MRU list of everything ever opened).
  openWorkspaces: RecentVault[]
  lastVault?: string
  panelSizes: { left: number; center: number; right: number }
  leftPanelHidden: boolean
  rightPanelHidden: boolean
  /** The floating terminal drawer. */
  bottomPanelOpen?: boolean
  frontmatterCollapsed?: boolean
  editorFontSize?: number
  cliFontSize?: number
  chatFontSize?: number
  zoomFactor?: number
  /**
   * Two, not three. A `'live'` value was declared here and never built: no
   * screen ever set it and every reader folded it into preview, so it was a
   * promise in a type with nothing behind it. Removed from the type; readers
   * still fold anything unrecognised into preview, because an old install may
   * have the word sitting in its settings file.
   */
  editorViewMode?: 'edit' | 'preview'
  /** Absent means 'dark' — every existing install looked like that before
   *  this setting existed, and this keeps it that way rather than switching
   *  anyone over on upgrade. 'system' follows the OS's own light/dark
   *  preference; see `lib/theme.ts` in the renderer. */
  theme?: 'dark' | 'light' | 'system'
  notificationsEnabled?: boolean
  // Stable anonymous install identity. Used by the install record and by bug
  // reports so a report can be tied back to a launch — never to note content.
  // The install record is mandatory, so there is no opt-out flag here.
  analytics?: {
    installId?: string
    firstSeenAt?: number
    /** Product analytics consent. Absent means on; only an explicit `false`
     *  disables it. Crash reports are governed separately — they carry no
     *  usage data and are scrubbed of paths. */
    enabled?: boolean
  }
  // Cached non-secret profile of the signed-in user (for instant offline display).
  // Auth tokens are NEVER stored here — they live encrypted in safeStorage.
  // Last known beta-access answer, cached so an offline launch keeps whatever
  // was true last time instead of guessing. Never used to grant access the
  // server denied — only to avoid re-blocking someone already let in.
  // Timestamp (ms) when the first-run onboarding flow was completed.
  onboardedAt?: number
  /**
   * What the setup window was last told, so the next vault opens on the same
   * answers instead of asking the same questions from scratch.
   *
   * App-wide rather than per vault, which is the point: a preference about how
   * you like a vault set up belongs to you, not to one folder. Absent means
   * the defaults below — a root context file is written, and whether the
   * background job runs is left to `engine.autoContextEnabled`.
   */
  vaultSetup?: {
    /** Write the assistant's context file at the vault root. Absent means on. */
    seedRootContext?: boolean
  }
  /**
   * The optional-update version the user dismissed from the sidebar card.
   *
   * Kept per version rather than as a boolean so the next release asks again —
   * a permanent "don't tell me" would quietly strand someone several versions
   * back. Stored here rather than in localStorage because it is a fact about
   * this installed copy, not about one window.
   *
   * Only ever set for a `soft` gate. A mandatory update has no dismiss.
   */
  dismissedUpdateVersion?: string
  /**
   * The engine Mindex itself uses when nobody asked — folder context, the
   * living index, and the seed for a new chat tab.
   *
   * `model` is free text, not a union: each CLI names its own models and
   * renames them every few months. An empty string means "whatever the CLI's
   * own config says", which is the only value that cannot go stale.
   */
  engine?: {
    provider: ProviderId
    model: string
    /**
     * The master switch: whether folder-context/living-index generation runs
     * at all. Absent means on, matching every install before this existed.
     *
     * Off is stronger than choosing manual over auto below — it blocks the
     * manual click too. Distinct from `isProviderPaused` in
     * `agent-engine/index.ts`, which is an automatic, per-provider,
     * self-clearing state entered after repeated failures; this one is a
     * single global choice the user makes and nothing else can flip.
     */
    contextEngineEnabled?: boolean
    /**
     * Off (default): folder-context/living-index regeneration only ever runs
     * from a manual click — today's behavior, preserved for every existing
     * install. On: a folder that changes arms itself and fires without a
     * click, once it and the vault as a whole have been quiet for a bit.
     *
     * Meaningless when `contextEngineEnabled` is off — nothing runs either way.
     */
    autoContextEnabled?: boolean
    /**
     * Write `.<provider>/skills/mindex-note-types/SKILL.md` into the open
     * vault, describing its note types to the CLI.
     *
     * Absent means on. Turning it off deletes the generated file — but only
     * that file: one whose frontmatter no longer says `generator: mindex` has
     * been taken over by the user and is never touched.
     */
    vaultSkillEnabled?: boolean
    /**
     * Attach Mindex's own `search`/`query`/`backlinks`/`read`/`create`/`update`
     * tools to the agent over MCP, instead of leaving it to grep the vault
     * blind. Absent means on. All three CLIs take these now — Claude and
     * Codex via `mcpServers` on `session/new`, Gemini via the settings file
     * `mcp/gemini-settings.ts` writes into the vault.
     */
    searchToolEnabled?: boolean
    /**
     * Register the same MCP server into other AI apps on this machine —
     * Claude Desktop, Cursor, the plain `claude` CLI outside Mindex — so the
     * open vault is reachable from them too, not only from Mindex's own chat.
     *
     * Off by default: unlike `searchToolEnabled`, which only ever reaches the
     * CLI Mindex itself spawns, this writes into other applications' own
     * config files — a real widening of who can read and write the vault,
     * worth an explicit opt-in rather than inheriting "on" like the rest of
     * this block. See `mcp/external-targets.ts`.
     */
    externalMcpEnabled?: boolean
  }
  /**
   * The model for background work only — folder context and the living index.
   *
   * Separate from `engine.model` because that one is dual-purpose: it also
   * seeds every new chat tab. Background context work re-reads and
   * re-summarises the vault on a schedule, so it spends far more tokens than
   * chatting does and wants the cheapest capable model, while chat wants the
   * best one. Storing a single value made those two pull against each other.
   *
   * Provider is deliberately not stored: it always follows `engine.provider`,
   * so there is only one CLI to have installed and signed in to. Unset means
   * "use `engine.model`", which is what every install before this had.
   */
  contextModel?: string
  /**
   * Link health (dead links, orphan notes) is always available as a manual
   * check — it's a pure, cheap read over the already-loaded note index, not
   * an AI call, so there's no cost to gate the way `engine.contextEngineEnabled`
   * gates AI generation. This only controls whether it *also* recomputes on
   * its own, same three-state idea as Auto Context (off / manual / auto),
   * just without a master switch that would disable manual too.
   */
  linkHealth?: {
    /** Recompute automatically (debounced) whenever the note index changes,
     *  instead of only when the Links panel is manually opened. */
    autoEnabled?: boolean
  }
  /**
   * Per-feature on/off for the AI features that run through `main/ai`. Absent —
   * and every absent field within it — means on: a feature ships enabled, and
   * this block exists only so a person can turn one off, the same default-on
   * convention the `engine` block uses. See `AiFeatureSettings` in `shared/ai.ts`.
   */
  ai?: import('../ai').AiFeatureSettings
  /**
   * What a fresh tab opens as: the chat UI, or the provider's own terminal.
   *
   * Both drive the same CLI — this only decides which face of it you get by
   * default. Unset behaves as 'chat', which is what every install before this
   * did. Either can still be switched per tab afterwards.
   */
  defaultView?: 'chat' | 'cli'
  chatDefaults?: {
    provider?: ProviderId
    model: string
    effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
    permissionMode: 'default' | 'acceptEdits' | 'plan' | 'auto'
  }
  /**
   * Settings chosen from what an agent advertised, kept per agent rather than
   * per tab: choose a model in one conversation and the next one with the same
   * agent opens on it.
   *
   * Stored exactly as the agent named them, deliberately — not translated into
   * `chatDefaults` above. That vocabulary is Mindex's own and it is narrower
   * than what the agents actually offer: it has four permission modes where
   * Claude has six, and five effort rungs where Codex has six. Anything that
   * does not fit would be silently dropped on save and come back as something
   * the user never picked.
   *
   * Values that no longer exist are skipped when applied, so a model the vendor
   * retires costs nothing.
   */
  agentOptions?: Record<string, Record<string, string | boolean>>
}
