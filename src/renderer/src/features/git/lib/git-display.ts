import type { GitFileState } from '@shared/types'

/** Shared by the tree's `GitStatusBadge` and the Source Control modal, so a
 *  file's state reads the same letter/color/tooltip everywhere it appears. */
export function gitStateLetter(state: GitFileState): string {
  switch (state) {
    case 'modified':
      return 'M'
    case 'added':
      return 'A'
    case 'deleted':
      return 'D'
    case 'renamed':
      return 'R'
    case 'copied':
      return 'C'
    case 'untracked':
      return 'U'
    case 'unmerged':
      return '!'
    default:
      return ''
  }
}

export function gitStateColor(state: GitFileState): string {
  switch (state) {
    case 'modified':
      return 'text-amber-400'
    case 'added':
      return 'text-emerald-400'
    case 'deleted':
      return 'text-red-400'
    case 'renamed':
    case 'copied':
      return 'text-accent-1'
    case 'untracked':
      return 'text-muted-foreground'
    case 'unmerged':
      return 'text-red-500'
    default:
      return 'text-muted-foreground'
  }
}

export function gitStateTooltip(state: GitFileState): string {
  switch (state) {
    case 'modified':
      return 'Modified'
    case 'added':
      return 'Added (staged)'
    case 'deleted':
      return 'Deleted'
    case 'renamed':
      return 'Renamed'
    case 'copied':
      return 'Copied'
    case 'untracked':
      return 'Untracked'
    case 'unmerged':
      return 'Conflicted — needs resolving'
    default:
      return ''
  }
}
