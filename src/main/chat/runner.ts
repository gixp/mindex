import { randomUUID } from 'node:crypto'
import type { StreamEvent } from '@main/agent-engine'
import {
  engineScheduler,
  logEngine,
  noteAuthOrMissingFailure,
  resetAuthOrMissingCounter,
  runAgentJob,
  type AgentJobOptions,
  type AgentJobResult
} from '@main/agent-engine'
import { endAllAcpChatSessions, ensureAcpChatSession, runAcpChatTurn } from '@main/acp/chat-session'
import {
  FILE_NAMING_RULE,
  NO_INTERACTIVE_TOOLS_RULE,
  TAB_TITLE_RULE
} from '@main/context/prompt-rules'
import type {
  ChatPermissionMode,
  ChatAssistantTextPayload,
  ChatEffort,
  ChatMessage,
  ChatTurn,
  ChatTurnDonePayload,
  ChatTurnErrorReason,
  ChatTurnStartPayload,
  ChatToolUsePayload,
  ChatToolResultPayload,
  ChatUsage
} from '@shared/chat'
import { buildChatPrompt } from './prompt'
import { MCP_TOOL_NAMES, mcpServerSpec } from '@main/mcp'
import { bridgeScopeFor } from '@main/mcp/bridge'
import { toolsToSilence } from '@main/mcp/scope'
import { getCachedAppSettings } from '@main/settings/app-settings'
import {
  appendTurn,
  ensureSession,
  getSession,
  appendAssistantDelta,
  appendToolUse,
  setToolResult,
  updateTurn
} from './store'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const FEATURE = 'chat'

interface ChatFeatureHandle {
  stop(): void
}

let active: ChatFeatureHandle | null = null
let vaultRootCurrent: string | null = null
type BroadcastFn = <T>(channel: string, payload: T) => void
let broadcast: BroadcastFn | null = null

const CHAT_EVT = {
  turnStart: 'chatEvents:turnStart',
  assistantText: 'chatEvents:assistantText',
  toolUse: 'chatEvents:toolUse',
  toolResult: 'chatEvents:toolResult',
  turnDone: 'chatEvents:turnDone'
} as const

export function setChatBroadcast(fn: BroadcastFn | null): void {
  broadcast = fn
}

export function startChatFeature(opts: { vaultRoot: string }): ChatFeatureHandle {
  if (active) active.stop()
  vaultRootCurrent = opts.vaultRoot

  const handle: ChatFeatureHandle = {
    stop() {
      for (const j of engineScheduler.active()) {
        if (j.feature === FEATURE) engineScheduler.cancel(j.scope)
      }
      for (const j of engineScheduler.pending()) {
        if (j.feature === FEATURE) engineScheduler.cancel(j.scope)
      }
      // The live CLI processes are per chat tab and every tab belongs to the
      // vault being closed. Left running they would answer against a vault
      // nobody has open, in a working directory that may be gone.
      endAllAcpChatSessions()
      if (active === handle) active = null
      vaultRootCurrent = null
    }
  }
  active = handle
  return handle
}

export function stopChatFeature(): void {
  active?.stop()
}

export interface EnqueueChatTurnOpts {
  sessionId: string
  userText: string
  /** Absolute paths handed over with this turn, sent as link blocks. */
  attachments?: string[]
  provider?: 'claude' | 'gemini' | 'codex'
  model?: string
  effort?: ChatEffort
  permissionMode?: ChatPermissionMode
}

export interface EnqueueChatTurnResult {
  turnId: string
  jobId: string
}

/** Whether a turn on this tab is waiting on the agent right now. */
function isAnswering(sessionId: string): boolean {
  const session = getSession(sessionId)
  if (!session) return false
  return session.turns.some((t) => t.status === 'pending' || t.status === 'streaming')
}

export function enqueueChatTurn(opts: EnqueueChatTurnOpts): EnqueueChatTurnResult {
  const root = vaultRootCurrent
  if (!root) throw new Error('Chat feature not started (no vault open)')

  const session = ensureSession(opts.sessionId)
  const turnId = randomUUID()
  const now = Date.now()
  const userMsg: ChatMessage = {
    id: `${turnId}-u`,
    role: 'user',
    text: opts.userText.trim(),
    ts: now
  }
  const turn: ChatTurn = {
    id: turnId,
    user: userMsg,
    status: 'pending',
    startedAt: now
  }
  appendTurn(session.id, turn)

  const scope = `chat:${session.id}`
  // A message sent mid-answer interrupts the answer.
  //
  // It used to queue: the window held the text until the turn finished and
  // sent it after. That is the wrong default for a conversation — the usual
  // reason for typing while an assistant is working is that it is doing the
  // wrong thing, and waiting for it to finish doing the wrong thing before
  // saying so is the one outcome nobody wants.
  //
  // Cancelling here rather than in the window keeps the order honest: the
  // scheduler will not start this turn until the cancelled one has unwound,
  // so the agent is never asked two things at once, and the interrupted turn
  // is recorded as cancelled in the transcript rather than vanishing.
  if (isAnswering(session.id)) engineScheduler.cancel(scope)

  const jobId = engineScheduler.enqueue(
    {
      scope,
      feature: FEATURE,
      run: (signal) => runChatJob(root, opts.sessionId, turnId, opts, signal)
    },
    { immediate: true }
  )
  updateTurn(session.id, turnId, { jobId })

  if (broadcast) {
    const payload: ChatTurnStartPayload = {
      sessionId: session.id,
      turnId,
      user: userMsg
    }
    broadcast(CHAT_EVT.turnStart, payload)
  }

  return { turnId, jobId }
}

/**
 * Everything the agent is asked with, for one chat tab.
 *
 * Shared by the turn path and the warm-up path below, so a warm-up always
 * builds the exact same options a real message would — otherwise it would be
 * warming a session under settings the first real turn doesn't use.
 */
async function buildChatJob(
  vaultRoot: string,
  sessionId: string,
  opts: EnqueueChatTurnOpts,
  turn: {
    prompt: string
    signal?: AbortSignal
    onEvent?: (e: StreamEvent) => void
    announceTools: boolean
  }
): Promise<AgentJobOptions> {
  // The vault's own search, handed to `session/new` as a real MCP server —
  // the same object for all three providers, since ACP takes `mcpServers` as
  // data rather than the per-CLI argv string the raw terminal tab still needs
  // (`mcpConfigJson`/`mcpCodexOverride`, used only by `ipc/handlers/terminal.ts`).
  // No provider branch here any more: whether Claude, Codex or Gemini can
  // actually use it is the adapter's business, not this call site's.
  const searchTools = getCachedAppSettings().engine?.searchToolEnabled !== false
  // Keyed by the conversation, so the fence can be moved between messages
  // without the assistant's tool server being rebuilt.
  const spec = searchTools ? await mcpServerSpec(sessionId) : null
  // Said out loud on every turn, because the alternative is an agent that
  // simply never reaches for these tools and no way to tell whether that is a
  // choice it made or a wire that came loose.
  if (turn.announceTools) {
    logEngine(
      'info',
      spec
        ? 'mindex search tools attached'
        : searchTools
          ? 'mindex search tools unavailable — the bridge did not start'
          : 'mindex search tools off (setting)',
      { feature: FEATURE, scope: `chat:${sessionId}` }
    )
  }

  return {
    provider: opts.provider,
    cwd: vaultRoot,
    prompt: turn.prompt,
    ...(opts.attachments?.length ? { attachments: opts.attachments } : {}),
    model: opts.model,
    effort: opts.effort,
    allowedTools: [
      'Read',
      'Grep',
      'Glob',
      'Write',
      'Edit',
      'WebSearch',
      'WebFetch',
      ...MCP_TOOL_NAMES
    ],
    // `AskUserQuestion` has always been off: it opens a dialog Mindex has no
    // way to draw. The rest arrive only while the scope is narrow, and they are
    // the assistant's own ways of reading the disk around the vault tools that
    // would have refused. Empty for the whole vault, so the ordinary
    // conversation opens exactly the session it always did.
    disallowedTools: ['AskUserQuestion', ...toolsToSilence(bridgeScopeFor(sessionId) ?? null)],
    mcpServers: spec ? [spec] : undefined,
    outputFormat: 'stream-json',
    permissionMode: opts.permissionMode ?? 'default',
    appendSystemPrompt: [FILE_NAMING_RULE, NO_INTERACTIVE_TOOLS_RULE, TAB_TITLE_RULE].join('\n\n'),
    onSpawn: (bin, args) => {
      logEngine('info', `spawn ${bin} ${args.join(' ')}`, {
        feature: FEATURE,
        scope: `chat:${sessionId}`
      })
    },
    timeoutMs: 240_000,
    signal: turn.signal,
    onEvent: turn.onEvent
  }
}

/**
 * A job's own reason, narrowed to what a conversation can carry.
 *
 * The two vocabularies differ by one word: a job distinguishes a CLI that
 * exited non-zero from one that died, and a conversation has nothing different
 * to say about either.
 */
function chatErrorReason(reason: AgentJobResult['errorReason']): ChatTurnErrorReason | undefined {
  if (!reason) return undefined
  return reason === 'nonzero' ? 'crash' : reason
}

/**
 * Start a tab's CLI before there is anything to ask it.
 *
 * The CLI spends its first ten-odd seconds on startup — config, plugins,
 * skills, MCP handshakes — and does that work whenever it happens to be
 * running, not only once a message arrives (measured: a process left idle for
 * fifteen seconds then asked "hey" answered in two). Doing it while the user
 * is still reading the screen is free; doing it after they press Enter is the
 * fifteen-second wait this whole change is about.
 */
export async function warmChatSession(sessionId: string, opts: EnqueueChatTurnOpts): Promise<void> {
  const root = vaultRootCurrent
  if (!root || !UUID_RE.test(sessionId)) return

  const job = await buildChatJob(root, sessionId, opts, { prompt: '', announceTools: false })
  ensureAcpChatSession(sessionId, job)
}

async function runChatJob(
  vaultRoot: string,
  sessionId: string,
  turnId: string,
  opts: EnqueueChatTurnOpts,
  signal: AbortSignal
): Promise<void> {
  if (signal.aborted) return

  const session = getSession(sessionId)
  if (!session) return

  // `startedAt` is stamped when the turn is enqueued, so the gap between it
  // and now is exactly how long this sat in the engine's queue.
  const dequeuedAt = Date.now()
  const enqueuedAt = session.turns.find((t) => t.id === turnId)?.startedAt ?? dequeuedAt

  const provider = opts.provider ?? 'claude'
  const useRealSession = UUID_RE.test(sessionId)

  // ACP's own session id is chosen by the agent and held entirely inside
  // `acp/chat-session.ts`, keyed by this tab's own id — there is nothing left
  // for the runner to compute or remember about it. The only thing that still
  // depends on `useRealSession` is which prompt goes out: a live conversation
  // gets the bare new message, a scratch tab (no persistent session) gets its
  // history folded into the prompt text.
  let prompt: string
  if (useRealSession) {
    prompt = opts.userText.trim()
  } else {
    const completedHistory = session.turns.filter(
      (t) => t.id !== turnId && t.status === 'done' && !!t.assistant
    )
    prompt = buildChatPrompt({
      history: completedHistory,
      userText: opts.userText,
      isFirstTurn: completedHistory.length === 0
    })
  }

  updateTurn(sessionId, turnId, { status: 'streaming' })

  const onEvent = (e: StreamEvent): void => {
    if (e.kind === 'assistant_text') {
      appendAssistantDelta(sessionId, turnId, e.text)
      if (broadcast) {
        const payload: ChatAssistantTextPayload = {
          sessionId,
          turnId,
          deltaText: e.text
        }
        broadcast(CHAT_EVT.assistantText, payload)
      }
    } else if (e.kind === 'tool_use') {
      const inputPreview =
        typeof e.input === 'object' && e.input !== null ? JSON.stringify(e.input).slice(0, 120) : ''
      appendToolUse(sessionId, turnId, { id: e.id, name: e.name, input: e.input })
      if (broadcast) {
        const payload: ChatToolUsePayload = {
          sessionId,
          turnId,
          id: e.id,
          name: e.name,
          input: e.input,
          inputPreview
        }
        broadcast(CHAT_EVT.toolUse, payload)
      }
      logEngine('info', `${e.name}(${inputPreview})`, {
        feature: FEATURE,
        scope: `chat:${sessionId}`
      })
    } else if (e.kind === 'tool_result') {
      setToolResult(sessionId, turnId, {
        toolUseId: e.toolUseId,
        isError: e.isError,
        preview: e.preview
      })
      if (broadcast) {
        const payload: ChatToolResultPayload = {
          sessionId,
          turnId,
          toolUseId: e.toolUseId,
          isError: e.isError,
          preview: e.preview
        }
        broadcast(CHAT_EVT.toolResult, payload)
      }
      if (e.isError) {
        logEngine('warn', `tool_result error: ${e.preview ?? ''}`, {
          feature: FEATURE,
          scope: `chat:${sessionId}`
        })
      }
    }
  }

  const job = await buildChatJob(vaultRoot, sessionId, opts, {
    prompt,
    signal,
    onEvent,
    announceTools: true
  })

  const spawnedAt = Date.now()

  // The tab's own live session first. It answers in about a second because
  // the connection is already up; the one-shot path below pays the full cold
  // start on every single message. Only used when the prompt is a bare turn —
  // the `useRealSession` branch above — because a session that carries the
  // conversation itself must not also be handed a transcript in its prompt.
  // `null` means "not usable here", never "failed".
  let persistent = false
  let result: AgentJobResult | null = null
  if (useRealSession && !signal.aborted) {
    result = await runAcpChatTurn(sessionId, job, turnId, prompt, onEvent)
    persistent = result !== null
  }
  if (!result) result = await runAgentJob(job)

  // Where the wall-clock time went, in one line.
  //
  // "It took 17 seconds" is not a diagnosis: the wait is queueing in the
  // engine, the agent's own startup, and the model. Only the last of those is
  // a bug, and without the split there is no way to tell which one happened.
  const queuedMs = spawnedAt - enqueuedAt
  logEngine(
    'info',
    `turn ${result.ok ? 'done' : 'failed'} in ${Date.now() - enqueuedAt}ms ` +
      `(queued ${queuedMs}ms, agent ${result.durationMs}ms, first byte ${result.firstByteMs ?? '—'}ms, ` +
      `${persistent ? 'live session' : 'cold start'})`,
    { feature: FEATURE, scope: `chat:${sessionId}` }
  )

  const usage: ChatUsage | undefined = result.usage
    ? { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens }
    : undefined

  if (signal.aborted) {
    updateTurn(sessionId, turnId, {
      status: 'cancelled',
      finishedAt: Date.now(),
      usage
    })
    if (broadcast) {
      const payload: ChatTurnDonePayload = {
        sessionId,
        turnId,
        finalText: getSession(sessionId)?.turns.find((t) => t.id === turnId)?.assistant?.text ?? '',
        ok: false,
        errorMessage: 'cancelled',
        usage
      }
      broadcast(CHAT_EVT.turnDone, payload)
    }
    return
  }

  if (!result.ok) {
    if (result.errorReason === 'cli_missing' || result.errorReason === 'auth') {
      noteAuthOrMissingFailure(provider)
    }
    const errorMessage = result.errorMessage ?? result.errorReason ?? 'unknown error'
    // Carried rather than re-derived in the window: only this side knows
    // whether the assistant was signed out, and the window needs it to offer
    // the way back in instead of a wall of the adapter's own log.
    const errorReason = chatErrorReason(result.errorReason)
    updateTurn(sessionId, turnId, {
      status: 'failed',
      finishedAt: Date.now(),
      errorMessage,
      ...(errorReason ? { errorReason } : {})
    })
    if (broadcast) {
      const payload: ChatTurnDonePayload = {
        sessionId,
        turnId,
        finalText: '',
        ok: false,
        errorMessage,
        ...(errorReason ? { errorReason } : {})
      }
      broadcast(CHAT_EVT.turnDone, payload)
    }
    return
  }

  resetAuthOrMissingCounter(provider)
  const finalText =
    (result.finalText ?? '').trim() ||
    getSession(sessionId)?.turns.find((t) => t.id === turnId)?.assistant?.text ||
    ''

  updateTurn(sessionId, turnId, {
    status: 'done',
    finishedAt: Date.now(),
    usage
  })

  if (broadcast) {
    const payload: ChatTurnDonePayload = {
      sessionId,
      turnId,
      finalText,
      ok: true,
      usage
    }
    broadcast(CHAT_EVT.turnDone, payload)
  }
}

export function cancelChatTurn(sessionId: string): void {
  engineScheduler.cancel(`chat:${sessionId}`)
}
