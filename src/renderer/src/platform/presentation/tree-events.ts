/**
 * Cross-component signal telling TreePane to drop a freshly created note
 * straight into inline name-editing, the way Finder does for "untitled
 * folder". Creation happens from several places (palette, menu commands,
 * the folder-view "+" button) that don't share a component tree with
 * TreePane, so a window event is the simplest way to reach it — same
 * pattern as `mindex:open-icon-picker`.
 */
export function requestTreeInlineRename(note: { path: string; relPath: string }): void {
  const name = note.relPath.split('/').pop() ?? note.relPath
  window.dispatchEvent(
    new CustomEvent('mindex:tree-start-rename', {
      detail: { path: note.path, relPath: note.relPath, name }
    })
  )
}
