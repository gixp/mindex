import { shell } from 'electron'
import { contextFilename } from '@shared/context-filename'
import { currentProvider } from '@main/providers/engine-choice'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import type { FolderContextFile, FolderContextSnapshot, FolderStatusEntry } from '@shared/types'
import {
  getFolderContextSnapshot,
  readFolderContext as readFolderContextFromCache
} from './aggregator'
import { rescanFolderContextNow, cancelArmedAutoRun } from './runner'
import { clearStatus, getStatusMap } from './status'
import { getVaultSettings, patchVaultSettings } from '@main/settings/vault-settings'

const HIDDEN_INTERNAL_DIRS = new Set([
  '.git',
  'node_modules',
  '.mindex',
  '.vault',
  '.obsidian',
  '.backups',
  '.claude',
  '.DS_Store'
])

function isHiddenInternalFolder(folderRel: string): boolean {
  if (!folderRel) return false
  const first = folderRel.split('/')[0] ?? ''
  return HIDDEN_INTERNAL_DIRS.has(first)
}

function normaliseExclusion(folderRel: string): string {
  return folderRel.replace(/\/+$/, '')
}

export async function isFolderAiSyncDisabled(folderRel: string): Promise<boolean> {
  if (!folderRel) return false
  let settings
  try {
    settings = await getVaultSettings()
  } catch {
    return false
  }
  const list = settings.folderContext?.excludedPaths ?? []
  if (list.length === 0) return false
  const target = normaliseExclusion(folderRel)
  for (const raw of list) {
    const entry = normaliseExclusion(raw)
    if (!entry) continue
    if (target === entry) return true
    if (target.startsWith(`${entry}/`)) return true
  }
  return false
}

export async function disableAiSyncApi(vaultRoot: string, folderRel: string): Promise<void> {
  const normalised = normaliseExclusion(folderRel)
  if (!normalised) {
    throw new Error('Cannot disable AI sync for the vault root')
  }
  const settings = await getVaultSettings()
  const current = settings.folderContext?.excludedPaths ?? []
  const entry = `${normalised}/`
  const next = [...current.filter((p) => normaliseExclusion(p) !== normalised), entry]
  await patchVaultSettings({
    folderContext: { ...(settings.folderContext ?? {}), excludedPaths: next }
  })

  const folderAbs = path.join(vaultRoot, normalised.split('/').join(path.sep))
  cancelArmedAutoRun(folderAbs)
  const contextFilePath = path.join(folderAbs, contextFilename(currentProvider()))
  try {
    await fsp.access(contextFilePath)
    await shell.trashItem(contextFilePath)
  } catch {}

  clearStatus(normalised)
}

export async function enableAiSyncApi(folderRel: string): Promise<void> {
  const normalised = normaliseExclusion(folderRel)
  if (!normalised) return
  const settings = await getVaultSettings()
  const current = settings.folderContext?.excludedPaths ?? []
  const next = current.filter((p) => normaliseExclusion(p) !== normalised)
  if (next.length === current.length) return
  await patchVaultSettings({
    folderContext: { ...(settings.folderContext ?? {}), excludedPaths: next }
  })
}

export async function listFolderContextApi(vaultRoot: string): Promise<FolderContextSnapshot> {
  return getFolderContextSnapshot(vaultRoot)
}

export async function readFolderContextApi(
  vaultRoot: string,
  folderRel: string
): Promise<FolderContextFile | null> {
  return readFolderContextFromCache(vaultRoot, folderRel)
}

export async function rescanFolderContextApi(vaultRoot: string, folderRel: string): Promise<void> {
  if (isHiddenInternalFolder(folderRel)) {
    clearStatus(folderRel)
    return
  }
  if (await isFolderAiSyncDisabled(folderRel)) {
    clearStatus(folderRel)
    return
  }
  const folderAbs = folderRel
    ? path.join(vaultRoot, folderRel.split('/').join(path.sep))
    : vaultRoot
  rescanFolderContextNow(folderAbs, { immediate: true })
}

export async function rescanAllFolderContextApi(
  vaultRoot: string,
  snapshot: FolderContextSnapshot
): Promise<void> {
  for (const file of snapshot.files) {
    await rescanFolderContextApi(vaultRoot, file.folderRel)
  }
}

export function listFolderStatuses(): FolderStatusEntry[] {
  for (const entry of getStatusMap()) {
    if (isHiddenInternalFolder(entry.folderRel)) {
      clearStatus(entry.folderRel)
    }
  }
  return getStatusMap()
}
