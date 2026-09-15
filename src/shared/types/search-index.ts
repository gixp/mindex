/** What the index knows, and what it found wrong with the links. */

import type { NoteTypeId } from './notes'

export interface IndexStats {
  totalNotes: number
  totalAssets: number
  totalTasks: number
  byType: Record<string, number>
  buildMs: number
}

/** A link target nothing in the vault answers to, and who points at it. */
export interface DeadLink {
  target: string
  /** Relative paths of the notes containing the link. */
  sources: string[]
}

export interface OrphanNote {
  path: string
  relPath: string
  title: string
  type: NoteTypeId
}

export interface LinkHealth {
  dead: DeadLink[]
  orphans: OrphanNote[]
  checkedNotes: number
}
