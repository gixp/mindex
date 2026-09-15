import path from 'node:path'
import type { HistoryAuthor } from '@shared/types'

/**
 * How long a "the user just wrote this" mark stays valid.
 *
 * It has to outlive the whole path from the write to the history snapshot:
 * the watcher waits for the file to settle (`awaitWriteFinish`, 80ms) and the
 * history feature debounces another 1.5s on top. Ten seconds leaves plenty of
 * room for a slow disk without being long enough for a later, unrelated change
 * to the same file to inherit the mark.
 */
export const USER_WRITE_WINDOW_MS = 10_000

/**
 * Attribution deliberately does not try to name *which* agent wrote a file.
 * Agents write with their own process, using their own tools — Mindex never
 * sees those writes, it only sees the watcher event afterwards. All it can
 * honestly say is whether one of its own engine jobs was running at the time.
 */
const recentUserWrites = new Map<string, number>()

/**
 * The parallel of `recentUserWrites` for Mindex's own AI features that write
 * through IPC rather than by spawning an agent that writes for itself.
 *
 * Applying a reviewed AI proposal is a real write from this process — it does
 * not go through `runAgentJob`, so `activeEngineFeature()` is null by the time
 * the history snapshot lands, and without a mark it would be filed `external`
 * (some other editor) instead of `agent`. The mark also carries which feature
 * did it, so the history entry can say "Knowledge linter" rather than a bare
 * "Agent".
 */
const recentAgentWrites = new Map<string, { ts: number; detail?: string }>()

const MAX_TRACKED = 100

/**
 * The two sides of this map come from different places — the mark from a path
 * the renderer sent over IPC, the lookup from whatever string chokidar
 * reported — so they are normalised before being compared. A mismatch here
 * would not throw; it would quietly file every one of the user's own edits as
 * an external change, which is exactly the wrong answer.
 */
function key(absPath: string): string {
  return path.resolve(absPath)
}

export function markUserWrite(absPath: string, now = Date.now()): void {
  recentUserWrites.set(key(absPath), now)
  if (recentUserWrites.size > MAX_TRACKED) {
    const cutoff = now - USER_WRITE_WINDOW_MS
    for (const [k, ts] of recentUserWrites) {
      if (ts < cutoff) recentUserWrites.delete(k)
    }
  }
}

function wasUserWrite(absPath: string, now: number): boolean {
  const k = key(absPath)
  const ts = recentUserWrites.get(k)
  if (ts === undefined) return false
  if (now - ts > USER_WRITE_WINDOW_MS) {
    recentUserWrites.delete(k)
    return false
  }
  return true
}

export function markAgentWrite(absPath: string, detail?: string, now = Date.now()): void {
  recentAgentWrites.set(key(absPath), { ts: now, detail })
  if (recentAgentWrites.size > MAX_TRACKED) {
    const cutoff = now - USER_WRITE_WINDOW_MS
    for (const [k, v] of recentAgentWrites) {
      if (v.ts < cutoff) recentAgentWrites.delete(k)
    }
  }
}

function agentWriteEntry(
  absPath: string,
  now: number
): { ts: number; detail?: string } | undefined {
  const k = key(absPath)
  const entry = recentAgentWrites.get(k)
  if (!entry) return undefined
  if (now - entry.ts > USER_WRITE_WINDOW_MS) {
    recentAgentWrites.delete(k)
    return undefined
  }
  return entry
}

/** The feature label recorded with a recent AI-proposal write, if any. */
export function agentWriteDetail(absPath: string, now = Date.now()): string | undefined {
  return agentWriteEntry(absPath, now)?.detail
}

/**
 * `agentActive` is passed in rather than looked up here so this module stays
 * free of the engine's import graph (which reaches Electron) and can be tested
 * on its own.
 *
 * A user mark wins over a running job on purpose: the user typing in the
 * editor while a background folder-context job happens to be running is the
 * common case, and calling that edit the agent's would be plainly wrong.
 */
export function resolveAuthor(
  absPath: string,
  agentActive: boolean,
  now = Date.now()
): HistoryAuthor {
  if (wasUserWrite(absPath, now)) return 'user'
  if (agentWriteEntry(absPath, now)) return 'agent'
  return agentActive ? 'agent' : 'external'
}

/** Test seam — drops all marks. */
export function resetAttribution(): void {
  recentUserWrites.clear()
  recentAgentWrites.clear()
}
