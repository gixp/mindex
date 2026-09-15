/** The workspace itself: what is open, what is remembered, what a migration would do. */

import type { ProviderId } from './engine'
import type { FolderContextSettings } from './folder-context'
import type { SyncMode } from './git'

export interface VaultInfo {
  root: string
  name: string
  openedAt: number
}

export interface RecentVault {
  root: string
  name: string
  lastOpened: number
}

export interface VaultSettings {
  defaultProjectFolder: string
  iconOverrides?: Record<string, string>
  iconColorOverrides?: Record<string, string>
  livingIndexEnabled: boolean
  ignoredPaths: string[]
  /**
   * Scheduled git sync. Per vault, because the remote is — and absent means
   * `off`, so an existing vault never starts pushing because of an update.
   */
  autoSync?: { mode: SyncMode }
  /**
   * The agent tab strip.
   *
   * Read as `tabs ?? claudeTabs` and always written as `tabs`. The old key is
   * still read because it is on every existing user's disk: vault settings are
   * a shallow merge, so an unrecognised key is kept and silently ignored — the
   * failure mode of a straight rename would be everyone opening the app to an
   * empty tab bar with no error anywhere.
   */
  tabs?: {
    tabs: {
      id: string
      customTitle?: string
      mode?: 'terminal' | 'chat'
      /** For terminal tabs: which agent CLI runs in it, and on which model. */
      provider?: ProviderId
      model?: string
      chat?: {
        provider?: ProviderId
        model: string
        effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
        permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'auto'
      }
    }[]
    activeId: string
  }
  /** @deprecated Read-only, for migrating installs written before the rename. */
  claudeTabs?: VaultSettings['tabs']
  editorTabs?: {
    openPaths: string[]
    activePath: string | null
  }
  terminalTabs?: {
    tabs: {
      id: string
      customTitle?: string
      cwd?: string
    }[]
    activeId: string
    /**
     * @deprecated No longer read or written. Whether the terminal drawer is
     * open lives in `AppSettings.bottomPanelOpen`, which is where toggling it
     * writes. Keeping a second copy here meant a vault could reopen the drawer
     * the user had closed. Left in the type because it is still on disk for
     * existing vaults, and vault settings merge rather than replace.
     */
    open?: boolean
  }
  aiCreatedFiles?: string[]
  treeCollapsedFolders?: string[]
  treeSort?: 'name-asc' | 'name-desc' | 'mtime-desc' | 'mtime-asc'
  treeGroup?: 'folders-first' | 'files-first'
  /**
   * @deprecated Superseded by `fileDisplay`, which is what the tree, the
   * graph and the centre pane all read now. Kept in the type — and no longer
   * written to — only because it is still on disk for vaults that predate the
   * merge; see `fileDisplay`'s own comment and `getVaultSettings` for how an
   * existing vault's value migrates the first time it is read.
   */
  treeRowDetails?: {
    modified?: boolean
    dateField?: 'modified' | 'created'
    datePosition?: 'inline' | 'below'
    preview?: boolean
    wrapTitle?: boolean
    showFileIcons?: boolean
    showFolderIcons?: boolean
    showServiceFileIcons?: boolean
  }
  /**
   * How a file or folder is drawn — icon, date, density — wherever one is:
   * the sidebar tree, the graph, the centre-pane grid.
   *
   * This used to be two schemas (`treeRowDetails` for the tree, `folderView`
   * for the grid) that named the same idea differently and could disagree —
   * icons off in the tree, on in the grid — and a third place (the grid's own
   * icon lookup) skipped part of the precedence the other two shared, so a
   * managed file's provider mark only ever showed up two views out of three.
   * One schema means one answer, read the same way everywhere.
   *
   * Fields that only mean something on one surface stay distinct rather than
   * being forced to agree: `datePosition`/`preview`/`wrapTitle` describe a
   * *row*, so only the tree and the graph's tooltip use them; `fileCardSize`/
   * `folderChipSize` describe a *card*, so only the grid uses them. Everything
   * else — do files show an icon, do folders, do service files, is there a
   * date and which one — is one value because it answers one question
   * ("does this file show an icon") no matter which view is asking.
   */
  fileDisplay?: {
    showFileIcons?: boolean
    showFolderIcons?: boolean
    /** Icons on CLAUDE.md / AGENTS.md / GEMINI.md, controlled separately. */
    showServiceFileIcons?: boolean
    modified?: boolean
    dateField?: 'modified' | 'created'
    /** Tree/graph rows only — meaningless on the grid's cards. */
    datePosition?: 'inline' | 'below'
    preview?: boolean
    wrapTitle?: boolean
    /** Centre-pane grid only — independent, because a folder chip and a file
     *  card are two different shapes and one "size" knob would size neither
     *  well. */
    fileCardSize?: 'normal' | 'compact'
    folderChipSize?: 'normal' | 'compact'
  }
  /**
   * The graph view's own settings.
   *
   * Per-vault, like `treeSort` and `fileDisplay`: how far apart a graph
   * wants to be spread depends on how many notes are in it, so the answer
   * belongs to the vault rather than to the app. Nothing about *what* the
   * graph contains lives here — that follows the file tree.
   */
  graphView?: {
    /** Multiple of d3's default forces. 1 is stock. */
    spacing?: number
  }
  /**
   * @deprecated Superseded by `fileDisplay`. Kept in the type — and no
   * longer written to — only because it is still on disk for vaults that
   * predate the merge.
   */
  folderView?: {
    files?: {
      date?: boolean
      dateField?: 'modified' | 'created'
      icons?: boolean
      size?: 'normal' | 'compact'
    }
    folders?: {
      icons?: boolean
      size?: 'normal' | 'compact'
    }
  }
  recentFiles?: string[]
  treeHiddenPaths?: string[]
  treeUnhiddenPaths?: string[]
  folderContext?: FolderContextSettings
}

export interface VaultPolicy {
  writeIsolation: {
    enabled: boolean
    allowedPaths: string[]
    deniedPaths: string[]
  }
  aiAccessScope: {
    read: string[]
    write: string[]
  }
  encryption: { enabled: boolean }
  remoteSync: { enabled: boolean; url: string; schedule: string }
  transcription: { engine: string; language: string }
}

export type FileChangeEvent =
  | { kind: 'add'; path: string }
  | { kind: 'change'; path: string }
  | { kind: 'unlink'; path: string }
  | { kind: 'addDir'; path: string }
  | { kind: 'unlinkDir'; path: string }

export type MigrationActionKind =
  | 'create-vault-meta' // .mindex/settings.json + policy
  | 'seed-root-managed' // root CLAUDE.md / QUICK-IDEAS.md
  | 'enable-folder-context' // background per-folder CLAUDE.md generation

export interface MigrationAction {
  kind: MigrationActionKind
  title: string
  details?: string[]
}

export interface MigrationPlan {
  vaultRoot: string
  vaultName: string
  isAlreadyMindex: boolean
  actions: MigrationAction[]
  backupFileCount: number
  backupBytes: number
  proposedBackupPath: string
}
