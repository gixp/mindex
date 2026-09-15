/**
 * The note editor that currently has focus, if any — and, while it has a
 * text selection, a way to ask it to turn that selection into a link
 * instead of whatever else asking it were about to do.
 *
 * A plain module singleton, not a store: nothing here needs to be reactive
 * (`CommandPalette`'s keydown handler reads it once, at the moment ⌘K is
 * pressed), and only one note editor can plausibly have focus at a time.
 */

let requestLink: (() => boolean) | null = null

/** Registered by the focused `NoteEditor`; cleared on blur/unmount. `fn` returns whether it actually had a selection to act on. */
export function setLinkRequestHandler(fn: (() => boolean) | null): void {
  requestLink = fn
}

/**
 * Same shortcut, smarter behaviour: with a selection in the focused note,
 * ⌘K makes a link out of it instead of opening the command palette — the
 * same "context-dependent shortcut" idea Tolaria's own ⌘K follows.
 * Returns whether it claimed the keypress.
 */
export function tryLinkSelectionInstead(): boolean {
  return requestLink?.() ?? false
}
