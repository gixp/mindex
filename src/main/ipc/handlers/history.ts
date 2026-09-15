import { handle } from '@main/ipc/handle'
import { IPC } from '@shared/ipc-channels'
import { safe } from '@main/util/result'
import { listHistory, readHistoryVersion, restoreHistoryVersion } from '@main/history/api'
import { markUserWrite } from '@main/history/attribution'
import type { HistoryVersion } from '@shared/types'

export function registerHistoryHandlers(): void {
  handle(IPC.history.list, (_e, absPath: string) =>
    safe<HistoryVersion[]>(async () => await listHistory(absPath))
  )

  handle(IPC.history.read, (_e, absPath: string, versionId: string) =>
    safe<string>(async () => await readHistoryVersion(absPath, versionId))
  )

  handle(IPC.history.restore, (_e, absPath: string, versionId: string) =>
    safe<void>(async () => {
      // A restore is the user's edit too — otherwise the version it creates
      // would be filed as an external change to their own note.
      markUserWrite(absPath)
      await restoreHistoryVersion(absPath, versionId)
    })
  )
}
