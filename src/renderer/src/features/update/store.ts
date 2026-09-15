import { create } from 'zustand'

/**
 * Whether the update notice is on screen.
 *
 * Held apart from the update's own state because it is a different question.
 * The main process answers "is there a newer version and what is it doing";
 * this answers "is the person being shown it right now" — which the header
 * button and the notice both need, and neither owns.
 *
 * Deliberately not persisted. What survives a restart is the dismissal of a
 * particular version, which is a settled preference and already stored with
 * the settings. Closing the notice is not that: it means "not while I am doing
 * this", and next launch is a different sitting.
 */
interface UpdateNoticeState {
  /** The version whose notice was closed during this run, if any. */
  closedFor: string | null
  /** Bring it back — from the header button, which is the durable way in. */
  open(): void
  close(version: string): void
}

export const useUpdateNoticeStore = create<UpdateNoticeState>((set) => ({
  closedFor: null,
  open() {
    set({ closedFor: null })
  },
  close(version) {
    set({ closedFor: version })
  }
}))
