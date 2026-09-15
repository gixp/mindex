import type { StreamEvent } from '@main/providers/stream-parser'
import {
  isTerminalToolStatus,
  toolNameFromMeta,
  type SessionUpdate,
  type ToolCallStatus
} from './protocol'

/**
 * ACP `session/update` notifications → Mindex's existing `StreamEvent`.
 *
 * Translating into the union Mindex already has, rather than inventing a new
 * one, is what keeps this change small: `chat/runner.ts`, `chat/store.ts`, the
 * six chat IPC channels and the whole renderer stay exactly as they are, and
 * only what feeds the seam changes.
 *
 * Two things about the real traffic make this stateful rather than a pure
 * function — both observed, not assumed (see `docs/acp-phase0-findings.md`):
 *
 *  1. **A tool call arrives before its arguments.** The opening `tool_call`
 *     carries `rawInput: {}` and a generic title ("Terminal"); the command
 *     itself shows up in a later `tool_call_update`. Emitting on the first
 *     notification would render a tool card with nothing in it, so the call is
 *     held until there is something to show.
 *  2. **The real tool name hides in `_meta`.** `title` is human-readable
 *     ("Terminal"), while `_meta.claudeCode.toolName` is `Bash` — and `Bash` is
 *     what `ToolCard.tsx` already knows how to render. Taking the title would
 *     silently break every per-tool icon and summary in the UI.
 */

/** Matches the truncation the stdout parsers have always applied. */
const PREVIEW_LIMIT = 200

interface PendingToolCall {
  name: string
  input: Record<string, unknown>
  /** Whether `tool_use` has gone out yet — it may not, if input never arrives. */
  emitted: boolean
}

export interface Translator {
  /** Feed one `session/update` body. Emits zero or more `StreamEvent`s. */
  handle(update: SessionUpdate): void
  /**
   * The turn ended: flush anything still open.
   *
   * A tool call that never reached a terminal status would otherwise leave its
   * card spinning forever in the transcript.
   */
  endTurn(): void
  /** Latest context-window fill, if the agent reported one. */
  contextUsed(): { used: number; size: number } | undefined
}

export function makeTranslator(emit: (e: StreamEvent) => void): Translator {
  const tools = new Map<string, PendingToolCall>()
  let context: { used: number; size: number } | undefined

  /** Send `tool_use` for a call we have been holding, once it is worth showing. */
  function flushToolUse(id: string, call: PendingToolCall): void {
    if (call.emitted) return
    call.emitted = true
    emit({ kind: 'tool_use', name: call.name, input: call.input, id })
  }

  function onToolCall(u: SessionUpdate): void {
    const id = u.toolCallId
    if (!id) return

    const existing = tools.get(id)
    const name = toolNameFromMeta(u._meta) ?? existing?.name ?? u.title ?? u.kind ?? 'tool'
    const input = { ...(existing?.input ?? {}), ...(u.rawInput ?? {}) }
    const call: PendingToolCall = { name, input, emitted: existing?.emitted ?? false }
    tools.set(id, call)

    const terminal = isTerminalToolStatus(u.status)
    // Hold until there is an argument to show — or until the call is over, at
    // which point an empty card still beats a result with no call above it.
    if (Object.keys(input).length > 0 || terminal) flushToolUse(id, call)

    if (terminal) {
      emit({
        kind: 'tool_result',
        toolUseId: id,
        isError: u.status === 'failed',
        preview: previewOf(u.content)
      })
      tools.delete(id)
    }
  }

  return {
    handle(u: SessionUpdate): void {
      switch (u.sessionUpdate) {
        case 'agent_message_chunk': {
          const text = textOf(u.content)
          if (text) emit({ kind: 'assistant_text', text })
          return
        }
        case 'tool_call':
        case 'tool_call_update':
          onToolCall(u)
          return
        case 'usage_update': {
          // Context-window fill, NOT token cost — the cost arrives in the
          // `session/prompt` response instead. Recorded rather than emitted:
          // `StreamEvent`'s `usage` means something else and must not be
          // filled with a number measured on a different axis.
          if (typeof u.used === 'number' && typeof u.size === 'number') {
            context = { used: u.used, size: u.size }
          }
          return
        }
        // `agent_thought_chunk` and `plan` have no home in the current union.
        // They are dropped here and given real events in phase 3 rather than
        // being flattened into assistant text, which would put the model's
        // reasoning into the answer.
        default:
          return
      }
    },

    endTurn(): void {
      for (const [id, call] of tools) {
        flushToolUse(id, call)
        emit({ kind: 'tool_result', toolUseId: id, isError: false, preview: undefined })
      }
      tools.clear()
    },

    contextUsed(): { used: number; size: number } | undefined {
      return context
    }
  }
}

/** Text out of a message chunk: `{type:'text', text}`. */
function textOf(content: unknown): string | undefined {
  if (!content || typeof content !== 'object') return undefined
  const c = content as Record<string, unknown>
  if (typeof c.text === 'string' && c.text.length > 0) return c.text
  return undefined
}

/**
 * A short preview out of tool content, which nests one level:
 * `[{type:'content', content:{type:'text', text}}]`.
 */
function previewOf(content: unknown): string | undefined {
  if (typeof content === 'string') return content.slice(0, PREVIEW_LIMIT)
  if (!Array.isArray(content)) return undefined
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const b = block as Record<string, unknown>
    if (typeof b.text === 'string' && b.text.length > 0) {
      return b.text.slice(0, PREVIEW_LIMIT)
    }
    const inner = b.content
    if (inner && typeof inner === 'object') {
      const t = (inner as Record<string, unknown>).text
      if (typeof t === 'string' && t.length > 0) return t.slice(0, PREVIEW_LIMIT)
    }
  }
  return undefined
}

/** Exported for tests: the status values that close a tool call. */
export function isTerminal(status: ToolCallStatus | undefined): boolean {
  return isTerminalToolStatus(status)
}
