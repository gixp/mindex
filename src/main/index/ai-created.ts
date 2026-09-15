import type { FileChangeEvent } from '@shared/types'
import { toRelative } from '@main/util/paths'
import { engineScheduler } from '@main/agent-engine'
import { getVaultSettings, patchVaultSettings } from '@main/settings/vault-settings'

let vaultRoot: string | null = null
let aiFiles = new Set<string>()
let listener: ((files: string[]) => void) | null = null
let persistTimer: ReturnType<typeof setTimeout> | null = null

export function setAiFilesListener(fn: ((files: string[]) => void) | null): void {
  listener = fn
}

export async function startAiCreatedTracking(root: string): Promise<void> {
  vaultRoot = root
  try {
    const s = await getVaultSettings()
    aiFiles = new Set(s.aiCreatedFiles ?? [])
  } catch {
    aiFiles = new Set()
  }
}

export function stopAiCreatedTracking(): void {
  vaultRoot = null
  aiFiles = new Set()
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
}

export function getAiCreatedFiles(): string[] {
  return [...aiFiles]
}

function persist(): void {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    void patchVaultSettings({ aiCreatedFiles: [...aiFiles] }).catch(() => undefined)
  }, 300)
}

export function noteFileChangeForAi(event: FileChangeEvent): void {
  if (!vaultRoot) return
  if (event.kind === 'add') {
    if (engineScheduler.active().length === 0) return
    const rel = toRelative(event.path, vaultRoot)
    if (!rel || rel.startsWith('.mindex') || aiFiles.has(rel)) return
    aiFiles.add(rel)
    // Heatmap: count this AI-written file as one edit.
    listener?.([...aiFiles])
    persist()
  } else if (event.kind === 'unlink') {
    const rel = toRelative(event.path, vaultRoot)
    if (aiFiles.delete(rel)) {
      listener?.([...aiFiles])
      persist()
    }
  }
}

export function clearAiCreated(relPath: string): void {
  if (aiFiles.delete(relPath)) {
    listener?.([...aiFiles])
    persist()
  }
}
