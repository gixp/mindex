export type ChatRole = 'user' | 'assistant'

/**
 * A model name, as its own CLI spells it.
 *
 * Deliberately not a union any more. It was `'opus' | 'sonnet' | 'fable' |
 * 'haiku'`, which only ever worked because one vendor happened to accept short
 * aliases; Gemini and Codex take full ids that change every few months, and a
 * closed union would have to be edited — and shipped — every time one of them
 * renamed something. The catalogue lives in src/main/providers/registry.ts and
 * an empty string means "use the CLI's own configured default".
 */
export type ChatModel = string

export type ChatEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type ChatPermissionMode = 'default' | 'acceptEdits' | 'plan' | 'auto'

export interface ChatUsage {
  inputTokens: number
  outputTokens: number
}

export type ChatToolStatus = 'running' | 'done' | 'error'

export interface ChatTextPart {
  type: 'text'
  text: string
}
export interface ChatToolPart {
  type: 'tool'
  id: string
  name: string
  input: unknown
  result?: string
  status: ChatToolStatus
}
export type ChatPart = ChatTextPart | ChatToolPart

export interface ChatMessage {
  id: string
  role: ChatRole
  text: string
  ts: number
  parts?: ChatPart[]
  toolUses?: Array<{ name: string; inputPreview: string }>
}

export type ChatTurnStatus = 'pending' | 'streaming' | 'done' | 'cancelled' | 'failed'

/**
 * Why a turn failed, when the window can offer something better than the text.
 *
 * Only `auth` is acted on today — it is the one failure a person can clear
 * themselves, and the one where an error message alone leaves them looking for
 * a terminal. The rest are carried so the window can tell them apart without
 * reading the message, which is prose from three different vendors.
 */
export type ChatTurnErrorReason = 'auth' | 'cli_missing' | 'timeout' | 'crash' | 'aborted'

/**
 * One choice offered by `session/request_permission`.
 *
 * `optionId` is not standardised between vendors (Claude answers with
 * `reject`/`allow`/`allow_always`; Gemini with
 * `cancel`/`proceed_once`/`proceed_always_server`/…), confirmed on the wire —
 * see `docs/acp-mcp-wiring-findings.md`. A button must be labelled from
 * `name`/`kind`, never from a hardcoded `optionId` string.
 */
export interface ChatPermissionOption {
  optionId: string
  name: string
  kind?: string
}

/** The one shape of `toolCall.content` this app renders specially — a file edit. */
export interface ChatPermissionDiff {
  path: string
  oldText?: string
  newText: string
}

/**
 * A turn paused mid-flight, waiting on a person to answer
 * `session/request_permission`. Lives on the turn rather than on a
 * `ChatToolPart`: the agent can send this before any `tool_call` update for
 * the same id has arrived, so there may be no part yet to hang it off.
 */
export interface ChatPermissionRequest {
  requestId: string
  toolCallId: string
  title?: string
  toolKind?: string
  diff?: ChatPermissionDiff
  options: ChatPermissionOption[]
}

export interface ChatTurn {
  id: string
  user: ChatMessage
  assistant?: ChatMessage
  status: ChatTurnStatus
  startedAt: number
  finishedAt?: number
  jobId?: string
  errorMessage?: string
  errorReason?: ChatTurnErrorReason
  usage?: ChatUsage
  /** Cleared the moment it is answered — by a person, a timeout, or the session ending. */
  pendingPermission?: ChatPermissionRequest
}

export interface ChatSession {
  id: string
  model?: string
  createdAt: number
  updatedAt: number
  turns: ChatTurn[]
  /**
   * The agent's own session id from `session/new` — not Mindex's `id` above,
   * which is this tab's UUID and outlives any one agent process. Kept so a
   * later tab open can try `session/load` instead of `session/new` and
   * actually resume the agent's own memory of the conversation, not just
   * replay the transcript text at it. Only meaningful together with
   * `agentProvider`: a session id from Claude means nothing to Codex, and a
   * provider switch on the same tab has to drop both.
   */
  agentSessionId?: string
  agentProvider?: string
}

export interface ChatSessionSummary {
  id: string
  createdAt: number
  updatedAt: number
  turnCount: number
  firstUserText?: string
}

/** How far out from the note in front of you the assistant may read. */
export type RequestScopeKind = 'note' | 'folder' | 'vault'

/**
 * Where the answer goes.
 *
 * The first four are places inside the app; the rest are file formats, which
 * the assistant writes with its own tools. Nothing here converts anything —
 * see `main/chat/request-shape.ts` for why that is the right division.
 */
export type RequestOutput =
  | 'auto'
  | 'chat'
  | 'this-note'
  | 'new-note'
  | 'docx'
  | 'xlsx'
  | 'pdf'
  | 'md'

export type RequestLength = 'auto' | 'sentence' | 'paragraph' | 'page' | 'words'

/**
 * What to ask for beyond the words typed.
 *
 * Shared, because the window holds the choice and the app half says it. Every
 * field absent means the ordinary setting, which produces no instruction at
 * all — so a message with no shape is exactly the message that was typed.
 */
export interface RequestShape {
  /** `note` is vault-relative and is what the scope is measured from. */
  scope?: { kind: RequestScopeKind; note: string }
  output?: RequestOutput
  length?: RequestLength
  /** Only read when `length` is `words`. */
  lengthWords?: number
}

export interface ChatSendInput {
  sessionId: string
  text: string
  /** Which CLI should answer. Absent means Claude, as before. */
  provider?: 'claude' | 'gemini' | 'codex'
  model?: string
  effort?: ChatEffort
  permissionMode?: ChatPermissionMode
  /**
   * Absolute paths handed over with this message.
   *
   * Sent as link blocks rather than pasted into the text as `@path` lines.
   * Those lines were a convention the assistant had to recognise, and only one
   * of the three did; a link block says "this is a file" as data.
   */
  attachments?: string[]
  /**
   * The three rows from the composer, carried as data.
   *
   * They used to be pasted on top of the message by the window. The window now
   * sends the choice and the app half says it — one place, beside the standing
   * rules, reachable by a test without a DOM.
   */
  shape?: RequestShape
}

export interface ChatTurnStartPayload {
  sessionId: string
  turnId: string
  user: ChatMessage
}

export interface ChatAssistantTextPayload {
  sessionId: string
  turnId: string
  deltaText: string
}

export interface ChatToolUsePayload {
  sessionId: string
  turnId: string
  id: string
  name: string
  input: unknown
  inputPreview: string
}

export interface ChatToolResultPayload {
  sessionId: string
  turnId: string
  toolUseId: string
  isError: boolean
  preview?: string
}

export interface ChatTurnDonePayload {
  sessionId: string
  turnId: string
  finalText: string
  ok: boolean
  errorMessage?: string
  errorReason?: ChatTurnErrorReason
  usage?: ChatUsage
}

export interface ChatSessionUpdatedPayload {
  sessionId: string
}

export interface ChatPermissionRequestPayload extends ChatPermissionRequest {
  sessionId: string
  turnId: string
}

export interface ChatPermissionResolvedPayload {
  sessionId: string
  turnId: string
  requestId: string
}

export interface ChatRespondToPermissionInput {
  sessionId: string
  requestId: string
  /** `null` means the person declined, or closed the prompt without choosing. */
  optionId: string | null
}

// Local whisper.cpp dictation types (WhisperStatus, VoiceTranscribeInput/Result,
// VoiceModelDownloadProgress, VoiceBinaryInstallProgress) archived to
// ../archive/app/shared/voice-dictation.ts along with the rest of the dictation feature.

export interface ChatWarmInput {
  sessionId: string
  provider?: 'claude' | 'gemini' | 'codex'
  model?: string
  effort?: ChatEffort
  permissionMode?: ChatPermissionMode
}
