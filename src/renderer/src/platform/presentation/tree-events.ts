/**
 * Cross-component signal telling TreePane to drop a freshly created note or
 * folder straight into inline name-editing, the way Finder does for "untitled
 * folder". Creation happens from several places (palette, menu commands,
 * the folder-view "+" button) that don't share a component tree with
 * TreePane, so a window event is the simplest way to reach it — same
 * pattern as `mindex:open-icon-picker`.
 *
 * A row is addressed the way the tree itself keys it: a note by its absolute
 * path, a folder by its vault-relative one. That asymmetry is the tree's, not
 * this module's — see `TreeNode.path` — and sending the wrong one simply
 * matches no row, which looks exactly like the signal never arrived.
 */
export type TreeRenameKind = 'note' | 'folder'

export interface TreeRenameRequest {
  /** Absolute for a note, vault-relative for a folder. */
  path: string
  /** Always vault-relative. The tree needs it to unfold the folders above
   *  the row before the row can be put into an input. */
  relPath: string
  /** The name to start the input with, already selected. */
  name: string
  kind: TreeRenameKind
}

function dispatch(detail: TreeRenameRequest): void {
  window.dispatchEvent(new CustomEvent('mindex:tree-start-rename', { detail }))
}

export function requestTreeInlineRename(note: { path: string; relPath: string }): void {
  dispatch({
    path: note.path,
    relPath: note.relPath,
    name: note.relPath.split('/').pop() ?? note.relPath,
    kind: 'note'
  })
}

/**
 * The same, for a folder that has just been made.
 *
 * A new folder used to be called "Untitled folder" and left that way: naming
 * it meant finding it, and until this existed there was no way to rename a
 * folder at all. Now it is created under that placeholder and handed
 * immediately to the input, so the name you type is the only one it ever
 * really has.
 */
export function requestTreeInlineRenameFolder(folder: { relPath: string }): void {
  dispatch({
    path: folder.relPath,
    relPath: folder.relPath,
    name: folder.relPath.split('/').pop() ?? folder.relPath,
    kind: 'folder'
  })
}
