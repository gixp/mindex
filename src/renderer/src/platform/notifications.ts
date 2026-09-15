import { create } from 'zustand'

/**
 * Telling the person something happened.
 *
 * One concern, previously two stores. A transient notice lived in its own
 * store and the error dialog lived among the settings/view grab-bag, so a
 * feature that wanted to report an outcome had to know which of two unrelated
 * places to reach into, and the settings store collected four more consumers
 * that had nothing to do with settings.
 *
 * The distinction between the two kinds is real and kept: a toast is read or
 * ignored and is never the only record of an outcome, while the dialog is for
 * something that needs a decision or carries detail worth reading. What is not
 * real is their living apart.
 *
 * This is the first module of the app-state layer proper: readable from
 * anywhere, owned by no feature. Nothing here imports a feature or another
 * store.
 */

export interface Toast {
  id: string
  message: string
}

export interface ErrorNotice {
  open: boolean
  title: string
  message: string
}

interface NotificationsState {
  toasts: Toast[]
  /** A passing notice. Disappears on its own; nothing to act on. */
  pushToast(message: string): void
  dismissToast(id: string): void

  errorModal: ErrorNotice
  /** Something that needs reading, and possibly a decision. */
  showError(title: string, message: string): void
  closeError(): void
}

/**
 * Long enough to read one short sentence without hunting for the mouse; short
 * enough not to pile up.
 */
const AUTO_DISMISS_MS = 4500

const NO_ERROR: ErrorNotice = { open: false, title: '', message: '' }

export const useNotificationsStore = create<NotificationsState>((set, get) => ({
  toasts: [],

  pushToast(message) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    set((s) => ({ toasts: [...s.toasts, { id, message }] }))
    setTimeout(() => {
      get().dismissToast(id)
    }, AUTO_DISMISS_MS)
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },

  errorModal: NO_ERROR,

  showError(title, message) {
    set({ errorModal: { open: true, title, message } })
  },

  closeError() {
    set({ errorModal: NO_ERROR })
  }
}))

/**
 * Report an outcome from somewhere that is not a component.
 *
 * Both exist because most callers are stores, helpers and event handlers that
 * only ever want to say one thing and have no use for a hook.
 */
export function pushToast(message: string): void {
  useNotificationsStore.getState().pushToast(message)
}

export function showError(title: string, message: string): void {
  useNotificationsStore.getState().showError(title, message)
}
