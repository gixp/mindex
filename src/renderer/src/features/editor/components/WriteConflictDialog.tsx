import { useEditorStore } from '@/features/editor/store'
import { ConfirmDialog } from '@/ui/ConfirmDialog'

function basename(p: string): string {
  return p.split('/').pop() ?? p
}

/**
 * Shown when a save was refused because the file changed on disk while this
 * tab had unsaved edits — an external editor, a `git pull`, a sync client, or
 * an agent got there first.
 *
 * Mounted once for the whole app rather than per tab, and it deliberately
 * looks at *every* open tab, not just the active one: autosave stays paused
 * on a conflicted document, so a conflict left unnoticed in a background tab
 * would quietly stop saving that file.
 *
 * Discarding is wired to `onConfirm` (the destructive-styled button) rather
 * than to cancel, because `ConfirmDialog` routes Escape and overlay clicks to
 * `onCancel` — so an accidental dismissal has to land on the recoverable
 * choice. Overwriting the disk copy is recoverable: the history feature
 * snapshots external changes as they happen, so the overwritten version is
 * still in the file's history. Unsaved keystrokes exist nowhere but this tab.
 */
export function WriteConflictDialog(): JSX.Element | null {
  const openPaths = useEditorStore((s) => s.openPaths)
  const docs = useEditorStore((s) => s.docs)
  const overwrite = useEditorStore((s) => s.resolveConflictOverwrite)
  const reload = useEditorStore((s) => s.resolveConflictReload)

  const path = openPaths.find((p) => docs[p]?.conflict)
  if (!path) return null

  return (
    <ConfirmDialog
      open
      title="File changed on disk"
      message={
        <>
          <span className="font-medium text-foreground">{basename(path)}</span> was modified outside
          Mindex while you had unsaved changes here. Keeping yours overwrites the version on disk
          (it stays available in this file&rsquo;s history); discarding drops what you typed in this
          tab.
        </>
      }
      confirmLabel="Discard my edits"
      confirmIcon="discard"
      destructive
      cancelLabel="Keep my changes"
      onConfirm={() => void reload(path)}
      onCancel={() => void overwrite(path)}
    />
  )
}
