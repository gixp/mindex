import { create } from 'zustand'
import type { HistoryVersion } from '@shared/types'
import { api } from '@/platform/api'

interface HistoryState {
  path: string | null
  versions: HistoryVersion[]
  loading: boolean
  loadFor(absPath: string): Promise<void>
  restore(absPath: string, versionId: string): Promise<void>
  reset(): void
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  path: null,
  versions: [],
  loading: false,

  async loadFor(absPath) {
    set({ loading: true, path: absPath })
    const r = await api().history.list(absPath)
    if (get().path !== absPath) return
    set({ versions: r.ok && r.data ? r.data : [], loading: false })
  },

  async restore(absPath, versionId) {
    await api().history.restore(absPath, versionId)
    await get().loadFor(absPath)
  },

  reset() {
    set({ path: null, versions: [], loading: false })
  }
}))
