import { create } from 'zustand'
import type { NoteTypeDef } from '@shared/note-types'
import type { NoteTypeId } from '@shared/types'
import { api } from '@/platform/api'

/**
 * What note types this vault has, loaded once and kept live.
 *
 * This lived inside the types feature, beside the type editor's own tab and
 * preview flags, and five files outside that feature had to reach in for it —
 * the capture dialog, the breadcrumb, the editor's tab row, the sidebar's
 * type list and its home screen. None of them has anything to do with the
 * editor; they need the definitions the same way they need the note index.
 *
 * So the definitions are platform and the editor's view state is not. The
 * feature keeps `features/types/store.ts` for the latter.
 *
 * Loaded eagerly rather than when the editor opens, because the definitions
 * are what the left sidebar lists — and, before long, what the frontmatter
 * panel draws its editors from.
 *
 * Not registered in `vault-scoped.ts` like the graph's settings are: this one
 * already subscribes to the vault change itself, in `init`, because it also
 * has to answer a *type* change on the same vault. One subscription that
 * covers both beats two that overlap.
 */

interface NoteTypesState {
  defs: NoteTypeDef[]
  loading: boolean
  error: string | null
  initialized: boolean
  /** Ids with an unsaved edit in flight, so the editor can say so. */
  saving: string[]
  init(): Promise<() => void>
  refresh(): Promise<void>
  defOf(id: string): NoteTypeDef | null
  save(def: NoteTypeDef): Promise<void>
  reset(id: NoteTypeId): Promise<void>
  /** Remove a type this vault defined. Built-ins are reset, never removed. */
  remove(id: NoteTypeId): Promise<void>
}

export const useNoteTypesStore = create<NoteTypesState>((set, get) => ({
  defs: [],
  loading: false,
  error: null,
  initialized: false,
  saving: [],

  async init() {
    if (get().initialized) return () => undefined
    set({ initialized: true })
    await get().refresh()
    const off = api().on.typesChanged(() => {
      void get().refresh()
    })
    // Vault overrides live in `.mindex/types/`, so a different vault is a
    // different answer. This also covers the first open: the store is
    // initialised with the app, which happens before any vault exists.
    const offVault = api().on.vaultChanged(() => {
      void get().refresh()
    })
    return () => {
      off()
      offVault()
    }
  },

  async refresh() {
    set({ loading: true, error: null })
    try {
      // Guard the bridge: main and preload changes need a full Electron
      // restart, and without this the call throws and the pane sits on its
      // loading state forever.
      const bridge = api().types
      if (!bridge?.listDefs) {
        set({
          loading: false,
          error: 'Restart the app — this feature needs a main-process reload, not just a refresh.'
        })
        return
      }
      const r = await bridge.listDefs()
      if (r.ok && r.data) set({ defs: r.data, loading: false })
      else set({ loading: false, error: r.error ?? 'Could not read the note types.' })
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) })
    }
  },

  defOf(id) {
    return get().defs.find((d) => d.id === id) ?? null
  },

  async save(def) {
    // Optimistic: the editor is a form, and a field that snaps back to its old
    // value while the write lands would be unusable. The refresh triggered by
    // the change event reconciles it a moment later.
    set((s) => ({
      defs: s.defs.map((d) => (d.id === def.id ? { ...def, overridden: true } : d)),
      saving: [...new Set([...s.saving, def.id])]
    }))
    try {
      await api().types.saveDef(def)
    } finally {
      set((s) => ({ saving: s.saving.filter((id) => id !== def.id) }))
    }
  },

  async remove(id) {
    // Optimistic like `save`: the row is gone from the sidebar immediately,
    // and the change event reconciles the list a moment later.
    set((s) => ({ defs: s.defs.filter((d) => d.id !== id) }))
    await api().types.deleteDef(id)
    await get().refresh()
  },

  async reset(id) {
    const r = await api().types.resetDef(id)
    if (r.ok && r.data) {
      const reverted = r.data
      set((s) => ({ defs: s.defs.map((d) => (d.id === id ? reverted : d)) }))
    }
  }
}))
