/** The per-folder context the agents read. */

export interface FolderContextFile {
  folderRel: string
  generatedAt?: string
  syncIntervalHours?: number
  /** Exact file text for read-only context inspection in the renderer. */
  rawContent?: string
  purpose: string
  keyConcepts: string
  relationships: string
  howToNavigate: string
  passthrough: string[]
}

export interface FolderContextSnapshot {
  files: FolderContextFile[]
  builtAt: number
}

export type FolderSyncStatus = 'idle' | 'pending' | 'running' | 'just-done' | 'failed'

export interface FolderStatusEntry {
  folderRel: string
  status: FolderSyncStatus
  lastChange?: number
  lastSuccess?: number
  nextScheduledAt?: number
  errorMessage?: string
}

export interface FolderContextSettings {
  /** Posix paths excluded from AI access. A trailing slash covers descendants.
   *  The only folder-context setting the engine actually reads — scheduling
   *  knobs (mode/interval/defer) were declared here but never implemented. */
  excludedPaths?: string[]
}
