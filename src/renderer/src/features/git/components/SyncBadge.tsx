import type { SyncState } from '@shared/types'
import { useSyncStatus } from '@/features/git/lib/useSyncStatus'
import { useGitStatusStore } from '@/features/git/store'
import { useUiStore } from '@/platform/app-settings'
import { cn } from '@/ui/cn'
import { Icon } from '@/ui/icon'

/**
 * Ambient sync state, in the sidebar footer next to the workspace.
 *
 * Shows nothing at all when automatic sync is off, which is the default and
 * therefore most vaults — a permanently visible "sync: disabled" is a label
 * about a feature the user has not asked for.
 *
 * The one state it insists on is `conflict`: the loop has stopped and will
 * not restart until a person looks at it, so it says so in a colour that does
 * not blend in, and clicking it opens Source Control where the conflict is.
 */

const LABEL: Record<SyncState, string> = {
  disabled: 'Sync off',
  idle: 'Synced',
  syncing: 'Syncing…',
  conflict: 'Conflicts',
  offline: 'Offline',
  'auth-error': 'Sign-in needed',
  error: 'Sync failed'
}

const ICON: Record<SyncState, string> = {
  disabled: 'sync-ignored',
  idle: 'check',
  syncing: 'sync',
  conflict: 'warning',
  offline: 'debug-disconnect',
  'auth-error': 'key',
  error: 'error'
}

function toneFor(state: SyncState): string {
  if (state === 'conflict' || state === 'error') return 'text-red-400'
  if (state === 'auth-error') return 'text-amber-400'
  if (state === 'offline') return 'text-muted-foreground'
  return 'text-muted-foreground'
}

export function SyncBadge(): JSX.Element | null {
  const status = useSyncStatus()
  const snapshot = useGitStatusStore((s) => s.snapshot)
  const openSourceControl = useUiStore((s) => s.setSourceControlOpen)

  if (!status || status.mode === 'off') return null
  if (status.state === 'disabled') return null

  const ahead = snapshot?.branch.ahead ?? 0
  const behind = snapshot?.branch.behind ?? 0
  const drift =
    ahead > 0 || behind > 0
      ? `${behind > 0 ? `↓${behind}` : ''}${ahead > 0 ? `↑${ahead}` : ''}`
      : ''

  return (
    <button
      type="button"
      onClick={() => openSourceControl(true)}
      title={status.message ?? LABEL[status.state]}
      className={cn(
        'mx-2 mb-1 flex items-center gap-1.5 rounded-[8px] px-1.5 py-1 text-[11px] transition-colors',
        'hover:bg-bg-3 hover:text-foreground [&:hover_.codicon]:!text-foreground',
        toneFor(status.state)
      )}
    >
      <Icon
        name={ICON[status.state]}
        size={11}
        className={cn('codicon-inherit', status.state === 'syncing' && 'animate-spin')}
      />
      <span className="min-w-0 truncate">{LABEL[status.state]}</span>
      {drift ? <span className="ml-auto shrink-0 tabular-nums opacity-70">{drift}</span> : null}
    </button>
  )
}
