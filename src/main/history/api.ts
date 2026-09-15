import type { HistoryVersion } from '@shared/types'
import { requireVault } from '@main/vault/state'
import { toRelative, vaultTmpDir } from '@main/util/paths'
import { atomicWriteText } from '@main/claude/config/atomic'
import { readBlob, readLog } from './log'

export async function listHistory(absPath: string): Promise<HistoryVersion[]> {
  const vault = requireVault()
  const relPath = toRelative(absPath, vault.root)
  const log = await readLog(vault.root, relPath)
  if (!log) return []
  return [...log.versions].sort((a, b) => b.ts - a.ts)
}

export async function readHistoryVersion(absPath: string, versionId: string): Promise<string> {
  const vault = requireVault()
  const relPath = toRelative(absPath, vault.root)
  const log = await readLog(vault.root, relPath)
  const version = log?.versions.find((v) => v.id === versionId)
  if (!version) throw new Error('Version not found')
  if (!version.blobHash) throw new Error('Version has no content (tombstone)')
  return readBlob(vault.root, version.blobHash)
}

export async function restoreHistoryVersion(absPath: string, versionId: string): Promise<void> {
  const vault = requireVault()
  const content = await readHistoryVersion(absPath, versionId)
  // Restoring is precisely the write that must not fail halfway: it happens
  // because the current content is already unwanted, so a torn write here
  // loses both the version being replaced and the one being restored.
  await atomicWriteText(absPath, content, { tmpDir: vaultTmpDir(vault.root) })
}
