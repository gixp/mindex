import { effectiveFileState, rolledUpGitStatusFor, useGitStatusStore } from '@/features/git/store'
import { gitStateColor, gitStateLetter, gitStateTooltip } from '@/features/git/lib/git-display'
import { cn } from '@/ui/cn'

interface Props {
  relPath: string
  isFolder?: boolean
}

/** Unlike `FolderStatusDot`, this shows for every changed file — a git
 *  status badge is the point, not a rare attention-grabber — and renders
 *  `null` only for the true-clean case. */
export function GitStatusBadge({ relPath, isFolder = false }: Props): JSX.Element | null {
  const byPath = useGitStatusStore((s) => s.byPath)
  const state = isFolder
    ? rolledUpGitStatusFor(relPath, byPath)
    : byPath[relPath]
      ? effectiveFileState(byPath[relPath])
      : null
  if (!state || state === 'unmodified' || state === 'ignored') return null

  return (
    <span
      title={gitStateTooltip(state)}
      className={cn(
        'shrink-0 select-none text-[10px] font-semibold leading-none',
        gitStateColor(state)
      )}
    >
      {gitStateLetter(state)}
    </span>
  )
}
