import { listJobs } from '@main/agent-engine'

/**
 * How long after a job finishes its writes are still considered the agent's.
 *
 * The history snapshot lands ~1.6s after the file actually changed (watcher
 * settle + snapshot debounce), so a job that writes a file and exits
 * immediately would otherwise look like an external change.
 */
const RECENTLY_FINISHED_MS = 15_000

/**
 * The engine feature responsible for whatever is happening right now, or
 * `null` if the engine is idle.
 *
 * Only jobs the scheduler knows about count. An agent running in a terminal
 * tab writes files too, but Mindex does not track those sessions, so their
 * writes are honestly reported as external rather than guessed at.
 */
export function activeEngineFeature(now = Date.now()): string | null {
  let recent: string | null = null
  for (const job of listJobs()) {
    if (job.status === 'running') return job.feature
    if (job.finishedAt !== undefined && now - job.finishedAt <= RECENTLY_FINISHED_MS) {
      recent = job.feature
    }
  }
  return recent
}
