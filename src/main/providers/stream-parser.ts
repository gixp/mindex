/**
 * The normalised event shape ACP translates into (see main/acp/translate.ts).
 *
 * Kept here rather than moved into main/acp/ purely for history: this was the
 * shape the old CLI-stdout parsers emitted, and it turned out to be exactly
 * the right seam for ACP too — everything downstream (chat/runner.ts,
 * chat/store.ts, the six chat IPC channels, the renderer) reads this union and
 * has never needed to know which transport produced it.
 */
export type StreamEvent =
  | { kind: 'system'; subtype: string; data: Record<string, unknown> }
  | { kind: 'assistant_text'; text: string }
  | { kind: 'tool_use'; name: string; input: unknown; id: string }
  | { kind: 'tool_result'; toolUseId: string; isError: boolean; preview?: string }
  | { kind: 'usage'; inputTokens: number; outputTokens: number; cacheRead?: number }
  | { kind: 'error'; message: string }
  | { kind: 'final_text'; text: string }
