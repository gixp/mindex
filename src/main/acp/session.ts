import { AcpConnection } from './connection'
import type { PromptBlock } from './content-blocks'
import { acpCommand, describeAcpCommand } from './launch'
import { makeTranslator, type Translator } from './translate'
import type {
  InitializeResult,
  NewSessionResult,
  PromptResult,
  SessionConfigOption,
  SessionModeState,
  SessionUpdateParams
} from './protocol'
import type { AcpCommand } from '@shared/acp'
import type { StreamEvent } from '@main/providers/stream-parser'
import type { ProviderId } from '@main/providers/types'
import { toWireMcpServer, type McpServerSpec } from '@main/mcp/protocol'

/**
 * One ACP session: an adapter process, a `sessionId`, and the turns run on it.
 *
 * The shape to notice is what is *not* here. There is no signature to compare
 * and no reason to restart on a settings change: model, thought level and mode
 * are `session/set_config_option` calls against a live session, not argv baked
 * in at spawn. The stdout path had to kill the process to change a model; this
 * one asks it to.
 *
 * Turn boundaries come from the protocol too. `session/prompt` resolves with a
 * `stopReason`, which replaces re-parsing every stdout line looking for
 * `type === 'result'`.
 */

/** ACP's protocol revision, as advertised in `initialize`. */
const PROTOCOL_VERSION = 1

export interface AcpSessionOptions {
  provider: ProviderId
  cwd: string
  /** Attached to `session/new` verbatim. Absent or empty means no tools. */
  mcpServers?: McpServerSpec[]
  /**
   * Tool names the assistant should not use, where its adapter accepts them.
   *
   * This is the one place a scope can reach the assistant's *own* tools rather
   * than Mindex's. Claude's adapter reads options off `_meta.claudeCode` on
   * `session/new` — verified by reading the adapter, not assumed — and the
   * others ignore an unknown `_meta` key, which is the right failure: the
   * scope is still enforced on Mindex's tools for them.
   *
   * Read once, when the session opens. Narrowing it later means opening the
   * session again, which is why the caller only sets it when the scope is
   * narrower than the whole vault.
   */
  disallowedTools?: string[]
  /**
   * A previous turn's agent-assigned session id, if this call should try to
   * resume it via `session/load` rather than start fresh with `session/new`.
   *
   * Best-effort in every direction: skipped outright if the adapter's own
   * `initialize` response does not advertise `agentCapabilities.loadSession`,
   * and `open()` falls back to an ordinary `session/new` if the load call
   * itself fails — a stale id from an adapter that no longer remembers it is
   * a reason to start over, not a reason to fail the whole session.
   */
  resumeSessionId?: string
  /**
   * The session-wide fallback for an agent-initiated request.
   *
   * Only reached when no `permissionHandler` is set for the turn in flight
   * (see below) — a one-shot job never sets one, so this is the only answer
   * a headless run ever gets. Absent means "no opinion" (`{}`), which is fine
   * for a job whose mode never asks; a job that does have to answer for real
   * should pass one that returns `{ outcome: { outcome: 'cancelled' } }` for
   * `session/request_permission` rather than the bare `{}` default, which
   * fails an adapter's own response validation (confirmed on Gemini — see
   * `docs/acp-mcp-wiring-findings.md`) rather than being read as "deny".
   */
  onRequest?: (method: string, params: unknown) => Promise<unknown>
  /** The adapter died. The session is unusable from that point on. */
  onClose?: (reason: string) => void
  /** For the engine log: the exact command being started. */
  onSpawn?: (description: string) => void
}

export interface TurnResult {
  stopReason: string
  usage?: { inputTokens: number; outputTokens: number }
  contextUsed?: { used: number; size: number }
}

export class AcpSession {
  private conn: AcpConnection
  private opts: AcpSessionOptions
  private turn: Translator | null = null

  readonly provider: ProviderId
  sessionId = ''
  /** What the agent says it can be configured with. Empty for Gemini. */
  configOptions: SessionConfigOption[] = []
  /** The legacy mode surface. Gemini has only this; Claude and Codex have both. */
  modes: SessionModeState | undefined
  /** Sign-in methods the agent wants. Empty means it is already authenticated. */
  authMethods: string[] = []
  /** Slash commands this session accepts. Arrives shortly after the session opens. */
  commands: AcpCommand[] = []
  /** Told when the command list lands, since it does not come with `session/new`. */
  onCommands: (() => void) | null = null
  lastUsedAt = Date.now()
  busy = false
  /** Whether `resumeSessionId` was actually honoured — a real `session/load`, not just requested. */
  resumed = false
  /**
   * Answers an agent request for the turn currently in flight — set by the
   * caller right before `prompt()`, cleared right after. A live chat turn
   * needs a different answer each time (it has to know which Mindex turn a
   * permission prompt belongs to), while the session itself is opened once;
   * `AcpSessionOptions.onRequest` above is what a caller with nothing more
   * specific falls back to.
   */
  permissionHandler: ((method: string, params: unknown) => Promise<unknown>) | null = null

  private constructor(conn: AcpConnection, opts: AcpSessionOptions) {
    this.conn = conn
    this.opts = opts
    this.provider = opts.provider
  }

  /** Start the adapter, handshake, and open a session. Throws on any failure. */
  static async open(opts: AcpSessionOptions): Promise<AcpSession> {
    const cmd = await acpCommand(opts.provider, opts.cwd)
    opts.onSpawn?.(describeAcpCommand(cmd))

    // `let`, not `const`: `onNotification` below closes over `session` and
    // reads it before it exists (an adapter can talk before `session/new`
    // returns), and `conn` itself has to exist before `AcpSession` can be
    // built from it — so the declaration and the one assignment (line ~115)
    // can't be merged into one `const`, even though it's assigned only once.
    // eslint-disable-next-line prefer-const
    let session: AcpSession | undefined
    const conn = AcpConnection.start({
      bin: cmd.bin,
      args: cmd.args,
      cwd: opts.cwd,
      env: cmd.env,
      onNotification: (method, params) => {
        if (method !== 'session/update') return
        const p = params as SessionUpdateParams | undefined
        if (!p?.update) return
        // Before `session/new` returns there is no id to compare against, and
        // an adapter may already be talking; accept those rather than drop them.
        if (session?.sessionId && p.sessionId && p.sessionId !== session.sessionId) return

        // Commands arrive on their own, outside any turn — they are a property
        // of the session, not of an answer — so they are taken here rather than
        // in the per-turn reader, which does not exist yet at this point.
        if (p.update.sessionUpdate === 'available_commands_update' && session) {
          session.commands = (p.update.availableCommands ?? [])
            .filter((c): c is { name: string; description?: string } => typeof c?.name === 'string')
            // Names starting with a double underscore are the assistant's own
            // plumbing, not something to offer a person.
            .filter((c) => !c.name.startsWith('__'))
            .map((c) => ({ name: c.name, description: c.description }))
          session.onCommands?.()
          return
        }

        session?.turn?.handle(p.update)
      },
      // `session` does not exist yet on the very first inbound message — same
      // situation as `onNotification` above, same fix: read it through the
      // closure rather than capture it by value.
      onRequest: (method, params) =>
        session?.permissionHandler
          ? session.permissionHandler(method, params)
          : (opts.onRequest?.(method, params) ?? Promise.resolve({})),
      onClose: opts.onClose
    })

    session = new AcpSession(conn, opts)

    const init = await conn.request<InitializeResult>('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      // Mindex does not proxy the filesystem: the agent works in the vault
      // directly, exactly as it does from a terminal. Claiming these would
      // route every read and write back through us for no benefit.
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } }
    })
    session.authMethods = (init.authMethods ?? []).map((m) => m.id)

    const wireServers = (opts.mcpServers ?? []).map(toWireMcpServer)
    // `agentCapabilities` is the one honest signal here — confirmed live
    // against Claude (`docs/acp-session-load-findings.md`): a real
    // `session/load` genuinely restores the agent's own memory, replayed as
    // ordinary `session/update` notifications this class already knows to
    // drop when there is no turn in flight to hand them to.
    const canLoad = init.agentCapabilities?.['loadSession'] === true
    let created: NewSessionResult | null = null
    if (opts.resumeSessionId && canLoad) {
      try {
        created = await conn.request<NewSessionResult>('session/load', {
          sessionId: opts.resumeSessionId,
          cwd: opts.cwd,
          mcpServers: wireServers
        })
        session.resumed = true
      } catch {
        // The id may belong to a session the adapter no longer has — a
        // restart on its side, a different account, an expired cache. Not a
        // reason to fail opening the tab; fall through to an ordinary
        // `session/new` exactly as if resuming had never been requested.
        created = null
      }
    }
    created ??= await conn.request<NewSessionResult>('session/new', {
      cwd: opts.cwd,
      mcpServers: wireServers,
      ...(opts.disallowedTools?.length
        ? { _meta: { claudeCode: { options: { disallowedTools: opts.disallowedTools } } } }
        : {})
    })
    // `session/load`'s response is not guaranteed to echo `sessionId` back —
    // the caller already supplied it as the request's own `sessionId`, so an
    // adapter may reasonably omit it from the reply. Trusting a possibly
    // absent `created.sessionId` here left it `undefined` for at least one
    // adapter (Codex), which then rejected the very next `session/prompt`
    // outright with "Invalid params" — fast and silent-looking, since the
    // session had opened "successfully" moments before.
    session.sessionId = session.resumed ? opts.resumeSessionId! : created.sessionId
    session.configOptions = created.configOptions ?? []
    session.modes = created.modes
    return session
  }

  get alive(): boolean {
    return this.conn.alive
  }

  get firstByteMs(): number | undefined {
    return this.conn.firstByteMs
  }

  get stderrTail(): string {
    return this.conn.stderrTail
  }

  /**
   * Change one advertised setting on the live session.
   *
   * Best-effort by design: a value the agent no longer offers — a model the
   * vendor withdrew, say — must be skipped rather than allowed to take the
   * session down. The caller learns nothing failed, which is the right amount
   * of noise for a stale preference.
   */
  async setConfigOption(optionId: string, value: string | boolean): Promise<boolean> {
    try {
      const res = await this.conn.request<{ configOptions?: SessionConfigOption[] }>(
        'session/set_config_option',
        // `configId`, not `optionId` — the adapter validates with Zod and its
        // rejection spells the schema out, which is how this was pinned down
        // rather than guessed.
        //
        // A boolean must also declare `type`. The request is a discriminated
        // union and the boolean branch is the one that needs the tag; a string
        // is unambiguous without it.
        typeof value === 'boolean'
          ? { sessionId: this.sessionId, configId: optionId, type: 'boolean', value }
          : { sessionId: this.sessionId, configId: optionId, value }
      )
      // The agent's reply replaces the array wholesale — it is the authority on
      // its own state, and one option can rewrite others (picking a model can
      // change which thought levels exist).
      if (res?.configOptions) this.configOptions = res.configOptions
      return true
    } catch {
      return false
    }
  }

  /**
   * Change the mode through the older, separate call.
   *
   * Only for agents that advertise no mode among their options — Gemini is the
   * one that matters. Same best-effort contract as above.
   */
  async setMode(modeId: string): Promise<boolean> {
    try {
      await this.conn.request('session/set_mode', { sessionId: this.sessionId, modeId })
      if (this.modes) this.modes = { ...this.modes, currentModeId: modeId }
      return true
    } catch {
      return false
    }
  }

  /** Run one turn. Resolves when the agent reports why it stopped. */
  /**
   * One turn.
   *
   * Takes blocks rather than a string because a file handed over is a file,
   * not a line of text that happens to look like a path. `promptBlocks` builds
   * them; a caller with nothing attached gets a single text block and the wire
   * carries exactly what it always did.
   */
  async prompt(blocks: PromptBlock[], onEvent: (e: StreamEvent) => void): Promise<TurnResult> {
    const translator = makeTranslator(onEvent)
    this.turn = translator
    this.busy = true
    try {
      const res = await this.conn.request<PromptResult>('session/prompt', {
        sessionId: this.sessionId,
        prompt: blocks
      })
      translator.endTurn()
      return {
        stopReason: res?.stopReason ?? 'end_turn',
        // Token cost comes from here, not from the `usage_update`
        // notifications — those measure context-window fill.
        usage: res?.usage
          ? {
              inputTokens: res.usage.inputTokens ?? 0,
              outputTokens: res.usage.outputTokens ?? 0
            }
          : undefined,
        contextUsed: translator.contextUsed()
      }
    } finally {
      this.busy = false
      this.turn = null
      this.lastUsedAt = Date.now()
    }
  }

  /**
   * Interrupt the turn in flight, without ending the session.
   *
   * The real gain over the stdout path, where cancelling meant killing the
   * process and re-entering the conversation through the CLI's own transcript
   * on the next message. Here the pending `session/prompt` simply resolves with
   * `stopReason: 'cancelled'` and the session stays open.
   */
  cancel(): void {
    if (!this.conn.alive) return
    this.conn.notify('session/cancel', { sessionId: this.sessionId })
  }

  close(): void {
    this.conn.close()
  }
}
