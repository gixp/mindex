/** Odds and ends belonging to the app rather than to any one subject. */

import type { NoteTypeId } from './notes'

/** One (day, kind) bucket of recorded activity — the same shape the landing's
 *  account Overview heatmap reads from `user_activity`. */
export type ActivityKind = 'notes' | 'ai'

export interface ActivityRow {
  day: string
  kind: ActivityKind
  count: number
}

export type MenuCommand =
  | { kind: 'vault.pick' }
  | { kind: 'vault.create' }
  | { kind: 'vault.open'; root: string }
  | { kind: 'vault.close' }
  | { kind: 'vault.revealInFinder' }
  | { kind: 'note.new'; type: NoteTypeId }
  | { kind: 'note.save' }
  | { kind: 'palette.open' }
  | { kind: 'panel.toggleLeft' }
  | { kind: 'panel.toggleRight' }
  | { kind: 'index.rebuild' }
  | { kind: 'help.reportBug' }

export type BugReportCategory = 'bug' | 'feedback' | 'feature'

// A user-submitted bug report / feedback. Explicit (the user typed it and hit
// send), so it is allowed to leave the machine. No note content is included.
export interface BugReport {
  category: BugReportCategory
  title: string
  description: string
  email?: string
}
