/*
 * Mindex — your second brain, powered by Claude.
 * Copyright (C) 2026 Dmitriy Volynov
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import { BrowserWindow, app, nativeImage, protocol, shell } from 'electron'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { registerIpcHandlers, bindWindow, broadcastVaultState } from './ipc/handlers'
import { imageMimeForExt } from './notes/assets'
import { getAppSettings } from './settings/app-settings'
import { registerAllExternalMcp } from './mcp/external-targets'
import { openVault } from './vault/opener'
import { applyMenu, clampZoomFactor } from './menu'
import { closeAllTerminals } from './terminal/pty'
import { stopBridge } from './mcp'
import { endAllAcpChatSessions } from './acp/chat-session'
import { startCatalogue } from './acp/catalogue'
import { currentProvider } from './providers/engine-choice'
import { setNotificationsEnabled } from './notifications/service'
import { initSentry } from './telemetry/sentry'
import { initAnalytics, shutdownAnalytics } from './telemetry/analytics'
import { startUpdateChecks } from './updater'

if (process.env['ELECTRON_RENDERER_URL']) {
  process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true'
}

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason)
})

app.setName('Mindex')

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
}

const ASSET_SCHEME = 'mindex-asset'
protocol.registerSchemesAsPrivileged([
  {
    scheme: ASSET_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

const resourcesDir = path.resolve(__dirname, '..', '..', 'resources')
const iconPath = path.join(resourcesDir, 'icon-512.png')

let mainWindow: BrowserWindow | null = null

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    // Nudged toward the window's true top-left corner.
    trafficLightPosition: { x: 10, y: 10 },
    backgroundColor: '#0a0a0a',
    title: 'Mindex',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      // Off in a packaged build. This is the switch that actually matters:
      // with it false, `toggleDevTools()` does nothing no matter who calls it,
      // so the accelerators and the menu item below are closed by the same
      // decision rather than each needing to be remembered separately.
      devTools: !app.isPackaged
    }
  })

  /**
   * Show the window, and say so when it was not the normal path.
   *
   * The window is created hidden and shown on `ready-to-show`, which fires
   * after the page's first paint — that is what stops a white rectangle
   * appearing before there is anything in it. The flaw is that it is the *only*
   * thing that shows the window: if the first paint never arrives, the app runs
   * forever with nothing on screen and reports nothing, because as far as it is
   * concerned nothing went wrong.
   *
   * That is not hypothetical. On Windows it has been watched happening: five
   * live processes, 200MB, real CPU, a window that exists — class
   * `Chrome_WidgetWin_1`, title "Mindex" — and invisible. Forcing it visible
   * from outside was enough; the app itself was fine.
   *
   * So the paint is no longer the only way out. Whatever else is true, the
   * window appears, and the log says which path got it there — a line saying
   * the fallback fired is how this gets diagnosed rather than guessed at again.
   */
  let shown = false
  const reveal = (why: string): void => {
    if (shown || window.isDestroyed()) return
    shown = true
    clearTimeout(revealTimer)
    if (why !== 'ready-to-show') console.warn(`[window] shown without a first paint: ${why}`)
    window.show()
  }
  // Long enough that it never races a slow but healthy start — a cold first
  // launch on a spinning disk, or an x64 build being translated on an ARM
  // machine — and short enough that nobody concludes the app is broken.
  const revealTimer = setTimeout(() => reveal('timed out waiting for the first paint'), 10_000)

  window.on('ready-to-show', () => reveal('ready-to-show'))
  window.on('closed', () => clearTimeout(revealTimer))

  // A page that failed to load will never paint, so there is no reason to keep
  // waiting for the timer: show the window and let the failure be visible.
  window.webContents.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
    if (!isMainFrame) return
    console.error('[did-fail-load]', code, description, url)
    reveal(`the page failed to load (${code} ${description})`)
  })

  window.webContents.on('render-process-gone', (_e, details) => {
    console.error('[render-process-gone]', details.reason, details.exitCode)
    reveal(`the renderer stopped (${details.reason})`)
  })

  window.webContents.on('preload-error', (_e, preloadPath, err) => {
    console.error('[preload-error]', preloadPath, err)
  })

  // Developer shortcuts, registered only in development. In a packaged build
  // the keys are left alone entirely rather than bound to a no-op: swallowing
  // Cmd+R there would take a key away from the app for no reason.
  if (!app.isPackaged) {
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return
      const mod = process.platform === 'darwin' ? input.meta : input.control
      const altOrShift = input.alt || input.shift
      const isToggleI = mod && altOrShift && input.key.toLowerCase() === 'i'
      const isF12 = input.key === 'F12'
      if (isToggleI || isF12) {
        window.webContents.toggleDevTools()
        event.preventDefault()
        return
      }
      if (mod && !input.alt && !input.shift && input.key.toLowerCase() === 'r') {
        window.webContents.reload()
        event.preventDefault()
      }
    })
  }

  window.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    await window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    await window.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  try {
    const s = await getAppSettings()
    const factor = clampZoomFactor(s.zoomFactor ?? 1)
    window.webContents.setZoomFactor(factor)
  } catch {}

  mainWindow = window
  bindWindow(window)
}

async function reopenLastVault(): Promise<void> {
  try {
    const settings = await getAppSettings()
    if (settings.lastVault) {
      await openVault(settings.lastVault).catch((err) => {
        console.error('[reopenLastVault] openVault failed:', err)
      })
    }
  } catch (err) {
    console.error('[reopenLastVault] settings load failed:', err)
  }
}

// Sentry must be initialised before anything else can throw, so it is started
// outside `whenReady` — a crash during startup is precisely the one worth
// catching, and by `whenReady` some of that window has already passed.
initSentry()

app.whenReady().then(async () => {
  // Force a regular foreground app on macOS. A polluted LaunchServices database
  // — e.g. dev `electron` runs registering as "Mindex" (via app.setName) with the
  // ui-element flag, or stale dist copies — can otherwise launch us as an
  // accessory app: no Dock running indicator and the menu bar stays with Finder.
  // Setting the policy explicitly overrides that disposition at runtime.
  if (process.platform === 'darwin') {
    app.setActivationPolicy('regular')
    app.dock?.show()
  }

  registerIpcHandlers()

  protocol.handle(ASSET_SCHEME, async (request) => {
    try {
      const filePath = decodeURIComponent(new URL(request.url).pathname)
      const mime = imageMimeForExt(path.extname(filePath))
      if (!mime) return new Response('forbidden', { status: 403 })
      const data = await readFile(filePath)
      return new Response(data, { headers: { 'content-type': mime } })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
  try {
    const s = await getAppSettings()
    setNotificationsEnabled(s.notificationsEnabled !== false)
  } catch {}
  if (process.platform === 'darwin' && app.dock) {
    try {
      const img = nativeImage.createFromPath(iconPath)
      if (!img.isEmpty()) app.dock.setIcon(img)
    } catch {}
  }
  // What each assistant offers — models, modes, effort levels — read from disk
  // BEFORE the window exists, so the first thing drawn already has the real
  // lists rather than the ones written into Mindex by hand.
  //
  // Awaited on purpose, and safe to await: this reads one small file. The
  // re-check that follows it talks to the assistants and is not awaited, so a
  // slow or absent one can never hold up a launch.
  await startCatalogue(currentProvider()).catch((err) =>
    console.error('[agents] catalogue failed:', err)
  )

  await applyMenu()
  await createWindow()

  // `app_opened` carries the anonymous install id, the platform and the
  // first-run flag — which is the whole of what a separate install count used
  // to record, by the same identifier. It is fired inside init, where the
  // first-run flag is known.
  void initAnalytics().catch((err) => console.error('[analytics] init failed:', err))
  // Asks the feed and says if something is newer. Downloads nothing.
  startUpdateChecks()

  // Restore any persisted sign-in session (offline-friendly). The renderer gate
  // reads the broadcast status and blocks the UI until signed in.
  // Re-registered on every launch, not once ever: the bridge's socket address
  // and token rotate each time (`mcp/bridge.ts`), so a config written last
  // session is already stale. Off by default — only runs if the setting says
  // so; see `AppSettings.engine.externalMcpEnabled`.
  void getAppSettings()
    .then((settings) => {
      if (settings.engine?.externalMcpEnabled === true) return registerAllExternalMcp()
      return undefined
    })
    .catch((err) => console.error('[mcp] external registration failed:', err))
  // Cold start via the protocol (Windows/Linux pass the URL in argv).

  await reopenLastVault()
  if (mainWindow && !mainWindow.isDestroyed()) {
    const wc = mainWindow.webContents
    if (wc.isLoading()) {
      wc.once('did-finish-load', () => {
        setTimeout(() => broadcastVaultState(), 100)
      })
    } else {
      setTimeout(() => broadcastVaultState(), 100)
    }
  }
  await applyMenu()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  closeAllTerminals()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  closeAllTerminals()
  // The MCP bridge holds a socket file open; without this it survives the app
  // as a dead path in the temp directory.
  stopBridge()
  // The chat tabs' long-lived agent connections. Unlike the terminal PTYs
  // these are plain pipes, so nothing else would reap them.
  endAllAcpChatSessions()
  // Flush queued events; failure here must never delay the quit.
  void shutdownAnalytics()
})

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (e, navigationUrl) => {
    if (process.env['ELECTRON_RENDERER_URL']) {
      const allowed = process.env['ELECTRON_RENDERER_URL']
      if (navigationUrl.startsWith(allowed)) return
    }
    e.preventDefault()
  })
})

export { mainWindow }
