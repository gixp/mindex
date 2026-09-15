import { create } from 'zustand'

export interface PromptRequest {
  title: string
  /** Optional line under the title, e.g. an example of the expected format. */
  message?: string
  placeholder?: string
  initialValue?: string
  /** Renders a textarea instead of a single-line input. */
  multiline?: boolean
  confirmLabel?: string
}

interface PromptState {
  request: (PromptRequest & { id: number }) | null
  settle: ((value: string | null) => void) | null
  open(request: PromptRequest, settle: (value: string | null) => void): void
  resolve(value: string | null): void
}

let nextId = 0

const usePromptStore = create<PromptState>((set, get) => ({
  request: null,
  settle: null,
  open(request, settle) {
    // Only one prompt can be up at a time; anything already waiting is
    // cancelled rather than left hanging forever.
    get().settle?.(null)
    set({ request: { ...request, id: ++nextId }, settle })
  },
  resolve(value) {
    const settle = get().settle
    set({ request: null, settle: null })
    settle?.(value)
  }
}))

export { usePromptStore }

/**
 * Ask the user for a string. Resolves with the text, or `null` if cancelled.
 *
 * Replaces `window.prompt`, which **throws** in Electron ("prompt() is not
 * supported.") rather than returning null — so every caller that used it did
 * nothing at all, silently. Verified against Electron 34.5.8, not assumed.
 */
export function promptText(request: PromptRequest): Promise<string | null> {
  return new Promise((resolve) => {
    usePromptStore.getState().open(request, resolve)
  })
}
