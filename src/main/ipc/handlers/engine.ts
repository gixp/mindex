import { handle } from '@main/ipc/handle'
import { IPC } from '@shared/ipc-channels'
import { safe } from '@main/util/result'
import {
  engineScheduler,
  clearLogEntries,
  getEngineStatus,
  getLogEntries,
  listJobs as listClaudeJobs
} from '@main/agent-engine'

export function registerEngineHandlers(): void {
  handle(IPC.engine.listJobs, () => safe(async () => listClaudeJobs()))

  handle(IPC.engine.cancel, (_e, jobId: string) =>
    safe<void>(async () => {
      engineScheduler.cancelJob(jobId)
    })
  )

  handle(IPC.engine.pause, () =>
    safe<void>(async () => {
      engineScheduler.pause()
    })
  )

  handle(IPC.engine.resume, () =>
    safe<void>(async () => {
      engineScheduler.resume()
    })
  )

  handle(IPC.engine.getStatus, () => safe(async () => getEngineStatus()))

  handle(IPC.engine.getLog, (_e, limit?: number) => safe(async () => getLogEntries(limit)))

  handle(IPC.engine.clearLog, () =>
    safe<void>(async () => {
      clearLogEntries()
    })
  )
}
