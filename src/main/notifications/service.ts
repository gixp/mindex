import { Notification, app, type BrowserWindow } from 'electron'

let enabled = true
let mainWindowRef: BrowserWindow | null = null

export function bindNotificationWindow(win: BrowserWindow): void {
  mainWindowRef = win
}

export function setNotificationsEnabled(value: boolean): void {
  enabled = value
}

interface NotifyOpts {
  title: string
  body: string
}

function focusApp(): void {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    if (mainWindowRef.isMinimized()) mainWindowRef.restore()
    mainWindowRef.show()
    mainWindowRef.focus()
  }
  if (process.platform === 'darwin') {
    app.dock?.show().catch(() => {})
  }
}

export function notify(opts: NotifyOpts): void {
  if (!enabled) return
  if (!Notification.isSupported()) return
  const n = new Notification({ title: opts.title, body: opts.body })
  n.on('click', () => focusApp())
  n.show()
}

function firstLine(text: string): string {
  const line =
    text
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean) ?? ''
  return line.length > 120 ? `${line.slice(0, 117)}…` : line
}

export function notifyEngineSyncComplete(count: number): void {
  if (count <= 0) return
  notify({
    title: 'Vault sync complete',
    body:
      count === 1
        ? '1 background job finished updating the vault.'
        : `${count} background jobs finished updating the vault.`
  })
}

export function notifyEngineJobFailed(feature: string, message: string): void {
  notify({
    title: 'Background job failed',
    body: `${feature}: ${firstLine(message)}`
  })
}
