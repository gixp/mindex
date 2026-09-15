import { create } from 'zustand'
import type { CommentThreadView } from '@shared/comments'
import { api } from '@/platform/api'

interface CommentsState {
  /** Which note `threads` belongs to — guards against a late response for a
   *  note the user has already navigated away from. */
  path: string | null
  threads: CommentThreadView[]
  loading: boolean
  /** The thread the reader has singled out, highlighted harder in the note. */
  focusedId: string | null

  setFocused(id: string | null): void
  loadFor(path: string): Promise<void>
  /** Resolves with the created thread, or `null` if it could not be anchored. */
  add(
    path: string,
    quote: { exact: string; prefix: string; suffix: string; occurrence?: number },
    text: string
  ): Promise<CommentThreadView | null>
  reply(path: string, threadId: string, text: string): Promise<void>
  setResolved(path: string, threadId: string, resolved: boolean): Promise<void>
  remove(path: string, threadId: string): Promise<void>
  reset(): void
}

export const useCommentsStore = create<CommentsState>((set, get) => ({
  path: null,
  threads: [],
  loading: false,
  focusedId: null,

  setFocused(id) {
    set({ focusedId: id })
  },

  async loadFor(path) {
    // A focus belongs to the note it was set in; carrying it across would
    // emphasise a thread that is no longer on screen.
    set((prev) => ({ path, loading: true, focusedId: prev.path === path ? prev.focusedId : null }))
    const r = await api().comments.list(path)
    if (get().path !== path) return
    set({ threads: r.ok && r.data ? r.data : [], loading: false })
  },

  async add(path, quote, text) {
    // The anchor is captured in main against the markdown on disk, so what
    // travels is the quoted text, not editor positions — see `lib/doc-text`
    // for why the two coordinate systems are kept apart.
    const r = await api().comments.addFromQuote(path, quote, text)
    if (!r.ok || !r.data) return null
    await get().loadFor(path)
    return r.data
  },

  async reply(path, threadId, text) {
    await api().comments.reply(path, threadId, text)
    await get().loadFor(path)
  },

  async setResolved(path, threadId, resolved) {
    await api().comments.setResolved(path, threadId, resolved)
    await get().loadFor(path)
  },

  async remove(path, threadId) {
    await api().comments.delete(path, threadId)
    await get().loadFor(path)
  },

  reset() {
    set({ path: null, threads: [], loading: false, focusedId: null })
  }
}))
