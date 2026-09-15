import { create } from 'zustand'
import type { FolderStatusEntry, FolderSyncStatus } from '@shared/types'
import { api } from '@/platform/api'

interface FolderStatusState {
  byFolder: Record<string, FolderStatusEntry>
  initialized: boolean
  init(): Promise<() => void>
  refresh(): Promise<void>
}

export const useFolderStatusStore = create<FolderStatusState>((set, get) => ({
  byFolder: {},
  initialized: false,

  async init() {
    if (get().initialized) return () => undefined
    set({ initialized: true })
    await get().refresh()
    const off = api().on.folderStatusChanged((entry) => {
      set((s) => ({ byFolder: { ...s.byFolder, [entry.folderRel]: entry } }))
    })
    return () => off()
  },

  async refresh() {
    const r = await api().folderContext.status()
    if (r.ok && r.data) {
      const map: Record<string, FolderStatusEntry> = {}
      for (const e of r.data) map[e.folderRel] = e
      set({ byFolder: map })
    }
  }
}))

export function statusFor(
  folderRel: string,
  byFolder: Record<string, FolderStatusEntry>
): FolderSyncStatus {
  return byFolder[folderRel]?.status ?? 'idle'
}

const STATUS_RANK: Record<FolderSyncStatus, number> = {
  running: 4,
  pending: 3,
  failed: 2,
  'just-done': 1,
  idle: 0
}

export interface RolledFolderStatus {
  status: FolderSyncStatus
  fromDescendant: boolean
  own?: FolderStatusEntry
}

export function rolledUpStatusFor(
  folderRel: string,
  byFolder: Record<string, FolderStatusEntry>
): RolledFolderStatus {
  const own = byFolder[folderRel]
  const ownStatus: FolderSyncStatus = own?.status ?? 'idle'
  let best = ownStatus
  let fromDescendant = false
  const prefix = folderRel ? `${folderRel}/` : ''
  for (const [key, entry] of Object.entries(byFolder)) {
    if (key === folderRel) continue
    if (prefix && !key.startsWith(prefix)) continue
    if (STATUS_RANK[entry.status] > STATUS_RANK[best]) {
      best = entry.status
      fromDescendant = true
    }
  }
  return { status: best, fromDescendant, own }
}
