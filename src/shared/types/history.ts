/** Stored versions of a note. */

/**
 * Who caused a version to be recorded.
 *
 * - `user` — written through Mindex's own editor/note operations.
 * - `agent` — an engine job (chat, folder context, living index) was running
 *   when the change landed. Agents write files with their own process rather
 *   than through Mindex, so this is a time-window attribution, not a mark
 *   made at the moment of the write.
 * - `external` — neither: another editor, a git operation, a sync client, or
 *   an agent running in a terminal tab, which Mindex does not track.
 *
 * Absent on versions recorded before attribution existed — treat as unknown
 * rather than as any of the three.
 */
export type HistoryAuthor = 'user' | 'agent' | 'external'

export interface HistoryVersion {
  id: string
  ts: number
  size?: number
  blobHash?: string
  deleted?: boolean
  author?: HistoryAuthor
  /** Free-text detail for an `agent` version, e.g. the engine feature. */
  authorDetail?: string
}
