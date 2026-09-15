import { handle } from '@main/ipc/handle'
import { IPC } from '@shared/ipc-channels'
import { safe } from '@main/util/result'
import type { SyncMode, SyncStatus } from '@shared/types'
import { getSyncStatus, setSyncMode, syncNow } from '@main/git/autosync'

export function registerSyncHandlers(): void {
  handle(IPC.sync.status, () => safe<SyncStatus>(async () => getSyncStatus()))

  handle(IPC.sync.setMode, (_e, mode: SyncMode) => safe<SyncStatus>(() => setSyncMode(mode)))

  handle(IPC.sync.now, () => safe<SyncStatus>(() => syncNow()))
}
