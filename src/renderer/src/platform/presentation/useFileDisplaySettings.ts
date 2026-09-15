import { useEffect, useState } from 'react'
import { api } from '@/platform/api'
import { useVaultStore } from '@/platform/workspace'

/**
 * How a file or folder is drawn — read by the tree, the graph and the
 * centre-pane grid.
 *
 * All three are views of the same vault, so "does a file show an icon" has to
 * have one answer, not three. This used to be `useTreeRowDetails` (tree +
 * graph only) plus a second, separately-typed copy the grid kept for itself
 * (`folderView`) — see `VaultSettings.fileDisplay`'s own comment for why they
 * merged. Settings → Appearance writes `fileDisplay` and fires
 * `FILE_DISPLAY_EVENT`; every view listens here rather than keeping its own
 * copy.
 */

export interface FileDisplaySettings {
  modified: boolean
  dateField: 'modified' | 'created'
  /** Row layout only (tree/graph) — meaningless on the grid's cards. */
  datePosition: 'inline' | 'below'
  preview: boolean
  wrapTitle: boolean
  showFileIcons: boolean
  showFolderIcons: boolean
  /** Icons on CLAUDE.md / AGENTS.md / GEMINI.md, controlled separately. */
  showServiceFileIcons: boolean
  /** Grid layout only (centre pane) — independent, since a file card and a
   *  folder chip are different shapes and one "size" would size neither well. */
  fileCardSize: 'normal' | 'compact'
  folderChipSize: 'normal' | 'compact'
}

export const DEFAULT_FILE_DISPLAY: FileDisplaySettings = {
  modified: false,
  dateField: 'created',
  datePosition: 'inline',
  preview: false,
  wrapTitle: false,
  showFileIcons: true,
  showFolderIcons: true,
  showServiceFileIcons: true,
  fileCardSize: 'normal',
  folderChipSize: 'normal'
}

export const FILE_DISPLAY_EVENT = 'mindex:file-display-changed'

export function useFileDisplaySettings(): FileDisplaySettings {
  const vaultRoot = useVaultStore((s) => s.vault?.root ?? null)
  const [settings, setSettings] = useState<FileDisplaySettings>(DEFAULT_FILE_DISPLAY)

  useEffect(() => {
    if (!vaultRoot) {
      setSettings(DEFAULT_FILE_DISPLAY)
      return
    }
    let cancelled = false
    const read = (): void => {
      void api()
        .settings.getVault()
        .then((r) => {
          if (cancelled || !r.ok || !r.data) return
          setSettings({ ...DEFAULT_FILE_DISPLAY, ...(r.data.fileDisplay ?? {}) })
        })
    }
    read()
    window.addEventListener(FILE_DISPLAY_EVENT, read)
    return () => {
      cancelled = true
      window.removeEventListener(FILE_DISPLAY_EVENT, read)
    }
  }, [vaultRoot])

  return settings
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * "Jan 5" for this year, "Jan 5, 2026" once it isn't — the one place a file's
 * date gets formatted, for the tree, the graph and the grid alike.
 *
 * Used to be two implementations that quietly disagreed: the tree omitted the
 * year for the current one, the grid always showed it. Neither was wrong on
 * its own; a note's date just cannot mean two different strings depending on
 * which screen happens to be drawing it.
 */
export function formatFileDate(ms: number): string {
  const d = new Date(ms)
  if (isNaN(d.getTime())) return ''
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return sameYear
    ? `${MONTHS[d.getMonth()]} ${d.getDate()}`
    : `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}
