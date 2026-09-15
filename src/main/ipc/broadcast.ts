import { BrowserWindow, safeStorage, shell } from 'electron'
import type { FileChangeEvent, IndexStats, VaultInfo } from '@shared/types'
import { IPC } from '@shared/ipc-channels'
import { currentVault, setBroadcaster } from '@main/vault/opener'
import { getStats } from '@main/index/indexer'
import { setAiFilesListener } from '@main/index/ai-created'
import { bindTerminalHandlers } from '@main/terminal/pty'
import { bindClaudeSessionListener } from '@main/claude/sessions'
import type { JobInfo, FolderStatusEntry, GitStatusSnapshot } from '@shared/types'
import { setHistoryUpdateListener } from '@main/history/store'
import { addEngineListener } from '@main/agent-engine'
import { setFolderContextUpdateListener } from '@main/folderContext/aggregator'
import { setFolderStatusListener } from '@main/folderContext/status'
import { setGitStatusListener } from '@main/git/status'
import { setChatUpdateListener } from '@main/chat/store'
import { setChatBroadcast } from '@main/chat/runner'
import { setAcpSurfaceListener, setAcpPermissionListener } from '@main/acp/chat-session'
import { setCatalogueListener } from '@main/acp/catalogue'
import { bindNotificationWindow } from '@main/notifications/service'
import { startEngineNotificationWatch } from '@main/notifications/engine-watch'
import { setSecretStore } from '@main/util/secret-store'
import { setSyncStatusBroadcast } from '@main/git/autosync'
import { setGithubAuthBroadcast, setOpenExternal } from '@main/git/github'
import { installLinkHealthAuto, setLinkHealthBroadcast } from '@main/index/linkHealthAuto'

/**
 * The main window + the one function everything else uses to talk to it.
 *
 * Split out of what used to be `ipc/handlers.ts` so the per-namespace files
 * under `ipc/handlers/` can import `broadcast` without importing each other —
 * `ipc/handlers/index.ts` imports every namespace file's `registerXHandlers`,
 * so this couldn't live there without a cycle.
 */
let mainWindow: BrowserWindow | null = null

/** For the rare handler that needs the window itself, not just `broadcast`. */
export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function broadcastVaultState(): void {
  const v = currentVault()
  broadcast<VaultInfo | null>(IPC.events.vaultChanged, v)
  if (v) {
    broadcast<IndexStats>(IPC.events.indexUpdated, getStats())
  }
}

export function bindWindow(win: BrowserWindow): void {
  mainWindow = win
  setBroadcaster((event: FileChangeEvent) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.events.fileChange, event)
    }
  })
  bindTerminalHandlers({
    onData: (id, data) => broadcast(IPC.terminalEvents.data, { id, data }),
    onExit: (id, code) => broadcast(IPC.terminalEvents.exit, { id, code })
  })
  bindClaudeSessionListener((p) => broadcast(IPC.claudeEvents.sessionTitle, p))

  addEngineListener({
    kind: 'job',
    cb: (info) => broadcast<JobInfo>(IPC.engineEvents.jobUpdate, info)
  })
  addEngineListener({
    kind: 'log',
    cb: (entry) => broadcast(IPC.engineEvents.log, entry)
  })
  addEngineListener({
    kind: 'paused',
    cb: (paused) => broadcast<boolean>(IPC.engineEvents.pausedChanged, paused)
  })
  setFolderContextUpdateListener((payload) =>
    broadcast<{ folderRel: string }>(IPC.folderContextEvents.updated, payload)
  )
  setFolderStatusListener((entry) =>
    broadcast<FolderStatusEntry>(IPC.folderContextEvents.statusChanged, entry)
  )
  setGitStatusListener((snapshot) =>
    broadcast<GitStatusSnapshot>(IPC.gitEvents.statusChanged, snapshot)
  )
  setHistoryUpdateListener((relPath) => broadcast<string>(IPC.historyEvents.updated, relPath))
  setChatUpdateListener((sessionId) => broadcast(IPC.chatEvents.sessionUpdated, { sessionId }))
  setAcpSurfaceListener((sessionId) => broadcast(IPC.chatEvents.agentOptions, { sessionId }))
  setAcpPermissionListener(
    (payload) => broadcast(IPC.chatEvents.permissionRequest, payload),
    (sessionId, turnId, requestId) =>
      broadcast(IPC.chatEvents.permissionResolved, { sessionId, turnId, requestId })
  )
  // A catalogue learned at launch has no conversation attached — every open tab
  // may be showing it, so this says "re-read", not "this tab changed".
  setCatalogueListener(() => broadcast(IPC.chatEvents.agentOptions, { sessionId: null }))
  setAiFilesListener((files) => broadcast<string[]>(IPC.events.aiFilesUpdated, files))
  setChatBroadcast(<T>(channel: string, payload: T) => broadcast<T>(channel, payload))
  // The real safeStorage/BrowserWindow/shell adapters for git/github-token.ts,
  // git/autosync.ts and git/github.ts — kept Electron-free themselves so the
  // logic in each is testable without it. See util/secret-store.ts.
  setSecretStore({
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plaintext) => safeStorage.encryptString(plaintext),
    decrypt: (ciphertext) => safeStorage.decryptString(ciphertext)
  })
  setSyncStatusBroadcast((status) => broadcast(IPC.syncEvents.status, status))
  setGithubAuthBroadcast((state) => broadcast(IPC.githubEvents.auth, state))
  setOpenExternal((url) => void shell.openExternal(url))
  setLinkHealthBroadcast((health) => broadcast(IPC.linkHealthEvents.updated, health))
  installLinkHealthAuto()

  bindNotificationWindow(win)
  startEngineNotificationWatch()
}

export function broadcast<T>(channel: string, payload: T): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
  if (channel === IPC.events.vaultChanged) {
    void import('@main/menu').then(({ applyMenu }) => applyMenu())
  }
}
