/**
 * The slice of ACP (Agent Client Protocol) Mindex actually speaks.
 *
 * Deliberately hand-written rather than imported from `@agentclientprotocol/sdk`.
 * The wire is plain JSON-RPC 2.0 over newline-delimited JSON, the connection is
 * a hundred lines (see `connection.ts`), and the main process externalises its
 * dependencies — so an SDK here would be a packaged runtime dependency, pinned
 * to a fast-moving version, bought for types we can state exactly once.
 *
 * Every shape below was read off a real adapter, not a specification: see
 * `docs/acp-phase0-findings.md` for the captured traffic it was derived from.
 * Fields the adapters send but Mindex ignores are simply absent.
 */

/** JSON-RPC envelopes. */
export interface RpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: unknown
}
export interface RpcResponse {
  jsonrpc: '2.0'
  id: number
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}
export interface RpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}
export type RpcMessage = RpcRequest | RpcResponse | RpcNotification

/**
 * How an agent says "nobody is signed in".
 *
 * An empty array is the useful case and the reason this is read at all: a
 * signed-in Claude reports `authMethods: []`, which is how Mindex knows the
 * adapter picked up the user's existing `claude login` and no sign-in step is
 * needed. Gemini and Codex list their methods whether or not credentials exist,
 * so a non-empty array is not by itself proof of being signed out.
 */
export interface AuthMethod {
  id: string
  name: string
  description?: string
}

export interface InitializeResult {
  protocolVersion: number
  authMethods?: AuthMethod[]
  agentCapabilities?: Record<string, unknown>
}

/** One selectable value inside a `SessionConfigOption`. */
export interface ConfigOptionValue {
  value: string
  name?: string
  description?: string
}

/**
 * Values may arrive grouped rather than flat.
 *
 * Claude sends a flat list today, but the protocol allows a group — a heading
 * with its own values under it — and a client that only reads `value` would
 * silently show an empty menu for an agent that groups. Anything walking the
 * list has to handle both, which is what `flattenValues` is for.
 */
export interface ConfigOptionGroup {
  name?: string
  options: ConfigOptionValue[]
}

export type ConfigOptionEntry = ConfigOptionValue | ConfigOptionGroup

/** Every selectable value, with grouping flattened away. */
export function flattenValues(entries: ConfigOptionEntry[] | undefined): ConfigOptionValue[] {
  const out: ConfigOptionValue[] = []
  for (const entry of entries ?? []) {
    if ('value' in entry) out.push(entry)
    else out.push(...(entry.options ?? []))
  }
  return out
}

/**
 * A setting the agent advertises: model, thought level, mode, persona.
 *
 * Uniform on purpose — Mindex renders these by `type` without knowing what any
 * particular one means, which is the whole reason a new model or effort rung
 * needs no Mindex release to appear.
 *
 * `category` is the axis to key on, never `id`: Claude calls its thought-level
 * option `effort` and Codex calls its `reasoning_effort`, but both carry
 * `category: 'thought_level'`. `category` is also genuinely optional — Claude's
 * `agent` persona selector has none — and such options still render.
 */
export interface SessionConfigOption {
  id: string
  name?: string
  description?: string
  type: 'select' | 'boolean'
  category?: string
  currentValue?: string | boolean
  options?: ConfigOptionEntry[]
}

/** The legacy mode surface, predating `configOptions`. Gemini has only this. */
export interface SessionModeState {
  currentModeId?: string
  availableModes?: Array<{ id: string; name?: string; description?: string }>
}

export interface NewSessionResult {
  sessionId: string
  /** Present on Claude and Codex; Gemini omits it entirely. */
  configOptions?: SessionConfigOption[]
  /** Present on all three. */
  modes?: SessionModeState
  /** A separate model list, sent by Gemini and Codex but not Claude. */
  models?: unknown
}

/** Why a turn ended. `end_turn` is the ordinary success. */
export type StopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'max_turn_requests'
  | 'refusal'
  | 'cancelled'
  | string

/**
 * The real token accounting, returned by `session/prompt` — not by the
 * `usage_update` notification, which reports context-window fill instead.
 */
export interface PromptUsage {
  inputTokens?: number
  outputTokens?: number
  cachedReadTokens?: number
  cachedWriteTokens?: number
  totalTokens?: number
}

export interface PromptResult {
  stopReason: StopReason
  usage?: PromptUsage
}

/** A text block, as carried by message chunks and tool content. */
export interface TextContent {
  type: 'text'
  text: string
}

/**
 * Tool content, which nests: `{type:'content', content:{type:'text', text}}`.
 * Other shapes (diffs, terminals) exist and are ignored rather than guessed at.
 */
export interface ToolContentBlock {
  type: string
  content?: TextContent | { type: string; text?: string }
}

/** ACP's own lifecycle status for a tool call. */
export type ToolCallStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | string

/**
 * One `session/update` notification body.
 *
 * A discriminated union in spirit, but typed loosely on purpose: adapters ship
 * new `sessionUpdate` kinds on their own schedule, and an unknown kind must be
 * ignorable rather than a parse failure.
 */
export interface SessionUpdate {
  sessionUpdate: string
  /** `agent_message_chunk` / `agent_thought_chunk`. */
  content?: TextContent | ToolContentBlock[] | unknown
  messageId?: string
  /** `tool_call` / `tool_call_update`. */
  toolCallId?: string
  title?: string
  kind?: string
  status?: ToolCallStatus
  rawInput?: Record<string, unknown>
  /** `plan`. */
  entries?: Array<{ content?: string; status?: string; priority?: string }>
  /** `usage_update` — context window fill, not token cost. */
  used?: number
  size?: number
  /** `available_commands_update` — the slash commands this session accepts. */
  availableCommands?: Array<{ name?: string; description?: string }>
  /** `current_mode_update`. */
  currentModeId?: string
  /**
   * Vendor extensions. Claude puts the real tool name here
   * (`_meta.claudeCode.toolName === 'Bash'`) while `title` carries a
   * human-readable label like "Terminal" — so this is the field that keeps
   * `ToolCard`'s existing per-tool rendering working.
   */
  _meta?: Record<string, unknown>
}

export interface SessionUpdateParams {
  sessionId: string
  update: SessionUpdate
}

/** The set of `sessionUpdate` kinds Mindex acts on. Anything else is dropped. */
export const HANDLED_UPDATES = new Set([
  'agent_message_chunk',
  'agent_thought_chunk',
  'tool_call',
  'tool_call_update',
  'plan',
  'usage_update'
])

/** A tool call is done — and only then is a `tool_result` owed. */
export function isTerminalToolStatus(status: ToolCallStatus | undefined): boolean {
  return status === 'completed' || status === 'failed'
}

/** Pull the vendor tool name out of `_meta`, where Claude puts the real one. */
export function toolNameFromMeta(meta: Record<string, unknown> | undefined): string | undefined {
  if (!meta) return undefined
  for (const vendor of Object.values(meta)) {
    if (vendor && typeof vendor === 'object') {
      const name = (vendor as Record<string, unknown>).toolName
      if (typeof name === 'string' && name.length > 0) return name
    }
  }
  return undefined
}

/**
 * `session/request_permission` — the agent asking the client whether it may
 * run a tool call. Both shapes below were read off the wire against live
 * Claude and Gemini adapters (`docs/acp-mcp-wiring-findings.md`), not
 * assembled from memory of the spec — `optionId` values in particular are
 * not standardised between vendors (Claude: `reject`/`allow`/`allow_always`;
 * Gemini: `cancel`/`proceed_once`/`proceed_always_server`/…), so anything
 * that renders these has to key off `kind` and `name`, never a hardcoded id.
 */
export interface PermissionOption {
  optionId: string
  name?: string
  /** `allow_once` | `allow_always` | `reject_once` | `reject_always`, loosely typed for the same reason as `ToolCallStatus`. */
  kind?: string
}

/** The one content shape this file actually reads — everything else in `toolCall.content` is passed through unexamined. */
export interface ToolCallDiffContent {
  type: 'diff'
  path: string
  oldText?: string
  newText: string
}

export interface PermissionToolCall {
  toolCallId: string
  title?: string
  kind?: string
  rawInput?: Record<string, unknown>
  content?: Array<ToolCallDiffContent | { type: string; [key: string]: unknown }>
  locations?: Array<{ path: string }>
}

export interface RequestPermissionParams {
  sessionId: string
  toolCall: PermissionToolCall
  options: PermissionOption[]
}

/** What `session/request_permission` must be answered with, or the adapter's own response validation rejects it (confirmed on Gemini — see the findings doc). */
export type PermissionOutcome = { outcome: 'selected'; optionId: string } | { outcome: 'cancelled' }

export interface RequestPermissionResult {
  outcome: PermissionOutcome
}

/** The one entry in `toolCall.content` shaped like a file edit, if any. */
export function diffContentOf(toolCall: PermissionToolCall): ToolCallDiffContent | undefined {
  return toolCall.content?.find(
    (c): c is ToolCallDiffContent =>
      c.type === 'diff' && typeof (c as ToolCallDiffContent).newText === 'string'
  )
}
