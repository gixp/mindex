import { create } from 'zustand'
import type { ContextOverview } from '@shared/suggestions'
import type { FolderContextFile } from '@shared/types'
import { api } from '@/platform/api'

interface ContextState {
  overview: ContextOverview | null
  loading: boolean
  error: string | null
  initialized: boolean
  /** Folders currently being regenerated, by folderRel. */
  rescanning: string[]
  /** Which section of the modal is showing. */
  section: string
  /**
   * Folder whose detail view is open, or null for the list. Lives in the store
   * rather than the component so Overview can jump straight into a detail.
   */
  selectedFolder: string | null
  /** Full parsed CLAUDE.md per folder, loaded on demand. */
  folderFiles: Record<string, FolderContextFile | null>
  loadingFolder: string | null
  /**
   * Loads the overview once and keeps it live — the tree's per-folder status
   * icons (FolderStatusDot) need `hasContextFile`/`aiDisabled` before the
   * user ever opens the Auto Context modal, not just when it opens.
   */
  init(): Promise<() => void>
  refresh(): Promise<void>
  rescanFolder(folderRel: string): Promise<void>
  rescanAll(): Promise<void>
  generateMissing(): Promise<number>
  setSection(section: string): void
  openFolder(folderRel: string): void
  closeFolder(): void
  loadFolder(folderRel: string, force?: boolean): Promise<void>
}

export const useContextStore = create<ContextState>((set, get) => ({
  overview: null,
  loading: false,
  error: null,
  initialized: false,
  rescanning: [],
  section: 'overview',
  selectedFolder: null,
  folderFiles: {},
  loadingFolder: null,

  async init() {
    if (get().initialized) return () => undefined
    set({ initialized: true })
    await get().refresh()
    const off = api().on.folderContextUpdated(() => {
      void get().refresh()
    })
    return () => off()
  },

  setSection(section) {
    set({ section, selectedFolder: null })
  },

  openFolder(folderRel) {
    set({ section: 'folders', selectedFolder: folderRel })
    void get().loadFolder(folderRel)
  },

  closeFolder() {
    set({ selectedFolder: null })
  },

  async loadFolder(folderRel, force = false) {
    if (!force && folderRel in get().folderFiles) return
    set({ loadingFolder: folderRel })
    try {
      const r = await api().folderContext.read(folderRel)
      set((s) => ({
        folderFiles: { ...s.folderFiles, [folderRel]: r.ok ? (r.data ?? null) : null },
        loadingFolder: null
      }))
    } catch {
      set((s) => ({
        folderFiles: { ...s.folderFiles, [folderRel]: null },
        loadingFolder: null
      }))
    }
  },

  async refresh() {
    set({ loading: true, error: null })
    try {
      // Guard the bridge itself: main/preload changes need an Electron restart
      // (renderer HMR alone won't pick them up), and without this the call
      // throws and the modal is stuck on its loading state forever.
      const bridge = api().context
      if (!bridge?.overview) {
        set({
          loading: false,
          error:
            'The context bridge is not loaded. Restart the app (main-process changes need a full restart, not just a reload).'
        })
        return
      }
      const r = await bridge.overview()
      if (r.ok && r.data) set({ overview: r.data, loading: false })
      else set({ loading: false, error: r.error ?? 'Could not read the vault context.' })
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) })
    }
  },

  async rescanFolder(folderRel) {
    if (get().rescanning.includes(folderRel)) return
    set((s) => ({ rescanning: [...s.rescanning, folderRel] }))
    try {
      await api().folderContext.rescanFolder(folderRel)
    } finally {
      // The job runs in the background; drop the spinner and let the user
      // refresh once the engine reports it done. Drop the cached file too so
      // reopening the detail re-reads it rather than showing the old text.
      set((s) => {
        const next = { ...s.folderFiles }
        delete next[folderRel]
        return { rescanning: s.rescanning.filter((f) => f !== folderRel), folderFiles: next }
      })
    }
  },

  async rescanAll() {
    await api().folderContext.rescanAll()
  },

  async generateMissing() {
    const targets =
      get().overview?.folders.filter((folder) => !folder.hasContextFile && !folder.aiDisabled) ?? []
    if (targets.length === 0) return 0
    const rels = targets.map((folder) => folder.folderRel)
    set((s) => ({ rescanning: [...new Set([...s.rescanning, ...rels])] }))
    try {
      await Promise.all(rels.map((folderRel) => api().folderContext.rescanFolder(folderRel)))
      return rels.length
    } finally {
      set((s) => ({ rescanning: s.rescanning.filter((folderRel) => !rels.includes(folderRel)) }))
    }
  }
}))
