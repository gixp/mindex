import { BrowserWindow, dialog } from 'electron'
import { syncContextFilenames } from '@main/context/filename'
import { syncVaultTypesSkill } from '@main/skills/sync'
import { contextFilename } from '@shared/context-filename'
import { currentProvider } from '@main/providers/engine-choice'
import path from 'node:path'
import fsPromises from 'node:fs/promises'
import type { FileChangeEvent, JobInfo, VaultInfo } from '@shared/types'
import { ensureDir, fileExists } from '@main/util/fs-helpers'
import { vaultMetaDir, vaultTmpDir } from '@main/util/paths'
import {
  addOpenWorkspace,
  getCachedAppSettings,
  nameFromPath,
  patchAppSettings,
  recordRecentVault,
  takeAppIconOverridesForVault
} from '@main/settings/app-settings'
import { ensureVaultMeta, patchVaultSettings } from '@main/settings/vault-settings'
import {
  applyFileChange,
  getStats,
  persistCache,
  rebuildIndex,
  reset as resetIndex
} from '@main/index/indexer'
import {
  noteFileChangeForAi,
  startAiCreatedTracking,
  stopAiCreatedTracking
} from '@main/index/ai-created'
import { ensureContextTemplate } from '@main/livingindex/template'
import { capture } from '@main/telemetry/analytics'
import { setVault, getVault } from './state'
import { startWatcher, stopWatcher } from './watcher'
import { emitFileChange } from './events'
import { ensureRootManagedFiles } from '@main/managed/ensure'
import {
  startFolderContextFeature,
  stopFolderContextFeature,
  armAutoRunsForFolderRels,
  isContextEngineEnabled,
  FEATURE as FOLDER_CONTEXT_FEATURE
} from '@main/folderContext/runner'
import { startFolderContextAggregator } from '@main/folderContext/aggregator'
import { startFolderStatusMap } from '@main/folderContext/status'
import { addEngineListener, logEngine } from '@main/agent-engine'
import { armAutoLivingIndexRun } from '@main/livingindex/runner'
import { buildContextOverview } from '@main/suggestions/overview'
import { startGitStatusFeature, stopGitStatusFeature } from '@main/git/status'
import { startAutoSync, stopAutoSync } from '@main/git/autosync'
import { getVaultSettings } from '@main/settings/vault-settings'
import { startChatStore } from '@main/chat/store'
import { startChatFeature, stopChatFeature } from '@main/chat/runner'
import { startHistoryFeature, stopHistoryFeature } from '@main/history/store'

type FileChangeBroadcast = (event: FileChangeEvent) => void

let broadcastFileChange: FileChangeBroadcast = () => {}

let folderContextAggregatorHandle: { stop(): void } | null = null
let folderContextStatusHandle: { stop(): void } | null = null
let chatStoreHandle: { stop(): void } | null = null
let unsubscribeAutoLivingIndex: (() => void) | null = null

export function setBroadcaster(cb: FileChangeBroadcast): void {
  broadcastFileChange = cb
}

export async function pickVaultDialog(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: 'Open Vault',
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Open vault'
  })
  if (result.canceled) return null
  return result.filePaths[0] ?? null
}

export async function pickNewVaultDialog(): Promise<string | null> {
  const result = await dialog.showSaveDialog({
    title: 'New Vault',
    buttonLabel: 'Create vault',
    nameFieldLabel: 'Vault name:',
    defaultPath: 'New Vault',
    properties: ['createDirectory', 'showOverwriteConfirmation']
  })
  if (result.canceled || !result.filePath) return null
  return result.filePath
}

export async function createNewVault(root: string): Promise<VaultInfo> {
  if (!path.isAbsolute(root)) throw new Error(`Vault path must be absolute: ${root}`)
  if (await fileExists(root)) {
    const { promises: fsp } = await import('node:fs')
    const entries = await fsp.readdir(root).catch(() => [] as string[])
    if (entries.length > 0) {
      throw new Error(`Folder already exists and is not empty: ${root}`)
    }
  } else {
    await ensureDir(root)
  }
  return await openVault(root)
}

/**
 * Rebuild the window after a switch between two vaults.
 *
 * Everything in the app half is torn down and started again for the new vault
 * — the index, the watcher, the chat store, the assistants' sessions. The
 * window is not: its chat tabs, their ids and whatever they had warmed up all
 * survive, because nothing in it listens for a vault change except the note
 * list and the settings.
 *
 * The visible failure was an assistant answering about the folder you left.
 * The exact path that carried the old working directory across was not worth
 * finding, because every path of that kind ends the same way: a window still
 * holding something that belongs to a vault that is no longer open. Rebuilding
 * it is the one fix that covers all of them, and a reload is cheap — the app
 * half stays up, so this is a repaint, not a restart.
 *
 * Delayed rather than immediate: the caller's reply and the vault-changed
 * broadcast are still in flight when this is scheduled, and reloading out from
 * under them would leave the window showing a stale vault.
 */
function rebuildWindowAfterSwitch(): void {
  setTimeout(() => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.reload()
    }
  }, 250)
}

export async function openVault(root: string): Promise<VaultInfo> {
  if (!path.isAbsolute(root)) throw new Error(`Vault path must be absolute: ${root}`)
  if (!(await fileExists(root))) {
    await ensureDir(root)
  }
  // Read before the close, which clears it. A first open has none, and
  // reopening the one already open is not a switch.
  const previousRoot = getVault()?.root ?? null
  await closeVault()
  const info: VaultInfo = {
    root,
    name: nameFromPath(root),
    openedAt: Date.now()
  }
  setVault(info)
  await ensureDir(vaultMetaDir(root))
  await ensureVaultMeta()
  await migrateVaultIcons(root).catch(() => {})
  // Before anything reads or regenerates context: make sure every context
  // file in the vault is named for the provider that's actually active right
  // now. Running it here means the aggregator and the folder-context feature
  // below never see a half-migrated tree — and it's the same sync that runs
  // whenever the user changes provider in Settings, just also run once at
  // open in case a prior run was interrupted or the setting changed while
  // this vault wasn't open to react to it.
  const provider = currentProvider()
  const targetFilename = contextFilename(provider)
  await syncContextFilenames(root, targetFilename)
    .then((renamed) => {
      if (renamed.length > 0) {
        console.log(`[context] renamed ${renamed.length} file(s) → ${targetFilename}`)
      }
    })
    .catch(() => {})
  // Atomic writes stage into `.mindex/tmp/` and clean up after themselves,
  // but a crash between staging and the rename leaves the staged file behind.
  // Nothing reads that directory, so the only cost of a leftover is that it
  // stays forever — clear it once per vault open.
  await fsPromises.rm(vaultTmpDir(root), { recursive: true, force: true }).catch(() => {})
  // Skipped when the setup window was told not to. That answer is app-wide
  // and read here rather than passed in, so every way into a vault — the setup
  // window, a recent entry, the last vault at launch — honours the same one.
  if (getCachedAppSettings().vaultSetup?.seedRootContext !== false) {
    await ensureRootManagedFiles(root, provider).catch(() => {})
  }
  await ensureContextTemplate(root).catch(() => {})
  // The vault's note types, written out where the CLI looks for conventions.
  // Same placement reasoning as the context files above: done before the index
  // is built, so the first thing that reads the vault sees the final tree.
  await syncVaultTypesSkill().catch(() => {})
  await rebuildIndex()
  await persistCache().catch(() => {})
  await startAiCreatedTracking(root)
  await startWatcher(root, async (event) => {
    try {
      await applyFileChange(event)
    } catch {}
    noteFileChangeForAi(event)
    broadcastFileChange(event)
    emitFileChange(event)
  })
  startHistoryFeature({ vaultRoot: root })
  folderContextStatusHandle = startFolderStatusMap({ vaultRoot: root })
  folderContextAggregatorHandle = startFolderContextAggregator({ vaultRoot: root })
  startFolderContextFeature({ vaultRoot: root })
  // Auto mode only: a folder-context job succeeding is what arms the root
  // rebuild — kept here rather than inside folderContext/ or livingindex/ so
  // neither module needs to know the other exists.
  unsubscribeAutoLivingIndex = addEngineListener({
    kind: 'job',
    cb: (info: JobInfo) => {
      if (info.feature !== FOLDER_CONTEXT_FEATURE || info.status !== 'success') return
      if (!isContextEngineEnabled()) return
      if (getCachedAppSettings().engine?.autoContextEnabled !== true) return
      armAutoLivingIndexRun(root)
    }
  })
  // Auto mode carried over from a previous session: status.ts starts every
  // open with a clean slate, so a folder that was already stale or never had
  // a context file at all won't show as `pending` until something touches it
  // live — which may never happen if nothing in it changes again. The on-disk
  // overview catches those up front instead of leaving them to wait
  // indefinitely for a file event that resolves nothing.
  if (isContextEngineEnabled() && getCachedAppSettings().engine?.autoContextEnabled === true) {
    void buildContextOverview(root)
      .then((overview) => {
        const stale = overview.folders
          .filter((f) => f.staleness !== 'fresh' && !f.aiDisabled)
          .map((f) => f.folderRel)
        armAutoRunsForFolderRels(root, stale)
        logEngine(
          'info',
          `Auto Context: armed ${stale.length} folder(s) missing or behind at vault open`,
          { feature: FOLDER_CONTEXT_FEATURE }
        )
      })
      .catch((err: unknown) => {
        logEngine(
          'error',
          `Auto Context sweep failed to read the vault overview at open: ${err instanceof Error ? err.message : String(err)}`,
          { feature: FOLDER_CONTEXT_FEATURE }
        )
      })
  }
  startGitStatusFeature({ vaultRoot: root })
  // Reads the vault's own `autoSync.mode`; does nothing at all when it is
  // `off`, which is every vault that has not explicitly turned it on.
  await startAutoSync(root)

  chatStoreHandle = await startChatStore({ vaultRoot: root })
  startChatFeature({ vaultRoot: root })

  await recordRecentVault(info)
  await addOpenWorkspace(info)
  capture('vault_opened', { note_count: getStats().totalNotes })
  if (previousRoot && previousRoot !== root) rebuildWindowAfterSwitch()
  return info
}

async function migrateVaultIcons(root: string): Promise<void> {
  const moved = await takeAppIconOverridesForVault(root)
  if (
    Object.keys(moved.iconOverrides).length === 0 &&
    Object.keys(moved.iconColorOverrides).length === 0
  ) {
    return
  }
  const cur = await getVaultSettings()
  await patchVaultSettings({
    iconOverrides: { ...moved.iconOverrides, ...(cur.iconOverrides ?? {}) },
    iconColorOverrides: { ...moved.iconColorOverrides, ...(cur.iconColorOverrides ?? {}) }
  })
}

export async function closeVault(): Promise<void> {
  stopFolderContextFeature()
  if (unsubscribeAutoLivingIndex) {
    unsubscribeAutoLivingIndex()
    unsubscribeAutoLivingIndex = null
  }
  stopGitStatusFeature()
  stopAutoSync()
  if (folderContextAggregatorHandle) {
    folderContextAggregatorHandle.stop()
    folderContextAggregatorHandle = null
  }
  if (folderContextStatusHandle) {
    folderContextStatusHandle.stop()
    folderContextStatusHandle = null
  }
  stopChatFeature()
  if (chatStoreHandle) {
    chatStoreHandle.stop()
    chatStoreHandle = null
  }
  stopHistoryFeature()
  stopAiCreatedTracking()
  await stopWatcher()
  resetIndex()
  setVault(null)
  await patchAppSettings({ lastVault: undefined }).catch(() => {})
}

export function currentVault(): VaultInfo | null {
  return getVault()
}
