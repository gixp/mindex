import { type StreamEvent } from '@main/providers/stream-parser'
import { runAcpJob } from '@main/acp/job'
import type { AgentPermissionMode, ProviderId } from '@main/providers/types'
import type { McpServerSpec } from '@main/mcp/protocol'

/**
 * What a job may ask for, which is the provider vocabulary plus one legacy
 * value. `bypassPermissions` was Claude's name for "no prompts at all"; it is
 * mapped to `auto` below rather than kept as a fourth concept, so the registry
 * has one vocabulary to map per CLI instead of two.
 */
export type JobPermissionMode = AgentPermissionMode | 'bypassPermissions'

export interface AgentJobOptions {
  /** Which CLI answers. Defaults to Claude so existing callers are unchanged. */
  provider?: ProviderId
  cwd: string
  prompt: string
  model?: string
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  /**
   * Absolute paths handed over with this turn.
   *
   * Sent as link blocks where the transport has them, so a file is a file
   * rather than a line of text that looks like a path. Empty for every job
   * that is not a conversation.
   */
  attachments?: string[]
  allowedTools?: string[]
  /**
   * Tool names the assistant should not use.
   *
   * Read by the ACP path, where an adapter accepts them on `session/new`. It
   * was declared and read by nobody for a long time; what made it real is the
   * scope having something to enforce beyond Mindex's own tools.
   */
  disallowedTools?: string[]
  outputFormat?: 'text' | 'stream-json'
  timeoutMs?: number
  signal?: AbortSignal
  onEvent?: (e: StreamEvent) => void
  permissionMode?: JobPermissionMode
  appendSystemPrompt?: string
  /**
   * An inline `mcpServers` JSON document to attach for this run.
   *
   * Only reaches the raw interactive terminal tab (`interactiveArgs`), whose
   * CLI takes it as a one-shot argv flag — the ACP path takes `mcpServers`
   * below instead, since `session/new` wants the server as data, not as a
   * string to re-parse.
   */
  mcpConfig?: string
  /**
   * MCP servers to attach to this ACP session, verbatim as `session/new`
   * wants them — one object per server, built once by `mcpServerSpec()` and
   * reused across whichever provider the job targets.
   */
  mcpServers?: McpServerSpec[]
  /**
   * A one-line description of the connection about to be opened.
   *
   * Not a debug flag left in by accident: "the agent took 16 seconds" is only
   * answerable if you can see what was actually started, and reconstructing
   * it by reading code is how you end up measuring the wrong thing.
   */
  onSpawn?: (bin: string, args: string[]) => void
}

export type AgentJobErrorReason =
  | 'timeout'
  | 'aborted'
  | 'cli_missing'
  | 'auth'
  | 'nonzero'
  | 'crash'

export interface AgentJobResult {
  ok: boolean
  exitCode: number | null
  stdout: string
  finalText?: string
  errorReason?: AgentJobErrorReason
  errorMessage?: string
  durationMs: number
  /**
   * Milliseconds until the agent's first byte of output.
   *
   * The one split that matters when a turn feels slow: everything before it is
   * the agent starting up (adapter handshake, config, MCP), everything after
   * is the model answering. A single total cannot tell those apart, and they
   * have completely different fixes.
   */
  firstByteMs?: number
  usage?: { inputTokens: number; outputTokens: number }
}

/** Run one job over ACP. The only transport Mindex speaks. */
export async function runAgentJob(opts: AgentJobOptions): Promise<AgentJobResult> {
  return runAcpJob(opts)
}
