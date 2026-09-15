import { create } from 'zustand'

/**
 * Choosing the icon for a file or folder — asked for from anywhere.
 *
 * This used to live inside the file tree: the picker was mounted there, and
 * any other screen that wanted it dispatched a custom browser event which the
 * tree happened to be listening for. Two things were wrong with that. It only
 * worked while the tree was on screen, so the same click did nothing with the
 * sidebar collapsed. And the contract was a hand-built event payload, which
 * nothing checks — a misspelled field simply did nothing.
 *
 * Now the request is a function call and the picker is mounted once, above
 * everything, next to the other things that are always available.
 *
 * The identity rule is the same one the rest of the presentation layer
 * follows, and getting it wrong is just as silent: a note is keyed by its
 * absolute path, a folder by its vault-relative one. Passing the wrong one
 * writes a choice nothing will ever read back.
 */

export interface IconPickerTarget {
  /** A note's absolute path, or a folder's vault-relative one. */
  key: string
  /** What to call it in the dialog's title. */
  label: string
}

interface IconPickerState {
  target: IconPickerTarget | null
  open(target: IconPickerTarget): void
  close(): void
}

export const useIconPickerStore = create<IconPickerState>((set) => ({
  target: null,
  open(target) {
    set({ target })
  },
  close() {
    set({ target: null })
  }
}))

/**
 * Ask to change something's icon.
 *
 * A plain function because most callers are click handlers deep in a render,
 * with no use for a hook.
 */
export function openIconPicker(key: string, label: string): void {
  useIconPickerStore.getState().open({ key, label })
}
