import { create } from 'zustand'
import type { IndexStats, MigrationPlan, NoteMeta, RecentVault, VaultInfo } from '@shared/types'
import { api } from '@/platform/api'
import { clearVaultSettings, loadVaultSettings } from '@/platform/vault-settings'

const REFRESH_DEBOUNCE_MS = 120
let refreshTimer: ReturnType<typeof setTimeout> | null = null
function scheduleRefresh(fn: () => void): void {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    fn()
  }, REFRESH_DEBOUNCE_MS)
}

interface VaultState {
  vault: VaultInfo | null
  recent: RecentVault[]
  openWorkspaces: RecentVault[]
  notes: NoteMeta[]
  dirs: string[]
  stats: IndexStats | null
  loading: boolean
  error: string | null
  pendingMigration: MigrationPlan | null

  init(): Promise<void>
  pickVault(): Promise<void>
  createVault(): Promise<void>
  cloneVault(url: string, destDir: string): Promise<void>
  openVault(root: string): Promise<void>
  removeRecentVault(root: string): Promise<void>
  removeOpenWorkspace(root: string): Promise<void>
  closeVault(): Promise<void>
  confirmMigration(): Promise<void>
  cancelMigration(): void
  refresh(): Promise<void>
  rebuild(): Promise<void>
}

export const useVaultStore = create<VaultState>((set, get) => ({
  vault: null,
  recent: [],
  openWorkspaces: [],
  notes: [],
  dirs: [],
  stats: null,
  loading: false,
  error: null,
  pendingMigration: null,

  async init() {
    set({ loading: true, error: null })
    try {
      const a = api()
      const cur = await a.vault.current()
      const rec = await a.vault.recent()
      const open = await a.vault.openWorkspaces()
      set({
        vault: cur.ok ? (cur.data ?? null) : null,
        recent: rec.ok ? (rec.data ?? []) : [],
        openWorkspaces: open.ok ? (open.data ?? []) : []
      })
      if (cur.ok && cur.data) {
        await get().refresh()
        await loadVaultSettings()
      }
      a.on.vaultChanged(async (info) => {
        set({ vault: info })
        if (info) {
          await get().refresh()
          await loadVaultSettings()
        } else {
          set({ notes: [], dirs: [], stats: null })
          clearVaultSettings()
        }
      })
      a.on.indexUpdated((stats) => {
        set({ stats })
      })
      a.on.fileChange(() => {
        scheduleRefresh(() => void get().refresh())
      })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'init failed' })
    } finally {
      set({ loading: false })
    }
  },

  async pickVault() {
    const a = api()
    set({ loading: true, error: null })
    try {
      const picked = await a.vault.pickRootDialog()
      if (!picked.ok || !picked.data) {
        if (picked.error && picked.error !== 'Cancelled') {
          set({ error: picked.error })
        }
        return
      }
      await beginOpenFlow(picked.data.root, set, get)
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'pick failed' })
    } finally {
      set({ loading: false })
    }
  },

  async createVault() {
    const a = api()
    set({ loading: true, error: null })
    try {
      const r = await a.vault.createNew()
      if (!r.ok) {
        if (r.error !== 'Cancelled') set({ error: r.error ?? 'create failed' })
        return
      }
      set({ vault: r.data ?? null })
      const rec = await a.vault.recent()
      const open = await a.vault.openWorkspaces()
      set({
        recent: rec.ok ? (rec.data ?? []) : [],
        openWorkspaces: open.ok ? (open.data ?? []) : []
      })
      await get().refresh()
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'create failed' })
    } finally {
      set({ loading: false })
    }
  },

  async openVault(root: string) {
    set({ loading: true, error: null })
    try {
      await beginOpenFlow(root, set, get)
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'open failed' })
    } finally {
      set({ loading: false })
    }
  },

  async cloneVault(url: string, destDir: string) {
    const a = api()
    set({ loading: true, error: null })
    try {
      const r = await a.git.clone(url, destDir)
      if (!r.ok || !r.data) {
        set({ error: r.error ?? 'clone failed' })
        return
      }
      await beginOpenFlow(r.data.root, set, get)
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'clone failed' })
    } finally {
      set({ loading: false })
    }
  },

  async removeRecentVault(root: string) {
    const a = api()
    const r = await a.vault.removeRecent(root)
    if (!r.ok) {
      set({ error: r.error ?? 'remove failed' })
      return
    }
    const rec = await a.vault.recent()
    set({ recent: rec.ok ? (rec.data ?? []) : [] })
  },

  async removeOpenWorkspace(root: string) {
    const a = api()
    const r = await a.vault.removeOpenWorkspace(root)
    if (!r.ok) {
      set({ error: r.error ?? 'remove failed' })
      return
    }
    const open = await a.vault.openWorkspaces()
    set({ openWorkspaces: open.ok ? (open.data ?? []) : [] })
  },

  async confirmMigration() {
    const plan = get().pendingMigration
    if (!plan) return
    set({ loading: true, error: null })
    try {
      const a = api()
      // Setting up a vault only adds `.mindex/` metadata and an AGENTS.md
      // alongside the existing files — it never rewrites or deletes them —
      // so the pre-migration zip was insuring against nothing.
      const r = await a.vault.openWithMigration(plan.vaultRoot, {
        skipBackup: true
      })
      if (!r.ok) {
        set({ error: r.error ?? 'open failed' })
        return
      }
      set({ vault: r.data ?? null, pendingMigration: null })
      const rec = await a.vault.recent()
      const open = await a.vault.openWorkspaces()
      set({
        recent: rec.ok ? (rec.data ?? []) : [],
        openWorkspaces: open.ok ? (open.data ?? []) : []
      })
      await get().refresh()
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'migration failed' })
    } finally {
      set({ loading: false })
    }
  },

  cancelMigration() {
    set({ pendingMigration: null })
  },

  async closeVault() {
    const a = api()
    await a.vault.close()
    set({ vault: null, notes: [], stats: null })
  },

  async refresh() {
    const a = api()
    const [notesRes, dirsRes, statsRes] = await Promise.all([
      a.notes.list(),
      a.notes.dirs(),
      a.index.stats()
    ])
    set({
      notes: notesRes.ok ? (notesRes.data ?? []) : [],
      dirs: dirsRes.ok ? (dirsRes.data ?? []) : [],
      stats: statsRes.ok ? (statsRes.data ?? null) : null
    })
  },

  async rebuild() {
    const a = api()
    await a.index.rebuild()
    await get().refresh()
  }
}))

type SetState = (patch: Partial<VaultState> | ((s: VaultState) => Partial<VaultState>)) => void
type GetState = () => VaultState

async function beginOpenFlow(root: string, set: SetState, get: GetState): Promise<void> {
  const a = api()
  const analysis = await a.vault.analyze(root)
  if (!analysis.ok || !analysis.data) {
    set({ error: analysis.error ?? 'analyze failed' })
    return
  }
  if (analysis.data.isAlreadyMindex) {
    const r = await a.vault.openWithMigration(root, { skipBackup: true })
    if (!r.ok) {
      set({ error: r.error ?? 'open failed' })
      return
    }
    set({ vault: r.data ?? null, pendingMigration: null })
    const rec = await a.vault.recent()
    const open = await a.vault.openWorkspaces()
    set({
      recent: rec.ok ? (rec.data ?? []) : [],
      openWorkspaces: open.ok ? (open.data ?? []) : []
    })
    await get().refresh()
    return
  }
  set({ pendingMigration: analysis.data })
}
