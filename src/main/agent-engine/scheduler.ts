import { randomUUID } from 'node:crypto'

export interface ScheduledJob {
  scope: string
  feature: string
  meta?: Record<string, unknown>
  run: (signal: AbortSignal) => Promise<void>
}

export interface SchedulerConfig {
  debounceMs: number
  cooldownMs: number
  maxConcurrent: number
  perFeatureCaps?: Record<string, number>
}

export type SchedulerEvent =
  | { kind: 'enqueued'; jobId: string; scope: string; feature: string; firesAt: number }
  | { kind: 'started'; jobId: string; scope: string; feature: string; startedAt: number }
  | {
      kind: 'finished'
      jobId: string
      scope: string
      feature: string
      durationMs: number
      finishedAt: number
    }
  | { kind: 'failed'; jobId: string; scope: string; feature: string; message: string }
  | { kind: 'cancelled'; jobId: string; scope: string; feature: string }
  | { kind: 'paused' }
  | { kind: 'resumed' }

export interface ActiveJobInfo {
  jobId: string
  scope: string
  feature: string
  startedAt: number
}

export interface PendingJobInfo {
  jobId: string
  scope: string
  feature: string
  firesAt: number
  enqueuedAt: number
}

export interface Scheduler {
  enqueue(
    job: ScheduledJob,
    opts?: { immediate?: boolean; debounceMs?: number; cooldownMs?: number }
  ): string
  cancel(scope: string): void
  cancelJob(jobId: string): void
  pause(): void
  resume(): void
  isPaused(): boolean
  active(): ActiveJobInfo[]
  pending(): PendingJobInfo[]
  config(): SchedulerConfig
  setConfig(patch: Partial<SchedulerConfig>): void
}

interface PendingEntry {
  jobId: string
  job: ScheduledJob
  enqueuedAt: number
  firesAt: number
  timer: NodeJS.Timeout
  immediate: boolean
  cooldownMs?: number
}

interface QueuedEntry {
  jobId: string
  job: ScheduledJob
  enqueuedAt: number
}

interface RunningEntry {
  jobId: string
  scope: string
  feature: string
  startedAt: number
  controller: AbortController
}

export function createScheduler(
  initial: SchedulerConfig,
  onEvent: (e: SchedulerEvent) => void
): Scheduler {
  let cfg: SchedulerConfig = { ...initial }
  const pendingByScope = new Map<string, PendingEntry>()
  const cooldownByScope = new Map<string, number>()
  const queue: QueuedEntry[] = []
  const running = new Map<string, RunningEntry>()
  let paused = false

  function emit(e: SchedulerEvent): void {
    try {
      onEvent(e)
    } catch {}
  }

  function schedulePending(entry: PendingEntry): void {
    pendingByScope.set(entry.job.scope, entry)
    emit({
      kind: 'enqueued',
      jobId: entry.jobId,
      scope: entry.job.scope,
      feature: entry.job.feature,
      firesAt: entry.firesAt
    })
  }

  function fire(scope: string): void {
    const entry = pendingByScope.get(scope)
    if (!entry) return

    if (paused) {
      const delay = Math.max(0, entry.firesAt - Date.now())
      entry.timer = setTimeout(() => fire(scope), delay)
      pendingByScope.set(scope, entry)
      return
    }

    if (!entry.immediate) {
      const last = cooldownByScope.get(scope) ?? 0
      const earliest = last + (entry.cooldownMs ?? cfg.cooldownMs)
      if (Date.now() < earliest) {
        entry.firesAt = earliest
        entry.timer = setTimeout(() => fire(scope), earliest - Date.now())
        pendingByScope.set(scope, entry)
        return
      }
    }

    pendingByScope.delete(scope)
    queue.push({ jobId: entry.jobId, job: entry.job, enqueuedAt: entry.enqueuedAt })
    drain()
  }

  function featureBusy(feature: string): number {
    let n = 0
    for (const r of running.values()) {
      if (r.feature === feature) n += 1
    }
    return n
  }

  function drain(): void {
    if (paused) return
    let i = 0
    while (running.size < cfg.maxConcurrent && i < queue.length) {
      const candidate = queue[i]
      if (!candidate) break
      const scopeBusy = [...running.values()].some((r) => r.scope === candidate.job.scope)
      const cap = cfg.perFeatureCaps?.[candidate.job.feature]
      const featureFull = typeof cap === 'number' && featureBusy(candidate.job.feature) >= cap
      if (scopeBusy || featureFull) {
        i += 1
        continue
      }
      queue.splice(i, 1)
      startJob(candidate)
    }
  }

  function startJob(entry: QueuedEntry): void {
    const controller = new AbortController()
    const startedAt = Date.now()
    const info: RunningEntry = {
      jobId: entry.jobId,
      scope: entry.job.scope,
      feature: entry.job.feature,
      startedAt,
      controller
    }
    running.set(entry.jobId, info)
    emit({
      kind: 'started',
      jobId: entry.jobId,
      scope: entry.job.scope,
      feature: entry.job.feature,
      startedAt
    })

    Promise.resolve()
      .then(() => entry.job.run(controller.signal))
      .then(() => {
        if (controller.signal.aborted) {
          emit({
            kind: 'cancelled',
            jobId: entry.jobId,
            scope: entry.job.scope,
            feature: entry.job.feature
          })
        } else {
          emit({
            kind: 'finished',
            jobId: entry.jobId,
            scope: entry.job.scope,
            feature: entry.job.feature,
            durationMs: Date.now() - startedAt,
            finishedAt: Date.now()
          })
        }
      })
      .catch((err: unknown) => {
        emit({
          kind: 'failed',
          jobId: entry.jobId,
          scope: entry.job.scope,
          feature: entry.job.feature,
          message: err instanceof Error ? err.message : String(err)
        })
      })
      .finally(() => {
        running.delete(entry.jobId)
        cooldownByScope.set(entry.job.scope, Date.now())
        drain()
      })
  }

  return {
    enqueue(job, opts) {
      const immediate = opts?.immediate === true
      const existing = pendingByScope.get(job.scope)
      if (existing) clearTimeout(existing.timer)

      const jobId = randomUUID()
      const enqueuedAt = Date.now()
      const delay = immediate ? 0 : (opts?.debounceMs ?? cfg.debounceMs)
      const firesAt = enqueuedAt + delay
      const timer = setTimeout(() => fire(job.scope), delay)
      schedulePending({
        jobId,
        job,
        enqueuedAt,
        firesAt,
        timer,
        immediate,
        cooldownMs: opts?.cooldownMs
      })
      if (immediate) cooldownByScope.delete(job.scope)
      return jobId
    },
    cancel(scope) {
      const entry = pendingByScope.get(scope)
      if (entry) {
        clearTimeout(entry.timer)
        pendingByScope.delete(scope)
        emit({
          kind: 'cancelled',
          jobId: entry.jobId,
          scope: entry.job.scope,
          feature: entry.job.feature
        })
      }
      for (let i = queue.length - 1; i >= 0; i--) {
        if (queue[i]?.job.scope === scope) {
          const dropped = queue.splice(i, 1)[0]
          if (dropped) {
            emit({
              kind: 'cancelled',
              jobId: dropped.jobId,
              scope: dropped.job.scope,
              feature: dropped.job.feature
            })
          }
        }
      }
      for (const r of running.values()) {
        if (r.scope === scope) r.controller.abort()
      }
    },
    cancelJob(jobId) {
      for (const [scope, entry] of pendingByScope.entries()) {
        if (entry.jobId === jobId) {
          clearTimeout(entry.timer)
          pendingByScope.delete(scope)
          emit({
            kind: 'cancelled',
            jobId,
            scope: entry.job.scope,
            feature: entry.job.feature
          })
          return
        }
      }
      for (let i = 0; i < queue.length; i++) {
        const q = queue[i]
        if (q && q.jobId === jobId) {
          queue.splice(i, 1)
          emit({
            kind: 'cancelled',
            jobId,
            scope: q.job.scope,
            feature: q.job.feature
          })
          return
        }
      }
      const r = running.get(jobId)
      if (r) r.controller.abort()
    },
    pause() {
      if (paused) return
      paused = true
      emit({ kind: 'paused' })
    },
    resume() {
      if (!paused) return
      paused = false
      emit({ kind: 'resumed' })
      drain()
      const now = Date.now()
      for (const entry of [...pendingByScope.values()]) {
        if (entry.firesAt <= now) {
          clearTimeout(entry.timer)
          pendingByScope.delete(entry.job.scope)
          const timer = setTimeout(() => fire(entry.job.scope), 0)
          schedulePending({ ...entry, firesAt: now, timer })
        }
      }
    },
    isPaused() {
      return paused
    },
    active() {
      return [...running.values()].map((r) => ({
        jobId: r.jobId,
        scope: r.scope,
        feature: r.feature,
        startedAt: r.startedAt
      }))
    },
    pending() {
      return [...pendingByScope.values()].map((e) => ({
        jobId: e.jobId,
        scope: e.job.scope,
        feature: e.job.feature,
        firesAt: e.firesAt,
        enqueuedAt: e.enqueuedAt
      }))
    },
    config() {
      return { ...cfg }
    },
    setConfig(patch) {
      cfg = { ...cfg, ...patch }
    }
  }
}
