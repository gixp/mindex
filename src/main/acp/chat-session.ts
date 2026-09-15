import { randomUUID } from 'node:crypto'
import { AcpSession } from './session'
import { applySessionConfig } from './config'
import { authFailureMessage, looksLikeAuthFailure } from './auth-failure'
import { promptBlocks } from './content-blocks'
import { getCachedAppSettings, patchAppSettings } from '@main/settings/app-settings'
import { buildSurface, LEGACY_MODE_OPTION_ID, withRemembered } from './surface'
import { catalogueFor, commandsFor } from './catalogue'
import {
  diffContentOf,
  type RequestPermissionParams,
  type RequestPermissionResult
} from './protocol'
import type { AcpCommand, AcpConfigOption } from '@shared/acp'
import { providerSpec } from '@main/providers/registry'
import { logEngine } from '@main/agent-engine'
import type { AgentJobOptions, AgentJobResult } from '@main/agent-engine/engine'
import type { StreamEvent } from '@main/providers/stream-parser'
import type { ProviderId } from '@main/providers/types'
import type { ChatPermissionRequestPayload } from '@shared/chat'
import { getSession as getChatSession, setAgentSession } from '@main/chat/store'

/**
 * One live ACP session per chat tab, kept between turns.
 *
 * Model, thought level and mode are `session/set_config_option` calls against
 * the running session — nothing here is argv, so nothing has to restart to
 * change them. `session/prompt` resolves with a `stopReason`, so the end of a
 * turn is reported by the agent rather than inferred. `session/cancel`
 * interrupts a turn in place and leaves the session open for the next one.
 *
 * Works uniformly for all three providers — there is no per-CLI capability
 * split here at all.
 */

/** Matches the stdout path: an idle session is not worth the resident adapter. */
const IDLE_TIMEOUT_MS = 15 * 60 * 1000
const IDLE_SWEEP_MS = 60 * 1000
/** Matches the one-shot path, so a wedged turn fails the way it always did. */
const TURN_TIMEOUT_MS = 240_000

const sessions = new Map<string, AcpSession>()
let sweepTimer: ReturnType<typeof setInterval> | null = null

function startSweep(): void {
  if (sweepTimer) return
  sweepTimer = setInterval(() => {
    const now = Date.now()
    for (const [id, s] of sessions) {
      if (!s.busy && now - s.lastUsedAt > IDLE_TIMEOUT_MS) {
        sessions.delete(id)
        s.close()
      }
    }
  }, IDLE_SWEEP_MS)
  // Never hold the app open on this alone.
  sweepTimer.unref?.()
}

/**
 * This tab's live session, but only if it belongs to the assistant being asked
 * about.
 *
 * Everything below used to look a session up by tab id alone. That is right up
 * until somebody changes assistant: the tab id does not change, so a Claude
 * session answered questions about Gemini and — worse — ran Gemini's turns.
 * The visible symptom was the model and mode menus not changing; the actual
 * behaviour was messages going to the assistant the person had just switched
 * away from.
 *
 * A mismatch is not an error. It means the session belongs to the previous
 * assistant and has nothing to say about this one, so every caller falls
 * through to the answer it already had for "no session yet".
 */
export function isUsableFor(
  session: { alive: boolean; provider: ProviderId } | undefined,
  provider: ProviderId
): boolean {
  return session?.alive === true && session.provider === provider
}

function liveSessionFor(sessionId: string, provider: ProviderId): AcpSession | null {
  const s = sessions.get(sessionId)
  return isUsableFor(s, provider) ? (s as AcpSession) : null
}

/** End one tab's session. Safe for a tab that has none. */
export function endAcpChatSession(sessionId: string): void {
  const s = sessions.get(sessionId)
  cancelPendingPermissionsFor(sessionId)
  if (!s) return
  sessions.delete(sessionId)
  s.close()
}

export function endAllAcpChatSessions(): void {
  for (const id of [...sessions.keys()]) endAcpChatSession(id)
  if (sweepTimer) {
    clearInterval(sweepTimer)
    sweepTimer = null
  }
}

/**
 * Live `session/request_permission` prompts, keyed by the id this module
 * makes up for each one — the ACP `toolCallId` is not unique enough to key on
 * by itself (an agent can, in principle, re-request the same call).
 *
 * A person has to answer these from the renderer, arbitrarily far in the
 * future, so each one is a resolver parked here rather than an `await` held
 * open in `buildPermissionHandler` — the map is what makes `respondToPermission`
 * possible from a completely different call stack.
 */
const pendingPermissions = new Map<
  string,
  { sessionId: string; resolve: (r: RequestPermissionResult) => void }
>()

/** Long enough that stepping away doesn't lose the turn; not indefinite, so a forgotten prompt does not wedge the agent open forever. */
const PERMISSION_TIMEOUT_MS = 10 * 60 * 1000

let onPermissionRequest: ((payload: ChatPermissionRequestPayload) => void) | null = null
let onPermissionResolved: ((sessionId: string, turnId: string, requestId: string) => void) | null =
  null

/** Told whenever a permission prompt opens or closes. Set once, same pattern as `setAcpSurfaceListener`. */
export function setAcpPermissionListener(
  onRequest: (payload: ChatPermissionRequestPayload) => void,
  onResolved: (sessionId: string, turnId: string, requestId: string) => void
): void {
  onPermissionRequest = onRequest
  onPermissionResolved = onResolved
}

/**
 * Answers a live permission prompt. `optionId: null` means decline.
 *
 * Returns `false` for a request that is no longer pending — already answered,
 * timed out, or its session ended in the meantime — so the caller can tell a
 * stale click apart from a real failure without this throwing.
 */
export function respondToPermission(requestId: string, optionId: string | null): boolean {
  const pending = pendingPermissions.get(requestId)
  if (!pending) return false
  pendingPermissions.delete(requestId)
  pending.resolve(
    optionId
      ? { outcome: { outcome: 'selected', optionId } }
      : { outcome: { outcome: 'cancelled' } }
  )
  return true
}

/** Declines every prompt still open for one session — a closed tab is not a person who is about to answer. */
function cancelPendingPermissionsFor(sessionId: string): void {
  for (const [requestId, pending] of pendingPermissions) {
    if (pending.sessionId !== sessionId) continue
    pendingPermissions.delete(requestId)
    pending.resolve({ outcome: { outcome: 'cancelled' } })
  }
}

/**
 * Built fresh for each turn (see `runAcpChatTurn`), because the one thing it
 * cannot get from the ACP request itself is which Mindex turn this belongs
 * to — `session/request_permission` carries only the ACP `sessionId`, and a
 * tab's session outlives any one turn.
 */
/**
 * @param onWaiting Told when a prompt opens and when it closes (`true`/`false`).
 *   `runAcpChatTurn` uses this to lift the ordinary turn timeout while a
 *   person may be deliberating — without it, a turn genuinely just waiting on
 *   someone would get `cancel()`ed out from under them at the 4-minute mark.
 */
function buildPermissionHandler(
  sessionId: string,
  turnId: string,
  onWaiting: (waiting: boolean) => void
): (method: string, params: unknown) => Promise<unknown> {
  return async (method, params) => {
    if (method !== 'session/request_permission') return {}
    const p = params as RequestPermissionParams
    const requestId = randomUUID()
    const diff = diffContentOf(p.toolCall)

    const payload: ChatPermissionRequestPayload = {
      sessionId,
      turnId,
      requestId,
      toolCallId: p.toolCall.toolCallId,
      title: p.toolCall.title,
      toolKind: p.toolCall.kind,
      diff: diff ? { path: diff.path, oldText: diff.oldText, newText: diff.newText } : undefined,
      options: (p.options ?? []).map((o) => ({
        optionId: o.optionId,
        name: o.name ?? o.optionId,
        kind: o.kind
      }))
    }

    onWaiting(true)
    const result = await new Promise<RequestPermissionResult>((resolve) => {
      pendingPermissions.set(requestId, { sessionId, resolve })
      onPermissionRequest?.(payload)
      const timer = setTimeout(() => {
        if (pendingPermissions.delete(requestId)) resolve({ outcome: { outcome: 'cancelled' } })
      }, PERMISSION_TIMEOUT_MS)
      timer.unref?.()
    })
    onWaiting(false)
    onPermissionResolved?.(sessionId, turnId, requestId)
    return result
  }
}

/**
 * Told whenever a tab's advertised settings appear or change.
 *
 * Set once, by the layer that owns talking to the window. The settings are not
 * known until the agent has answered, so the UI cannot ask for them up front —
 * it has to be told.
 */
let onSurfaceChange: ((sessionId: string) => void) | null = null

export function setAcpSurfaceListener(fn: (sessionId: string) => void): void {
  onSurfaceChange = fn
}

/**
 * What this tab can be configured with.
 *
 * A live conversation answers for itself — only it knows which value is
 * actually selected right now. Before one exists, the list learned at launch
 * stands in, so the menus are filled the moment the tab opens instead of
 * sitting empty for the second or two the assistant takes to start.
 *
 * The stand-in is the same list of choices; what it cannot know is the current
 * selection — except for the choices made here, which are remembered and laid
 * over it. Without that, a pick made while the assistant was still starting
 * looked undone the moment the menu was reopened.
 */
export function acpTabOptions(sessionId: string, provider: ProviderId): AcpConfigOption[] {
  const s = liveSessionFor(sessionId, provider)
  if (s) return buildSurface(s.configOptions, s.modes)
  return withRemembered(catalogueFor(provider), getCachedAppSettings().agentOptions?.[provider])
}

/**
 * The slash commands this tab accepts.
 *
 * The live conversation answers when it has them; otherwise the list learned at
 * launch stands in. Empty means the assistant was never reached, and the
 * composer falls back to the handful of names Mindex carries itself.
 */
export function acpTabCommands(sessionId: string, provider: ProviderId): AcpCommand[] {
  const s = liveSessionFor(sessionId, provider)
  if (s && s.commands.length > 0) return s.commands
  return commandsFor(provider)
}

/**
 * Remember a choice under the assistant it was made for.
 *
 * Written here rather than in the window, so the caller does not have to read
 * the whole settings file back just to add one key to it. Kept per agent: the
 * next conversation with the same one opens on this choice.
 */
async function rememberOption(
  provider: ProviderId,
  optionId: string,
  value: string | boolean
): Promise<void> {
  const settings = getCachedAppSettings()
  await patchAppSettings({
    agentOptions: {
      ...settings.agentOptions,
      [provider]: { ...settings.agentOptions?.[provider], [optionId]: value }
    }
  })
}

/**
 * Change one setting on a tab.
 *
 * The whole point of the exercise: this reaches a running agent mid-conversation.
 * The old path could only do it by killing the process and starting again,
 * which is why changing a model there cost a fresh cold start.
 *
 * A tab whose assistant has not started yet is the other half, and it used to
 * be answered by dropping the choice on the floor. That is a real ten seconds
 * after a tab opens, and the failure was silent: nothing applied, nothing
 * remembered, nothing said. The choice is now kept, and the first message
 * carries it in — which is where an unstarted assistant would have to receive
 * it anyway.
 */
export async function setAcpTabOption(
  sessionId: string,
  provider: ProviderId,
  optionId: string,
  value: string | boolean
): Promise<boolean> {
  // Only this assistant's own session. A pick made against a session belonging
  // to the previous one would set a model on an agent nobody is talking to,
  // and — because the choice is remembered under `s.provider` below — would
  // write it into the wrong assistant's remembered settings, where it would
  // come back on every future conversation with it.
  const s = liveSessionFor(sessionId, provider)

  if (!s) {
    // Nothing to ask, so nothing can refuse. Applied by the first turn, which
    // reads these back before it sends anything.
    await rememberOption(provider, optionId, value)
    onSurfaceChange?.(sessionId)
    return true
  }

  const ok =
    optionId === LEGACY_MODE_OPTION_ID
      ? typeof value === 'string' && (await s.setMode(value))
      : await s.setConfigOption(optionId, value)

  // Only on success — recording a value the agent refused would restore it on
  // every future session, failing quietly each time.
  if (ok) await rememberOption(s.provider, optionId, value)

  // Report either way: even a refusal can change what the agent advertises, and
  // a menu still showing the old value after a failed pick is worse than one
  // that corrects itself.
  onSurfaceChange?.(sessionId)
  return ok
}

async function acquire(sessionId: string, opts: AgentJobOptions): Promise<AcpSession | null> {
  const provider: ProviderId = opts.provider ?? 'claude'

  const existing = sessions.get(sessionId)
  if (existing?.alive && existing.provider === provider) return existing
  // A live session for a *different* assistant is not reusable, and keeping it
  // around is what made a provider switch silently keep talking to the old one.
  // Ended rather than dropped: the process behind it holds a pipe and a CLI,
  // and abandoning the entry would leak both.
  if (existing?.alive) endAcpChatSession(sessionId)
  // A dead entry is stale bookkeeping, not a reason to fail.
  else if (existing) sessions.delete(sessionId)
  // Read from disk, not from the sign-in methods the assistant advertises —
  // Codex and Gemini list theirs whether or not anyone is signed in.
  if (!(await providerSpec(provider).isAuthenticated())) return null

  // Only offered if the persisted id actually belongs to this provider — a
  // Codex session id means nothing to Claude, and a provider switch on this
  // tab has to drop it rather than hand it to the wrong adapter.
  const remembered = getChatSession(sessionId)
  const resumeSessionId =
    remembered?.agentProvider === provider ? remembered.agentSessionId : undefined

  let session: AcpSession
  try {
    session = await AcpSession.open({
      provider,
      cwd: opts.cwd,
      mcpServers: opts.mcpServers,
      ...(opts.disallowedTools?.length ? { disallowedTools: opts.disallowedTools } : {}),
      resumeSessionId,
      onSpawn: (description) => opts.onSpawn?.(description, []),
      onClose: () => {
        // Only drop the entry if it is still this session: a later turn may
        // already have replaced it.
        if (sessions.get(sessionId) === session) sessions.delete(sessionId)
      }
    })
  } catch (err) {
    logEngine(
      'error',
      `${provider}: could not connect for this chat — ${
        err instanceof Error ? err.message : String(err)
      }`
    )
    return null
  }

  logEngine(
    'info',
    session.resumed
      ? `${provider}: resumed the earlier conversation on this tab, offering ${session.configOptions.length} settings`
      : `${provider}: connected for this chat, offering ${session.configOptions.length} settings`
  )
  // Recorded regardless of whether this run resumed: the id changes on every
  // `session/new` (an adapter never reuses one), so what to try resuming next
  // time always has to be this run's own id, not whatever the tab remembered
  // coming in.
  setAgentSession(sessionId, provider, session.sessionId)

  sessions.set(sessionId, session)
  startSweep()
  // The settings only exist once the agent has answered, so this is the first
  // moment the UI can be told what this tab can be configured with.
  onSurfaceChange?.(sessionId)
  return session
}

/**
 * Start a tab's session before there is anything to ask it.
 *
 * Fire-and-forget, and safe to call repeatedly — an existing live session is
 * left alone. Unlike the stdout path this never has to tear one down: a changed
 * model reaches the running session on the next turn.
 */
export function ensureAcpChatSession(sessionId: string, opts: AgentJobOptions): void {
  // Only a session for *this* assistant counts as already up. One belonging to
  // the previous assistant is exactly the case worth replacing, and returning
  // early on it left the switch to be discovered on the next message.
  if (liveSessionFor(sessionId, opts.provider ?? 'claude')) return
  void acquire(sessionId, opts).catch(() => null)
}

/**
 * Run one turn on the tab's live session.
 *
 * `null` means the path was unusable — no adapter, an agent asking to be
 * signed in, or a tab already mid-turn. It never means the work failed.
 */
export async function runAcpChatTurn(
  sessionId: string,
  opts: AgentJobOptions,
  turnId: string,
  userText: string,
  onEvent: (e: StreamEvent) => void
): Promise<AgentJobResult | null> {
  const hadSession = sessions.get(sessionId)?.alive === true
  const session = await acquire(sessionId, opts)
  if (!session) return null
  // A second turn while one is in flight goes down the old path rather than
  // queueing behind this one.
  if (session.busy) return null

  /**
   * The standing rules, folded in on the first turn of a conversation.
   *
   * They were declared for every chat turn and reached none of them: the only
   * code that read them is the cold-start fallback, and a live session is the
   * ordinary path. So the rule about how a note is named, and the one asking
   * for a tab title, have been off in every conversation since sessions became
   * the normal way to talk.
   *
   * Once per conversation rather than every message, because they do not
   * change and a session remembers what it was told. Repeating them on each
   * turn would spend tokens restating what the assistant already has.
   */
  const preface = !hadSession && opts.appendSystemPrompt ? opts.appendSystemPrompt : null
  const text = preface ? `${preface}\n\n${userText}` : userText

  const start = Date.now()
  try {
    const remembered = getCachedAppSettings().agentOptions?.[opts.provider ?? 'claude']
    const { rejected } = await applySessionConfig(session, opts, remembered)
    // One rolled-up line, not one per option: "my model choice didn't stick" has
    // to be diagnosable from the engine log without correlating separate entries.
    if (rejected.length > 0) {
      logEngine('warn', `agent refused settings: ${rejected.join(', ')} — using its own defaults`)
    }
  } catch {
    /* a setting that would not apply is not a reason to lose the message */
  }

  let finalText = ''
  const collect = (e: StreamEvent): void => {
    if (e.kind === 'assistant_text') finalText += e.text
    onEvent(e)
  }

  // A permission prompt left open past the turn it belongs to is not
  // something a person can still usefully answer — the turn it would resume
  // is already gone.
  const onAbort = (): void => {
    session.cancel()
    cancelPendingPermissionsFor(sessionId)
  }
  opts.signal?.addEventListener('abort', onAbort, { once: true })

  let timer: ReturnType<typeof setTimeout> | undefined
  let rejectTimeout: ((err: Error) => void) | undefined
  // Rearmed rather than fixed: while a `session/request_permission` prompt is
  // open (`onWaiting(true)`), this is stretched out to `PERMISSION_TIMEOUT_MS`
  // so a person taking their time to decide is not indistinguishable from a
  // wedged turn. Back to the ordinary budget the moment it closes.
  const arm = (ms: number): void => {
    clearTimeout(timer)
    timer = setTimeout(() => rejectTimeout?.(new Error('timeout')), ms)
    timer.unref?.()
  }
  session.permissionHandler = buildPermissionHandler(sessionId, turnId, (waiting) =>
    arm(waiting ? PERMISSION_TIMEOUT_MS : TURN_TIMEOUT_MS)
  )

  try {
    const turn = await Promise.race([
      session.prompt(promptBlocks(text, opts.attachments), collect),
      new Promise<never>((_, reject) => {
        rejectTimeout = reject
        arm(TURN_TIMEOUT_MS)
      })
    ])

    const aborted = turn.stopReason === 'cancelled'
    if (finalText) collect({ kind: 'final_text', text: finalText })

    return {
      ok: !aborted,
      exitCode: aborted ? null : 0,
      stdout: '',
      finalText: finalText || undefined,
      errorReason: aborted ? 'aborted' : undefined,
      errorMessage: aborted ? 'aborted' : undefined,
      durationMs: Date.now() - start,
      firstByteMs: session.firstByteMs,
      usage: turn.usage
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const timedOut = message === 'timeout'
    if (timedOut) {
      // Unlike the stdout path, a timeout does not have to retire the session:
      // cancel interrupts the turn and leaves it usable for the next message.
      session.cancel()
    }

    // A session that died on its very first turn is a signal this path does not
    // work here at all. Say nothing and let the caller run the old one, which
    // will produce the real, actionable error.
    if (!hadSession && !timedOut && !session.alive) {
      sessions.delete(sessionId)
      return null
    }

    // Signed out mid-conversation reads as an ordinary crash here — the
    // adapter's log tail is what it leaves behind, and it names a phase rather
    // than a cause. Recognised so the window can offer the way back in.
    const raw = session.stderrTail.trim() || message
    const signedOut = !timedOut && looksLikeAuthFailure(raw, message, finalText)

    return {
      ok: false,
      exitCode: null,
      stdout: '',
      finalText: finalText || undefined,
      errorReason: timedOut ? 'timeout' : signedOut ? 'auth' : 'crash',
      errorMessage: timedOut
        ? 'timed out'
        : signedOut
          ? authFailureMessage(providerSpec(opts.provider ?? 'claude').label, raw)
          : raw,
      durationMs: Date.now() - start,
      firstByteMs: session.firstByteMs
    }
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onAbort)
    // `session.busy` (checked at the top of this function) keeps two turns
    // from overlapping on one session, so this is always still this turn's
    // own handler being cleared, never a later turn's.
    session.permissionHandler = null
  }
}
