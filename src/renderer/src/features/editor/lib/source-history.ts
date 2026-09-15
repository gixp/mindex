import { historyField } from '@codemirror/commands'
import { EditorState, type Extension } from '@codemirror/state'

/**
 * An undo stack that survives a trip to the rendered view and back.
 *
 * Switching modes unmounts the CodeMirror instance, and an unmounted editor
 * takes its history with it. So typing a paragraph in source, glancing at the
 * preview, and coming back left you unable to undo the paragraph — the stack
 * was empty and the edit was already on disk.
 *
 * The history is a state *field*, and a field's value cannot be assigned after
 * the state exists, so restoring one means building the state from JSON rather
 * than with `create`. That is the whole reason this is two functions instead of
 * a variable.
 */

/** The opaque blob a stack serialises to. `undefined` when there is none. */
export type SourceHistory = unknown

/** Take the stack out of a live state, to park while the editor is away. */
export function captureHistory(state: EditorState): SourceHistory {
  try {
    return (state.toJSON({ history: historyField }) as { history?: unknown }).history
  } catch {
    // A stack that will not serialise is not worth failing an unmount over.
    // The next mount starts a fresh one, which is what happened before this
    // existed anyway.
    return undefined
  }
}

/**
 * A state for `doc`, carrying `history` when there is one to carry.
 *
 * Falls back to a plain state whenever the blob is missing or unusable — a
 * corrupt stack must not cost you the editor.
 */
export function stateWithHistory(
  doc: string,
  extensions: Extension[],
  history: SourceHistory
): EditorState {
  if (history === undefined || history === null) {
    return EditorState.create({ doc, extensions })
  }
  try {
    return EditorState.fromJSON(
      { doc, selection: { main: 0, ranges: [{ anchor: 0, head: 0 }] }, history },
      { doc, extensions },
      { history: historyField }
    )
  } catch {
    return EditorState.create({ doc, extensions })
  }
}
