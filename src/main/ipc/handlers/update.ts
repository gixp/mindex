import { handle } from '@main/ipc/handle'
import { IPC } from '@shared/ipc-channels'
import { safe } from '@main/util/result'
import {
  checkForUpdate,
  getUpdateStatus,
  installNow,
  openDownloadPage,
  startUpdate
} from '@main/updater'

export function registerUpdateHandlers(): void {
  handle(IPC.update.getStatus, () => safe(async () => getUpdateStatus()))

  handle(IPC.update.check, () =>
    safe(async () => {
      await checkForUpdate()
    })
  )

  handle(IPC.update.installNow, () =>
    safe(async () => {
      installNow()
    })
  )

  handle(IPC.update.start, () =>
    safe(async () => {
      await startUpdate()
    })
  )

  handle(IPC.update.openDownload, () =>
    safe(async () => {
      await openDownloadPage()
    })
  )
}
