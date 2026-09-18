import { useFolderStatusStore } from '@/features/folder-context/store'
import { useContextStore } from '@/features/context/store'
import { useUiStore } from '@/platform/app-settings'
import { useHasProvider } from '@/platform/engines'
import { ownedContextWork, type OwnedContextWork } from '@/features/tree/lib/context-ownership'
import { cn } from '@/ui/cn'
import { api } from '@/platform/api'
import { Icon } from '@/ui/icon'
import { ProviderGlyph } from '@/ui/provider-glyph'

interface Props {
  folderRel: string
  /**
   * Whether this row is collapsed, which decides how far its button reaches —
   * see `ownedContextWork`. A collapsed row answers for everything beneath it;
   * an expanded one answers only for itself, because its children are on
   * screen with buttons of their own.
   */
  collapsed: boolean
}

export function FolderStatusDot({ folderRel, collapsed }: Props): JSX.Element | null {
  const byFolder = useFolderStatusStore((s) => s.byFolder)
  const overview = useContextStore((s) => s.overview)
  const provider = useUiStore((s) => s.settings?.engine?.provider) ?? 'claude'
  // In auto mode neither of the two manual-mode buttons below is something
  // the user needs to act on — a stale or missing context file resolves
  // itself. They collapse into one plain status dot instead.
  const autoContextEnabled = useUiStore((s) => s.settings?.engine?.autoContextEnabled) ?? false
  // The master switch. Off means nothing here is actionable — not a stale
  // dot, not a generate button — so the row shows nothing rather than a
  // control that would silently do nothing when clicked.
  const contextEngineEnabled = useUiStore((s) => s.settings?.engine?.contextEngineEnabled) !== false
  // The other half of the same fact: every branch below fires a real job at
  // whichever assistant Settings names. With none configured, that job would
  // only fail (auth) — same reasoning as the switch above, same result.
  const hasProvider = useHasProvider()

  const owned = ownedContextWork(folderRel, collapsed, byFolder, overview)
  const hidden = collapsed && ownsOnlyDescendants(folderRel, owned)

  if (!contextEngineEnabled || !hasProvider) return null
  const action = renderAction()
  if (!action) return null

  return <span className="ml-auto mr-1 inline-flex shrink-0 items-center">{action}</span>

  function renderAction(): JSX.Element | null {
    // Actively running or failed still wins over everything else — that's
    // the one state that genuinely needs a pulsing/red attention-grabber.
    if (owned.running.length > 0) {
      return (
        <span
          role="status"
          aria-label="Folder context status: running"
          title={hidden ? countLabel(owned.running.length, 'Updating') : 'Updating…'}
          className="shrink-0 inline-block size-2 animate-pulse rounded-full bg-accent-1"
        />
      )
    }

    if (owned.failed.length > 0) {
      return (
        <button
          type="button"
          aria-label={
            owned.failed.length > 1
              ? `Retry ${owned.failed.length} folder contexts`
              : 'Retry folder context'
          }
          title={failedTitle(owned, hidden, byFolder)}
          onClick={(e) => {
            e.stopPropagation()
            void run(owned.failed)
          }}
          className="inline-flex shrink-0 items-center justify-center"
        >
          <span className="size-2 rounded-full bg-red-500" />
        </button>
      )
    }

    const pending = [...owned.stale, ...owned.missing]
    if (pending.length === 0) return null

    // Auto mode: neither state needs a click — one plain dot covers "stale"
    // and "no context yet" alike, since both resolve on their own.
    if (autoContextEnabled) {
      return (
        <span
          role="status"
          aria-label="Folder context will update automatically"
          title={
            hidden
              ? countLabel(pending.length, 'Queued')
              : owned.stale.length > 0
                ? 'Context stale — will update automatically.'
                : 'No context yet — will generate automatically.'
          }
          className="shrink-0 inline-block size-2 rounded-full bg-accent-1"
        />
      )
    }

    // Stale — a context file exists but is behind the notes. A plain icon
    // button (no padding or background of its own, hover only shifts its
    // colour) reads as an action rather than a status light, since clicking
    // it does something.
    //
    // On a collapsed folder one press starts every regeneration it stands
    // for, including the ones that have no context file yet: same command,
    // and splitting them across two buttons would leave whichever lost the
    // draw with no way to be pressed at all.
    if (owned.stale.length > 0) {
      return (
        <button
          type="button"
          title={staleTitle(owned, hidden)}
          aria-label={
            pending.length > 1
              ? `Update ${pending.length} folder contexts`
              : 'Update folder context'
          }
          onClick={(e) => {
            e.stopPropagation()
            void run(pending)
          }}
          className={cn(
            'inline-flex shrink-0 items-center justify-center',
            'opacity-90 transition-opacity hover:opacity-100'
          )}
        >
          {/* Grey, not the app's blue. Blue is the colour of something that
              needs attention, and a folder whose context is a little behind
              does not — it is an offer to bring it up to date, sitting in a
              list where every row already competes for the eye. */}
          <Icon name="sync" size={12} className="codicon-grey" />
        </button>
      )
    }

    // Nothing stale, only folders with no context file at all — offer to
    // generate for the first time, using the current engine provider's own
    // mark so it reads as "this is who'd write it" rather than a generic
    // action icon.
    return (
      <button
        type="button"
        title={
          owned.missing.length > 1
            ? `${owned.missing.length} folders have no context. Click to generate all.`
            : hidden
              ? 'A subfolder has no context. Click to generate.'
              : 'No context. Click to generate.'
        }
        aria-label={
          owned.missing.length > 1
            ? `Generate ${owned.missing.length} folder contexts`
            : 'Generate folder context'
        }
        onClick={(e) => {
          e.stopPropagation()
          void run(owned.missing)
        }}
        className="inline-flex shrink-0 items-center justify-center"
      >
        <ProviderGlyph id={provider} size={12} />
      </button>
    )
  }
}

/**
 * Fired one call per folder rather than as a batch: `rescanFolder` is what the
 * engine queue already takes, and it decides for itself how many jobs run at
 * once. Nothing is awaited in sequence — a collapsed folder standing for six
 * regenerations should start six, not run them one after another.
 */
function run(folders: string[]): Promise<unknown> {
  return Promise.all(folders.map((rel) => api().folderContext.rescanFolder(rel)))
}

/** True when everything this row speaks for is out of sight beneath it. */
function ownsOnlyDescendants(folderRel: string, owned: OwnedContextWork): boolean {
  const all = [...owned.running, ...owned.failed, ...owned.stale, ...owned.missing]
  return all.length > 0 && !all.includes(folderRel)
}

function countLabel(count: number, verb: string): string {
  return count > 1 ? `${verb} ${count} subfolders…` : `${verb} a subfolder…`
}

function staleTitle(owned: OwnedContextWork, hidden: boolean): string {
  const count = owned.stale.length + owned.missing.length
  if (count > 1) return `${count} folders need context. Click to update all.`
  if (hidden) return 'A subfolder’s context is stale. Click to regenerate.'
  return 'Context stale. Click to regenerate.'
}

function failedTitle(
  owned: OwnedContextWork,
  hidden: boolean,
  byFolder: Record<string, { errorMessage?: string }>
): string {
  if (owned.failed.length > 1) {
    return `${owned.failed.length} folder contexts failed. Click to retry all.`
  }
  const rel = owned.failed[0] ?? ''
  const detail = byFolder[rel]?.errorMessage
  const where = hidden ? 'Subfolder sync failed' : 'Sync failed'
  return `${where}${detail ? `: ${detail}` : ''}. Click to retry.`
}
