import type { EngineLogEntry, JobInfo, JobStatus } from '@shared/types'
import { createScheduler, type SchedulerEvent, type Scheduler } from './scheduler'

export {
  runAgentJob,
  type AgentJobOptions,
  type AgentJobResult,
  type AgentJobErrorReason,
  type JobPermissionMode
} from './engine'
export type { StreamEvent } from '@main/providers/stream-parser'
export { DEFAULT_ENGINE_TIMEOUT_MS, isCliMissing } from './spawn'
export type { Scheduler, SchedulerEvent, SchedulerConfig, ScheduledJob } from './scheduler'

const DEFAULT_CONFIG = {
  debounceMs: 30_000,
  cooldownMs: 60_000,
  maxConcurrent: 6,
  perFeatureCaps: {
    'folder-context': 4,
    'living-index': 1,
    chat: 3
  }
}

const LOG_CAP = 500

interface JobRecord extends JobInfo {
  __ts: number
}

const jobs = new Map<string, JobRecord>()
const log: EngineLogEntry[] = []
const listeners = new Set<EngineListener>()

/**
 * Repeated "CLI missing or signed out" failures, counted per provider.
 *
 * One counter for all three meant a provider you never chose could stop the
 * one you did: three failures from a signed-out Gemini paused the whole queue,
 * including Claude's folder-context work, and the status bar simply said the
 * engine was paused. Whoever is broken should be the only one stopped.
 */
const consecutiveAuthOrMissing: Record<string, number> = {}
const pausedProviders = new Set<string>()
const AUTH_AUTO_PAUSE_THRESHOLD = 3

export type EngineListener =
  | { kind: 'job'; cb: (info: JobInfo) => void }
  | { kind: 'log'; cb: (entry: EngineLogEntry) => void }
  | { kind: 'paused'; cb: (paused: boolean) => void }

function fanout<E extends EngineListener['kind']>(
  kind: E,
  payload: Parameters<Extract<EngineListener, { kind: E }>['cb']>[0]
): void {
  for (const l of listeners) {
    if (l.kind !== kind) continue
    try {
      ;(l.cb as (p: unknown) => void)(payload as unknown)
    } catch {}
  }
}

function appendLog(entry: EngineLogEntry): void {
  log.push(entry)
  if (log.length > LOG_CAP) log.shift()
  fanout('log', entry)
}

function updateJob(info: JobInfo): void {
  jobs.set(info.id, { ...info, __ts: Date.now() })
  fanout('job', info)
  if (jobs.size > 200) {
    const terminal = [...jobs.values()]
      .filter((j) => j.status !== 'pending' && j.status !== 'running')
      .sort((a, b) => a.__ts - b.__ts)
    const drop = terminal.slice(0, terminal.length - 100)
    for (const d of drop) jobs.delete(d.id)
  }
}

function recordSchedulerEvent(e: SchedulerEvent): void {
  if (e.kind === 'paused' || e.kind === 'resumed') {
    fanout('paused', e.kind === 'paused')
    appendLog({
      ts: Date.now(),
      level: 'info',
      message: e.kind === 'paused' ? 'Engine paused' : 'Engine resumed'
    })
    return
  }

  const base = { ts: Date.now() }
  switch (e.kind) {
    case 'enqueued': {
      updateJob({
        id: e.jobId,
        feature: e.feature,
        scope: e.scope,
        status: 'pending',
        enqueuedAt: Date.now(),
        firesAt: e.firesAt
      })
      return
    }
    case 'started': {
      const prev = jobs.get(e.jobId)
      updateJob({
        ...(prev ?? {
          id: e.jobId,
          feature: e.feature,
          scope: e.scope,
          enqueuedAt: e.startedAt
        }),
        id: e.jobId,
        feature: e.feature,
        scope: e.scope,
        status: 'running',
        startedAt: e.startedAt
      })
      appendLog({
        ...base,
        level: 'info',
        jobId: e.jobId,
        feature: e.feature,
        scope: e.scope,
        message: 'started'
      })
      return
    }
    case 'finished': {
      const prev = jobs.get(e.jobId)
      updateJob({
        ...(prev ?? {
          id: e.jobId,
          feature: e.feature,
          scope: e.scope,
          enqueuedAt: e.finishedAt
        }),
        status: 'success',
        finishedAt: e.finishedAt
      })
      appendLog({
        ...base,
        level: 'info',
        jobId: e.jobId,
        feature: e.feature,
        scope: e.scope,
        message: `finished in ${e.durationMs}ms`
      })
      // A job that finished proves at least one CLI is healthy, but not which
      // one — the record carries the feature, not the provider. The runners
      // clear their own provider's counter on success, so nothing is cleared
      // here rather than clearing all three on another provider's behalf.
      return
    }
    case 'failed': {
      const prev = jobs.get(e.jobId)
      updateJob({
        ...(prev ?? {
          id: e.jobId,
          feature: e.feature,
          scope: e.scope,
          enqueuedAt: Date.now()
        }),
        status: 'failed',
        finishedAt: Date.now(),
        errorMessage: e.message
      })
      appendLog({
        ...base,
        level: 'error',
        jobId: e.jobId,
        feature: e.feature,
        scope: e.scope,
        message: e.message
      })
      return
    }
    case 'cancelled': {
      const prev = jobs.get(e.jobId)
      updateJob({
        ...(prev ?? {
          id: e.jobId,
          feature: e.feature,
          scope: e.scope,
          enqueuedAt: Date.now()
        }),
        status: 'cancelled',
        finishedAt: Date.now()
      })
      appendLog({
        ...base,
        level: 'warn',
        jobId: e.jobId,
        feature: e.feature,
        scope: e.scope,
        message: 'cancelled'
      })
      return
    }
  }
}

export const engineScheduler: Scheduler = createScheduler(DEFAULT_CONFIG, recordSchedulerEvent)

export function listJobs(): JobInfo[] {
  return [...jobs.values()]
    .map(({ __ts: _t, ...rest }) => rest)
    .sort((a, b) => (b.startedAt ?? b.enqueuedAt) - (a.startedAt ?? a.enqueuedAt))
}

export function getJob(jobId: string): JobInfo | undefined {
  const j = jobs.get(jobId)
  if (!j) return undefined
  const { __ts: _t, ...rest } = j
  return rest
}

export function getLogEntries(limit?: number): EngineLogEntry[] {
  if (limit && limit > 0) return log.slice(-limit)
  return [...log]
}

export function clearLogEntries(): void {
  log.length = 0
}

export function getEngineStatus(): {
  paused: boolean
  activeCount: number
  pendingCount: number
} {
  return {
    paused: engineScheduler.isPaused(),
    activeCount: engineScheduler.active().length,
    pendingCount: engineScheduler.pending().length
  }
}

export function setStatusForJob(jobId: string, status: JobStatus, message?: string): void {
  const prev = jobs.get(jobId)
  if (!prev) return
  updateJob({ ...prev, status, errorMessage: message ?? prev.errorMessage })
}

export function logEngine(
  level: EngineLogEntry['level'],
  message: string,
  ctx?: { jobId?: string; feature?: string; scope?: string }
): void {
  appendLog({
    ts: Date.now(),
    level,
    message,
    jobId: ctx?.jobId,
    feature: ctx?.feature,
    scope: ctx?.scope
  })
}

export function noteAuthOrMissingFailure(provider = 'claude'): void {
  const next = (consecutiveAuthOrMissing[provider] ?? 0) + 1
  consecutiveAuthOrMissing[provider] = next
  if (next < AUTH_AUTO_PAUSE_THRESHOLD || pausedProviders.has(provider)) return

  pausedProviders.add(provider)
  appendLog({
    ts: Date.now(),
    level: 'error',
    message: `Auto-paused ${provider} after repeated failures — it is not installed, or not signed in. Other engines keep running. Resume from the status bar after fixing it.`
  })
  // The scheduler itself is only stopped when every provider is out; otherwise
  // a broken one would take the working ones down with it, which is the whole
  // reason this is counted per provider.
  fanout('paused', true)
}

export function resetAuthOrMissingCounter(provider = 'claude'): void {
  consecutiveAuthOrMissing[provider] = 0
  if (pausedProviders.delete(provider) && pausedProviders.size === 0) {
    fanout('paused', false)
  }
}

/** Providers currently held back by repeated failures. */
export function pausedProviderIds(): string[] {
  return [...pausedProviders]
}

/** Should this provider's jobs run? */
export function isProviderPaused(provider: string): boolean {
  return pausedProviders.has(provider)
}

export function addEngineListener(l: EngineListener): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}
