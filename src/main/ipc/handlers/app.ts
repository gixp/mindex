import { handle } from '@main/ipc/handle'
import { app, BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc-channels'
import { safe } from '@main/util/result'

export function registerAppHandlers(): void {
  handle(IPC.app.getVersion, () => safe(async () => app.getVersion()))

  handle(IPC.app.setZoom, (_e, percent: number) =>
    safe<number>(async () => {
      const { setZoomPercent } = await import('@main/menu')
      return await setZoomPercent(percent)
    })
  )

  handle(IPC.app.relaunch, () =>
    safe<void>(async () => {
      const { closeAllTerminals } = await import('@main/terminal/pty')
      closeAllTerminals()
      if (app.isPackaged) {
        app.relaunch()
        app.exit(0)
      } else {
        const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
        win?.webContents.reload()
      }
    })
  )
}
