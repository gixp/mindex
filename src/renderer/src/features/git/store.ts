import { create } from 'zustand'
import type { GitFileEntry, GitFileState, GitStatusSnapshot } from '@shared/types'
import { api } from '@/platform/api'

interface GitStatusState {
  snapshot: GitStatusSnapshot | null
  byPath: Record<string, GitFileEntry>
  initialized: boolean
  init(): Promise<() => void>
  refresh(): Promise<void>
}

function indexByPath(snapshot: GitStatusSnapshot): Record<string, GitFileEntry> {
  const map: Record<string, GitFileEntry> = {}
  for (const f of snapshot.files) map[f.path] = f
  return map
}

export const useGitStatusStore = create<GitStatusState>((set, get) => ({
  snapshot: null,
  byPath: {},
  initialized: false,

  async init() {
    if (get().initialized) return () => undefined
    set({ initialized: true })
    await get().refresh()
    const off = api().on.gitStatusChanged((snapshot) => {
      set({ snapshot, byPath: indexByPath(snapshot) })
    })
    return () => off()
  },

  async refresh() {
    const r = await api().git.status()
    if (r.ok && r.data) {
      set({ snapshot: r.data, byPath: indexByPath(r.data) })
    }
  }
}))

/** A file's most "interesting" state — worktree changes (what you'd act on
 *  next) win over index-only state, except a conflict always wins. */
export function effectiveFileState(entry: GitFileEntry): GitFileState {
  if (entry.conflicted) return 'unmerged'
  if (entry.worktreeState !== 'unmodified') return entry.worktreeState
  return entry.indexState
}

const STATE_RANK: Record<GitFileState, number> = {
  unmerged: 6,
  modified: 5,
  added: 4,
  renamed: 3,
  copied: 3,
  deleted: 2,
  untracked: 1,
  unmodified: 0,
  ignored: 0
}

/** Same `startsWith(prefix + '/')` scan `rolledUpStatusFor` uses for the
 *  Auto-Context folder dots — highest-ranked state among every file at or
 *  under `folderRel`, or `null` when nothing under it changed. */
export function rolledUpGitStatusFor(
  folderRel: string,
  byPath: Record<string, GitFileEntry>
): GitFileState | null {
  let best: GitFileState | null = null
  const prefix = folderRel ? `${folderRel}/` : ''
  for (const entry of Object.values(byPath)) {
    if (folderRel && entry.path !== folderRel && !entry.path.startsWith(prefix)) continue
    const state = effectiveFileState(entry)
    if (STATE_RANK[state] === 0) continue
    if (!best || STATE_RANK[state] > STATE_RANK[best]) best = state
  }
  return best
}
