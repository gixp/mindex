import { create } from 'zustand'
import type { NoteMeta } from '@shared/types'
import { api } from '@/platform/api'
import { useVaultStore } from '@/platform/workspace'
import { DEFAULT_HIDDEN_BASENAMES, basenameOf } from '@/platform/presentation/hiddenFiles'

interface HiddenFilesState {
  userHidden: Set<string>
  userUnhidden: Set<string>
  /**
   * Whether the tree's "Hidden" section is open.
   *
   * Lives here rather than inside `TreePane` because the graph draws whatever
   * the tree is showing, and that includes this: with the section closed the
   * hidden notes are not on screen, so they are not on the graph either. Two
   * copies of this flag would mean the two views disagreeing about what the
   * vault looks like, which is the whole thing the graph is meant not to do.
   *
   * Not persisted — it is a "peek", and reopening the app should start from
   * the tidy view, the same way the tree always has.
   */
  revealedAll: boolean
  setAll(hidden: Set<string>, unhidden: Set<string>): void
  setRevealedAll(v: boolean): void
  reset(): void
  hide(absPath: string): void
  unhide(absPath: string): void
  hideAllByBasename(notes: NoteMeta[], basename: string): void
  unhideAllByBasename(notes: NoteMeta[], basename: string): void
}

function persist(hidden: Set<string>, unhidden: Set<string>): void {
  if (!useVaultStore.getState().vault?.root) return
  void api().settings.setVault({
    treeHiddenPaths: [...hidden],
    treeUnhiddenPaths: [...unhidden]
  })
}

// Shared by the sidebar tree and the folder-view card grid, so hiding a file
// in one place hides it in the other — same source of truth, no drift.
export const useHiddenFilesStore = create<HiddenFilesState>((set, get) => ({
  userHidden: new Set(),
  userUnhidden: new Set(),
  revealedAll: false,

  setAll(hidden, unhidden) {
    set({ userHidden: hidden, userUnhidden: unhidden })
  },

  setRevealedAll(v) {
    set({ revealedAll: v })
  },

  reset() {
    set({ userHidden: new Set(), userUnhidden: new Set(), revealedAll: false })
  },

  hide(absPath) {
    const { userHidden, userUnhidden } = get()
    const nextHidden = new Set(userHidden)
    nextHidden.add(absPath)
    const nextUnhidden = new Set(userUnhidden)
    nextUnhidden.delete(absPath)
    set({ userHidden: nextHidden, userUnhidden: nextUnhidden })
    persist(nextHidden, nextUnhidden)
  },

  unhide(absPath) {
    const { userHidden, userUnhidden } = get()
    const nextHidden = new Set(userHidden)
    nextHidden.delete(absPath)
    const nextUnhidden = new Set(userUnhidden)
    if (DEFAULT_HIDDEN_BASENAMES.has(basenameOf(absPath))) nextUnhidden.add(absPath)
    set({ userHidden: nextHidden, userUnhidden: nextUnhidden })
    persist(nextHidden, nextUnhidden)
  },

  hideAllByBasename(notes, basename) {
    const paths = notes.filter((n) => basenameOf(n.path) === basename).map((n) => n.path)
    if (paths.length === 0) return
    const { userHidden, userUnhidden } = get()
    const nextHidden = new Set(userHidden)
    const nextUnhidden = new Set(userUnhidden)
    for (const p of paths) {
      nextHidden.add(p)
      nextUnhidden.delete(p)
    }
    set({ userHidden: nextHidden, userUnhidden: nextUnhidden })
    persist(nextHidden, nextUnhidden)
  },

  unhideAllByBasename(notes, basename) {
    const paths = notes.filter((n) => basenameOf(n.path) === basename).map((n) => n.path)
    if (paths.length === 0) return
    const isDefaultHidden = DEFAULT_HIDDEN_BASENAMES.has(basename)
    const { userHidden, userUnhidden } = get()
    const nextHidden = new Set(userHidden)
    const nextUnhidden = new Set(userUnhidden)
    for (const p of paths) {
      nextHidden.delete(p)
      if (isDefaultHidden) nextUnhidden.add(p)
    }
    set({ userHidden: nextHidden, userUnhidden: nextUnhidden })
    persist(nextHidden, nextUnhidden)
  }
}))
