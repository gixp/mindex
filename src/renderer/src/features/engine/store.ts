import { create } from 'zustand'
import type { EngineLogEntry, JobInfo } from '@shared/types'
import { api } from '@/platform/api'
import { showError } from '@/platform/notifications'

const LOG_CAP = 500

interface JobsState {
  jobs: Record<string, JobInfo>
  log: EngineLogEntry[]
  paused: boolean
  activeCount: number
  pendingCount: number
  initialized: boolean

  init(): Promise<() => void>
  pause(): Promise<void>
  resume(): Promise<void>
  cancel(jobId: string): Promise<void>
  clearLog(): Promise<void>
}

function recountStatuses(jobs: Record<string, JobInfo>): {
  activeCount: number
  pendingCount: number
} {
  let activeCount = 0
  let pendingCount = 0
  for (const j of Object.values(jobs)) {
    if (j.status === 'running') activeCount += 1
    else if (j.status === 'pending') pendingCount += 1
  }
  return { activeCount, pendingCount }
}

export const useJobsStore = create<JobsState>((set, get) => ({
  jobs: {},
  log: [],
  paused: false,
  activeCount: 0,
  pendingCount: 0,
  initialized: false,

  async init() {
    if (get().initialized) return () => undefined
    set({ initialized: true })
    const a = api()
    const [jobsR, logR, statusR] = await Promise.all([
      a.engine.listJobs(),
      a.engine.getLog(),
      a.engine.getStatus()
    ])
    const jobs: Record<string, JobInfo> = {}
    if (jobsR.ok && jobsR.data) for (const j of jobsR.data) jobs[j.id] = j
    const counts = recountStatuses(jobs)
    set({
      jobs,
      log: logR.ok && logR.data ? logR.data.slice(-LOG_CAP) : [],
      paused: statusR.ok && statusR.data ? statusR.data.paused : false,
      activeCount: statusR.ok && statusR.data ? statusR.data.activeCount : counts.activeCount,
      pendingCount: statusR.ok && statusR.data ? statusR.data.pendingCount : counts.pendingCount
    })

    const offJob = a.on.jobUpdate((info) => {
      set((state) => {
        const prev = state.jobs[info.id]
        const next = { ...state.jobs, [info.id]: info }
        const counts = recountStatuses(next)
        const justFailed =
          info.status === 'failed' && prev?.status !== 'failed' && info.errorMessage
        if (justFailed && shouldSurfaceJobError(info.feature)) {
          surfaceClaudeError(info.feature, info.errorMessage!)
        }
        return { jobs: next, ...counts }
      })
    })
    const offLog = a.on.engineLog((entry) => {
      set((state) => {
        const log = [...state.log, entry]
        if (log.length > LOG_CAP) log.splice(0, log.length - LOG_CAP)
        return { log }
      })
    })
    const offPaused = a.on.enginePaused((paused) => {
      set({ paused })
    })

    return () => {
      offJob()
      offLog()
      offPaused()
    }
  },

  async pause() {
    await api().engine.pause()
  },
  async resume() {
    await api().engine.resume()
  },
  async cancel(jobId: string) {
    await api().engine.cancel(jobId)
  },
  async clearLog() {
    await api().engine.clearLog()
    set({ log: [] })
  }
}))

const USER_INITIATED_FEATURES = new Set(['chat'])

function shouldSurfaceJobError(feature: string): boolean {
  return USER_INITIATED_FEATURES.has(feature)
}

function surfaceClaudeError(feature: string, message: string): void {
  // Used to import the settings store dynamically, purely to dodge a cycle
  // that no longer exists: reporting an outcome is its own concern now and
  // lives in a module that imports nothing.
  showError(titleFor(feature, message), message)
}

function titleFor(feature: string, message: string): string {
  const firstLine =
    message
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean) ?? ''
  const headline = firstLine.length > 140 ? firstLine.slice(0, 137) + '…' : firstLine
  if (headline) return headline
  return feature === 'chat' ? 'Chat failed' : 'Claude job failed'
}
