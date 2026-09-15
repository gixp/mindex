/**
 * Whether the paste about to happen was triggered with Shift held
 * (Cmd/Ctrl+Shift+V, "paste as plain text").
 *
 * A `ClipboardEvent` does not carry modifier flags in real browsers — unlike
 * a `DragEvent`, which extends `MouseEvent` and gets them for free — so the
 * only way to know Shift was down is to have already seen the keydown that
 * triggered the paste. One global capture-phase listener latches it; every
 * editor's own paste handler just reads the latch instead of installing its
 * own.
 */

let shiftHeld = false

window.addEventListener(
  'keydown',
  (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') shiftHeld = e.shiftKey
  },
  { capture: true }
)

export function pasteShiftHeld(): boolean {
  return shiftHeld
}
