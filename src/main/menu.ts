import { app, BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type { MenuCommand, NoteTypeId } from '@shared/types'
import { getAppSettings, patchAppSettings } from './settings/app-settings'
import { getVault } from './vault/state'

const ZOOM_STEP = 0.1
const ZOOM_MIN = 0.5
const ZOOM_MAX = 2.0

export function clampZoomFactor(factor: number): number {
  if (!Number.isFinite(factor)) return 1
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, factor))
}

function roundZoom(factor: number): number {
  return Math.round(factor * 10) / 10
}

async function adjustZoom(delta: number): Promise<void> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!win || win.isDestroyed()) return
  const current = win.webContents.getZoomFactor() || 1
  const next = clampZoomFactor(roundZoom(current + delta))
  if (next === roundZoom(current)) return
  win.webContents.setZoomFactor(next)
  await patchAppSettings({ zoomFactor: next })
  await applyMenu()
}

/** Set the interface scale from a percentage (100 = default). The View menu and
 *  the Preferences control both go through here, so the clamp, the persisted
 *  value and the menu label can never drift apart. Returns the percentage that
 *  actually got applied, which differs from the input when it hits the clamp. */
export async function setZoomPercent(percent: number): Promise<number> {
  const next = clampZoomFactor(roundZoom((Number(percent) || 100) / 100))
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (win && !win.isDestroyed()) win.webContents.setZoomFactor(next)
  await patchAppSettings({ zoomFactor: next })
  await applyMenu()
  return Math.round(next * 100)
}

async function resetZoom(): Promise<void> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!win || win.isDestroyed()) return
  win.webContents.setZoomFactor(1)
  await patchAppSettings({ zoomFactor: 1 })
  await applyMenu()
}

function send(cmd: MenuCommand): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!win || win.isDestroyed()) return
  win.webContents.send(IPC.events.menuCommand, cmd)
}

const NEW_TYPES: Array<{ id: NoteTypeId; label: string; accel?: string }> = [
  { id: 'project', label: 'Project', accel: 'CmdOrCtrl+Shift+P' },
  { id: 'person', label: 'Person' },
  { id: 'organization', label: 'Organization' },
  { id: 'goal', label: 'Goal' },
  { id: 'payment', label: 'Payment' },
  { id: 'expense', label: 'Expense' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'daily-note', label: 'Daily Note' },
  { id: 'untyped', label: 'Plain Note', accel: 'CmdOrCtrl+N' }
]

async function buildRecentSubmenu(): Promise<MenuItemConstructorOptions[]> {
  const s = await getAppSettings()
  if (!s.recentVaults.length) {
    return [{ label: 'No recent vaults', enabled: false }]
  }
  const items: MenuItemConstructorOptions[] = s.recentVaults.slice(0, 10).map((v) => ({
    label: v.name,
    sublabel: v.root,
    click: () => send({ kind: 'vault.open', root: v.root })
  }))
  return items
}

export async function buildMenu(): Promise<Menu> {
  const isMac = process.platform === 'darwin'
  const hasVault = !!getVault()
  const recent = await buildRecentSubmenu()

  const newSubmenu: MenuItemConstructorOptions[] = NEW_TYPES.map((t) => ({
    label: t.label,
    accelerator: t.accel,
    enabled: hasVault,
    click: () => send({ kind: 'note.new', type: t.id })
  }))

  const fileMenu: MenuItemConstructorOptions = {
    label: 'File',
    submenu: [
      {
        label: 'New',
        submenu: newSubmenu
      },
      { type: 'separator' },
      {
        label: 'New Vault…',
        accelerator: 'CmdOrCtrl+Shift+N',
        click: () => send({ kind: 'vault.create' })
      },
      {
        label: 'Open Vault…',
        accelerator: 'CmdOrCtrl+O',
        click: () => send({ kind: 'vault.pick' })
      },
      {
        label: 'Open Recent',
        submenu: recent
      },
      {
        label: 'Close Vault',
        accelerator: 'CmdOrCtrl+Shift+W',
        enabled: hasVault,
        click: () => send({ kind: 'vault.close' })
      },
      { type: 'separator' },
      {
        label: 'Save',
        accelerator: 'CmdOrCtrl+S',
        click: () => send({ kind: 'note.save' })
      },
      { type: 'separator' },
      {
        label: 'Reveal Vault in Finder',
        enabled: hasVault,
        click: () => {
          const v = getVault()
          if (v) void shell.openPath(v.root)
        }
      },
      {
        label: 'Rebuild Index',
        enabled: hasVault,
        click: () => send({ kind: 'index.rebuild' })
      },
      ...(isMac ? [] : ([{ type: 'separator' }, { role: 'quit' }] as MenuItemConstructorOptions[]))
    ]
  }

  const editMenu: MenuItemConstructorOptions = {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'pasteAndMatchStyle' },
      { role: 'selectAll' },
      { type: 'separator' },
      {
        label: 'Find in Notes',
        accelerator: 'CmdOrCtrl+K',
        click: () => send({ kind: 'palette.open' })
      }
    ]
  }

  const currentZoom = clampZoomFactor((await getAppSettings()).zoomFactor ?? 1)
  const zoomPercent = `${Math.round(currentZoom * 100)}%`

  const viewMenu: MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      {
        label: 'Toggle Left Sidebar',
        accelerator: 'CmdOrCtrl+B',
        click: () => send({ kind: 'panel.toggleLeft' })
      },
      {
        label: 'Toggle Right Sidebar',
        accelerator: 'CmdOrCtrl+Alt+B',
        click: () => send({ kind: 'panel.toggleRight' })
      },
      // Development only. `toggleDevTools` is already inert in a packaged
      // build (webPreferences.devTools is off there), but a menu item that
      // silently does nothing is worse than no menu item — and reload belongs
      // to the same set of things a shipped app has no reason to offer.
      ...(app.isPackaged
        ? []
        : ([
            { type: 'separator' },
            { role: 'reload' },
            { role: 'forceReload' },
            { role: 'toggleDevTools' }
          ] as MenuItemConstructorOptions[])),
      { type: 'separator' },
      { label: `Zoom: ${zoomPercent}`, enabled: false },
      {
        label: 'Reset Zoom',
        accelerator: 'CmdOrCtrl+0',
        click: () => void resetZoom()
      },
      {
        label: 'Zoom In',
        accelerator: 'CmdOrCtrl+Plus',
        click: () => void adjustZoom(ZOOM_STEP)
      },
      {
        label: 'Zoom Out',
        accelerator: 'CmdOrCtrl+-',
        click: () => void adjustZoom(-ZOOM_STEP)
      },
      { type: 'separator' },
      { role: 'togglefullscreen' }
    ]
  }

  const windowMenu: MenuItemConstructorOptions = {
    label: 'Window',
    submenu: isMac
      ? [
          { role: 'minimize' },
          { role: 'zoom' },
          { type: 'separator' },
          { role: 'front' },
          { type: 'separator' },
          { role: 'window' }
        ]
      : [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }]
  }

  const helpMenu: MenuItemConstructorOptions = {
    label: 'Help',
    submenu: [
      {
        label: 'Report a Bug / Send Feedback…',
        click: () => send({ kind: 'help.reportBug' })
      },
      { type: 'separator' },
      {
        label: 'GitHub Repository',
        click: () => void shell.openExternal('https://github.com/gixp/mindex')
      }
    ]
  }

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ] as MenuItemConstructorOptions[]
          } as MenuItemConstructorOptions
        ]
      : []),
    fileMenu,
    editMenu,
    viewMenu,
    windowMenu,
    helpMenu
  ]

  return Menu.buildFromTemplate(template)
}

export async function applyMenu(): Promise<void> {
  const menu = await buildMenu()
  Menu.setApplicationMenu(menu)
}
