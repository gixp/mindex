import { create } from 'zustand'

/**
 * Ask before doing something that cannot be taken back.
 *
 * The same shape as `promptText` next door, and for the same reason: the
 * callers that need it are actions in a list, a store, a command — none of
 * which can mount a dialog of their own. `ConfirmDialog` is the component for
 * a screen that already owns the state; this is for everything that does not.
 *
 * First caller: the palette's vault-wide file rename, which ran the instant it
 * was picked and reported its result to the developer console.
 */

export interface ConfirmRequest {
  title: string
  message: string
  confirmLabel?: string
  /** Red confirm button, for something that removes or rewrites. */
  destructive?: boolean
}

interface ConfirmState {
  request: (ConfirmRequest & { id: number }) | null
  settle: ((confirmed: boolean) => void) | null
  open(request: ConfirmRequest, settle: (confirmed: boolean) => void): void
  resolve(confirmed: boolean): void
}

let nextId = 0

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  request: null,
  settle: null,
  open(request, settle) {
    // One at a time; anything already waiting is answered "no" rather than
    // left hanging on a promise nobody will settle.
    get().settle?.(false)
    set({ request: { ...request, id: ++nextId }, settle })
  },
  resolve(confirmed) {
    const settle = get().settle
    set({ request: null, settle: null })
    settle?.(confirmed)
  }
}))

/** Resolves true if the person said yes, false on cancel or dismissal. */
export function confirmAction(request: ConfirmRequest): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirmStore.getState().open(request, resolve)
  })
}
