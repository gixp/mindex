import path from 'node:path'
import type { FolderStatusEntry, FolderSyncStatus } from '@shared/types'

interface InternalEntry {
  status: FolderSyncStatus
  lastChange?: number
  lastSuccess?: number
  nextScheduledAt?: number
  errorMessage?: string
  resetTimer?: NodeJS.Timeout
}

const JUST_DONE_DURATION_MS = 10_000

let vaultRoot: string | null = null
const byFolder = new Map<string, InternalEntry>() // key: folderRel
let listener: ((entry: FolderStatusEntry) => void) | null = null

export function setFolderStatusListener(l: ((entry: FolderStatusEntry) => void) | null): void {
  listener = l
}

export function startFolderStatusMap(opts: { vaultRoot: string }): {
  stop(): void
} {
  vaultRoot = opts.vaultRoot
  byFolder.clear()
  return {
    stop() {
      vaultRoot = null
      for (const e of byFolder.values()) {
        if (e.resetTimer) clearTimeout(e.resetTimer)
      }
      byFolder.clear()
    }
  }
}

export function getStatusMap(): FolderStatusEntry[] {
  return [...byFolder.entries()].map(([folderRel, e]) => toExternal(folderRel, e))
}

export function getStatus(folderRel: string): FolderStatusEntry {
  const e = byFolder.get(folderRel)
  if (!e) return { folderRel, status: 'idle' }
  return toExternal(folderRel, e)
}

export function noteFolderTouched(folderAbs: string): void {
  if (!vaultRoot) return
  const folderRel = relOf(folderAbs)
  if (folderRel === null) return
  const e = upsert(folderRel)
  e.lastChange = Date.now()
  if (e.status === 'idle' || e.status === 'just-done') {
    cancelReset(e)
    e.status = 'pending'
  }
  emit(folderRel, e)
}

export function noteJobStarted(folderAbs: string): void {
  if (!vaultRoot) return
  const folderRel = relOf(folderAbs)
  if (folderRel === null) return
  const e = upsert(folderRel)
  cancelReset(e)
  e.status = 'running'
  e.errorMessage = undefined
  emit(folderRel, e)
}

export function noteJobFinished(folderAbs: string): void {
  if (!vaultRoot) return
  const folderRel = relOf(folderAbs)
  if (folderRel === null) return
  const e = upsert(folderRel)
  cancelReset(e)
  e.status = 'just-done'
  e.lastSuccess = Date.now()
  e.errorMessage = undefined
  emit(folderRel, e)
  e.resetTimer = setTimeout(() => {
    e.resetTimer = undefined
    e.status = 'idle'
    emit(folderRel, e)
  }, JUST_DONE_DURATION_MS)
}

export function noteJobFailed(folderAbs: string, message: string): void {
  if (!vaultRoot) return
  const folderRel = relOf(folderAbs)
  if (folderRel === null) return
  const e = upsert(folderRel)
  cancelReset(e)
  e.status = 'failed'
  e.errorMessage = message
  emit(folderRel, e)
}

export function noteJobCancelled(folderAbs: string): void {
  if (!vaultRoot) return
  const folderRel = relOf(folderAbs)
  if (folderRel === null) return
  const e = upsert(folderRel)
  if (e.status === 'running') {
    e.status = e.lastChange ? 'pending' : 'idle'
    emit(folderRel, e)
  }
}

export function setNextScheduledAt(folderRel: string, at: number | undefined): void {
  const e = byFolder.get(folderRel)
  if (!e) return
  if (e.nextScheduledAt === at) return
  e.nextScheduledAt = at
  emit(folderRel, e)
}

export function listDirtyFolders(): string[] {
  const out: string[] = []
  for (const [folderRel, e] of byFolder) {
    if (e.status === 'pending' || e.status === 'failed') out.push(folderRel)
  }
  return out
}

export function getLastChange(folderRel: string): number | undefined {
  return byFolder.get(folderRel)?.lastChange
}

export function clearStatus(folderRel: string): void {
  const e = byFolder.get(folderRel)
  if (!e) return
  cancelReset(e)
  byFolder.delete(folderRel)
  emit(folderRel, { status: 'idle' })
}

function upsert(folderRel: string): InternalEntry {
  let e = byFolder.get(folderRel)
  if (!e) {
    e = { status: 'idle' }
    byFolder.set(folderRel, e)
  }
  return e
}

function cancelReset(e: InternalEntry): void {
  if (e.resetTimer) {
    clearTimeout(e.resetTimer)
    e.resetTimer = undefined
  }
}

function toExternal(folderRel: string, e: InternalEntry): FolderStatusEntry {
  return {
    folderRel,
    status: e.status,
    lastChange: e.lastChange,
    lastSuccess: e.lastSuccess,
    nextScheduledAt: e.nextScheduledAt,
    errorMessage: e.errorMessage
  }
}

function emit(folderRel: string, e: InternalEntry): void {
  listener?.(toExternal(folderRel, e))
}

function relOf(folderAbs: string): string | null {
  if (!vaultRoot) return null
  const root = path.resolve(vaultRoot)
  const abs = path.resolve(folderAbs)
  if (abs === root) return null
  const rel = path.relative(root, abs)
  if (!rel || rel.startsWith('..')) return null
  return rel.split(path.sep).join('/')
}
