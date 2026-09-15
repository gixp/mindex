import { useEffect, useId, useMemo, useState } from 'react'
import { ProviderGlyph } from '@/ui/provider-glyph'
import type { FolderContextMetrics } from '@shared/suggestions'
import { useUiStore } from '@/platform/app-settings'
import { useContextStore } from '@/features/context/store'
import { useFolderStatusStore } from '@/features/folder-context/store'
import { useJobsStore } from '@/features/engine/store'
import { useVaultStore } from '@/platform/workspace'
import { StandardDialog } from '@/ui/StandardDialog'
import { ConfirmDialog } from '@/ui/ConfirmDialog'
import { Icon } from '@/ui/icon'
import { Switcher } from '@/ui/switcher'
import { ProviderRequiredNotice } from '@/ui/ProviderRequiredNotice'
import { useHasProvider } from '@/platform/engines'
import { cn } from '@/ui/cn'
import { api } from '@/platform/api'
import { pushToast } from '@/platform/notifications'
import { contextHealth } from '@/features/context/components/contextHealth'
import { fmtInt } from '@/features/context/components/sectionParts'
import { openDocument } from '@/platform/documents'

/**
 * The buckets a folder can be in.
 *
 * 'done' is deliberately not the engine's old 'just-done' (a 10-second window
 * after a run). A folder belongs in Done when its briefing is actually current
 * — that is what the user is asking when they look at this list — so the
 * bucket is derived from context health, not from how recently a job happened
 * to finish. Live job states still win, because "running right now" is more
 * useful than "was current a moment ago".
 */
type Bucket = 'behind' | 'running' | 'done' | 'disabled'

// Work first, then what's settled. Running sits last and only appears while
// something is actually in flight — it is a transient state, not a place you
// go, so an always-present empty tab would just be a dead slot in the strip.
const BUCKETS: Bucket[] = ['behind', 'done', 'disabled', 'running']

/**
 * A folder's live job state. Queued, generating and failed all share the
 * Running tab — they are three moments of the same in-flight run, and
 * splitting them into their own tabs meant three near-empty lists you had to
 * check in turn. The per-row badge says which moment a folder is in.
 */
type JobState = 'running' | 'pending' | 'failed'

const JOB_META: Record<JobState, { label: string; dot: string; tone: string }> = {
  running: { label: 'Running', dot: 'bg-accent-1', tone: 'text-accent-1-hover' },
  pending: { label: 'Pending', dot: 'bg-yellow-400', tone: 'text-yellow-300' },
  failed: { label: 'Failed', dot: 'bg-red-500', tone: 'text-red-300' }
}

/*
 * One quiet treatment for every per-row action.
 *
 * These used to be three different colours side by side — amber to
 * regenerate, blue to generate, grey to open — plus emerald to re-enable.
 * Four accents competing across a list of near-identical rows made the list
 * read as an alert panel rather than a table, and the amber/blue split drew
 * a hard visual distinction between two actions that do the same thing
 * (run the engine on this folder). Rows are now uniformly quiet; the one
 * emphasised control is the bulk button in the toolbar.
 */
// Under the pointer a button fills with its own edge. The quiet border and
// the second background level are the same value by design, so the outline
// becomes a surface rather than becoming some other colour.
/**
 * Open, Generate, Pause — the small controls on a folder's row.
 *
 * They had no fill at all, which left them as outlines on the modal's own
 * surface, and a hover that named a surface one level up — the direction that
 * reads as raised on a dark ground and as white on a light one. They rest on
 * a step away from the page now, and hover one step further, so both themes
 * get the same gesture rather than the same numbers.
 */
const ROW_ACTION =
  'inline-flex h-[26px] items-center rounded-[8px] border border-bd-1 bg-accent px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30'

function jobStateOf(status?: string): JobState | undefined {
  if (status === 'running' || status === 'pending' || status === 'failed') return status
  return undefined
}

// `hint` is a hover tooltip only — the buckets are self-explanatory enough on
// screen that a permanent line of explanatory text under the tabs is noise.
const BUCKET_META: Record<Bucket, { label: string; hint: string; dot: string }> = {
  behind: {
    label: 'Needs update',
    hint: 'Notes changed since the briefing, or there is none yet',
    dot: 'bg-amber-400'
  },
  running: {
    label: 'Running',
    hint: 'Queued, generating now, or failed on the last run',
    dot: 'bg-accent-1'
  },
  done: {
    label: 'Up to date',
    hint: 'Briefing exists and nothing has changed since',
    dot: 'bg-emerald-400'
  },
  // Grey, not red: excluding a folder from AI access is a choice the user made,
  // not a failure. It is out of the work queue rather than in trouble.
  disabled: {
    label: 'Disabled',
    hint: 'AI access is turned off for this folder',
    dot: 'bg-muted-foreground/40'
  }
}

interface FolderRow {
  folderRel: string
  bucket: Bucket
  /** Set only inside the Running bucket, to say which moment of a run it is. */
  jobState?: JobState
  metrics?: FolderContextMetrics
  errorMessage?: string
  nextScheduledAt?: number
  lastSuccess?: number
  hasContextFile: boolean
  aiDisabled: boolean
  /** Which folder carries the exclusion — an ancestor, or the folder itself. */
  disabledBy?: string
}

export function EngineStatusModal(): JSX.Element | null {
  const open = useUiStore((s) => s.contextEngineOpen)
  const setOpen = useUiStore((s) => s.setContextEngineOpen)
  const hasProvider = useHasProvider()
  const byFolder = useFolderStatusStore((s) => s.byFolder)
  const refreshStatus = useFolderStatusStore((s) => s.refresh)
  const overview = useContextStore((s) => s.overview)
  const refreshOverview = useContextStore((s) => s.refresh)
  const paused = useJobsStore((s) => s.paused)
  const activeCount = useJobsStore((s) => s.activeCount)
  const enginePause = useJobsStore((s) => s.pause)
  const engineResume = useJobsStore((s) => s.resume)
  // The engine that will actually run these jobs, from Settings — the same
  // source main's engineChoice() reads, so the marks can't disagree with it.
  const [tab, setTab] = useState<Bucket>('behind')
  // Holds the exact folders the confirm is about, captured when it opens — the
  // live list can shift underneath it as the engine finishes runs.
  const [confirmUpdate, setConfirmUpdate] = useState<string[] | null>(null)

  useEffect(() => {
    if (!open) return
    void refreshStatus()
    void refreshOverview()
    const off = api().on.folderContextUpdated(() => {
      void refreshStatus()
      void refreshOverview()
    })
    return () => off()
  }, [open, refreshOverview, refreshStatus])

  const rows = useMemo<FolderRow[]>(() => {
    const folders = overview?.folders ?? []
    const seen = new Set<string>()
    const out: FolderRow[] = []

    for (const metrics of folders) {
      const status = byFolder[metrics.folderRel]
      const health = contextHealth(metrics, status)
      const jobState = jobStateOf(status?.status)
      const bucket: Bucket = jobState
        ? 'running'
        : health === 'disabled'
          ? 'disabled'
          : health === 'current'
            ? 'done'
            : 'behind'
      seen.add(metrics.folderRel)
      out.push({
        folderRel: metrics.folderRel,
        bucket,
        jobState,
        metrics,
        errorMessage: status?.errorMessage,
        nextScheduledAt: status?.nextScheduledAt,
        lastSuccess: status?.lastSuccess,
        hasContextFile: metrics.hasContextFile,
        aiDisabled: metrics.aiDisabled,
        disabledBy: metrics.disabledBy
      })
    }

    // Folders the engine is tracking that the overview snapshot hasn't caught
    // up with yet — without this they'd vanish from the list mid-run.
    for (const entry of Object.values(byFolder)) {
      if (seen.has(entry.folderRel)) continue
      if (entry.status === 'idle') continue
      const jobState = jobStateOf(entry.status)
      out.push({
        folderRel: entry.folderRel,
        bucket: jobState ? 'running' : 'done',
        jobState,
        errorMessage: entry.errorMessage,
        nextScheduledAt: entry.nextScheduledAt,
        lastSuccess: entry.lastSuccess,
        hasContextFile: false,
        aiDisabled: false
      })
    }

    return out.sort((a, b) => a.folderRel.localeCompare(b.folderRel))
  }, [byFolder, overview?.folders])

  const counts = useMemo(() => {
    const out: Record<Bucket, number> = {
      behind: 0,
      running: 0,
      done: 0,
      disabled: 0
    }
    for (const row of rows) out[row.bucket] += 1
    return out
  }, [rows])

  const visibleBuckets = BUCKETS.filter((bucket) => bucket !== 'running' || counts.running > 0)

  // The Running tab can vanish under the user while they are standing on it —
  // the last job finishes and the bucket empties — so fall back rather than
  // leaving them on a tab that is no longer in the strip.
  useEffect(() => {
    if (tab === 'running' && counts.running === 0) setTab('behind')
  }, [counts.running, tab])

  // "Running" has to mean work is actually happening. Not-paused with an empty
  // queue is Idle — claiming to run while doing nothing made the badge useless
  // as a signal, since it read the same either way.
  const engine = paused
    ? {
        label: 'Paused',
        hint: 'The engine is paused — queued folders wait until you resume',
        className: 'border-border-strong bg-bg-3 text-muted-foreground',
        rule: 'bg-border-strong',
        icon: undefined,
        canToggle: true
      }
    : activeCount > 0
      ? {
          label: 'Running',
          hint: `Generating ${activeCount} folder ${activeCount === 1 ? 'context' : 'contexts'} now`,
          className: 'border-accent-1/40 bg-accent-1/[0.12] text-accent-1-hover',
          rule: 'bg-accent-1/35',
          icon: 'codicon-blue',
          canToggle: true
        }
      : {
          // Nothing is happening, so there is nothing to pause — the badge is
          // a plain status word rather than a control.
          label: 'Ready',
          hint: 'Nothing queued — the engine is watching for changes',
          className: 'border-border-strong bg-bg-3 text-muted-foreground',
          rule: 'bg-border-strong',
          icon: undefined,
          canToggle: false
        }

  const visible = rows.filter((row) => row.bucket === tab)

  if (!open) return null

  return (
    <>
      <StandardDialog
        open
        onOpenChange={setOpen}
        // Same mark as the header button that opens this dialog and the
        // AGENTS.md row icon — default grey, no colour override needed.
        icon="lightbulb-sparkle"
        title="Context Management"
        // No filename here any more: what the briefing is called depends on
        // which agent is selected — three different names — so naming one
        // was wrong for two of the three, and the name is not the point.
        subtitle="A short briefing per folder, so the assistant knows what is in one without reading all of it."
        width={720}
        height={560}
      >
        {/* No column of its own: the frame is already one, with the standard
            gap between its children. Wrapping them here put the toolbar and
            the list inside a single child, so the gap fell outside both. */}
        <>
          {/* The tabs, the bulk button and every row all name an engine that
              would run them — with none configured, replaced wholesale by
              the same notice every other "no assistant" surface in the app
              shows, rather than a toolbar and an empty list that leave the
              question of why unanswered. */}
          {!hasProvider ? (
            <ProviderRequiredNotice
              className="min-h-0 flex-1"
              message="Connect an assistant to keep folder context up to date."
              actionLabel="Open Settings"
              onAction={() => {
                setOpen(false)
                useUiStore.getState().setSettingsOpen(true)
              }}
            />
          ) : (
            <>
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                <Switcher<Bucket>
                  options={visibleBuckets.map((bucket) => ({
                    key: bucket,
                    label: BUCKET_META[bucket].label,
                    count: counts[bucket],
                    dot: BUCKET_META[bucket].dot,
                    hint: BUCKET_META[bucket].hint
                  }))}
                  active={tab}
                  onChange={setTab}
                />

                {/* Scoped to the open tab, and labelled with that tab's own
                    count, so the button can only ever act on the rows you
                    can see. */}
                {/* Pausing the engine used to sit in the window's header.
                    Nothing belongs there but the title and the way out, and
                    this is a control over the same work the button beside it
                    starts — so it lives with it. */}
                {engine.canToggle ? (
                  <button
                    type="button"
                    onClick={() => (paused ? void engineResume() : void enginePause())}
                    title={paused ? 'Resume the engine' : 'Pause the engine'}
                    aria-label={paused ? 'Resume the engine' : 'Pause the engine'}
                    className={cn(ROW_ACTION, 'ml-auto h-7 gap-1.5')}
                  >
                    <Icon name={paused ? 'debug-start' : 'debug-pause'} size={11} />
                    {paused ? 'Resume' : 'Pause'}
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={visible.length === 0 || tab === 'disabled'}
                  onClick={() => setConfirmUpdate(visible.map((row) => row.folderRel))}
                  title={
                    tab === 'disabled'
                      ? 'These folders are excluded from AI access — enable them first'
                      : `Regenerate the ${BUCKET_META[tab].label.toLowerCase()} folders`
                  }
                  className={cn(ROW_ACTION, 'h-7 gap-1.5')}
                >
                  <Icon name="sync" size={11} />
                  Update all
                </button>
              </div>

              <div className="tree-scroll min-h-0 flex-1 overflow-auto">
                {visible.length === 0 ? (
                  <EmptyBucket bucket={tab} />
                ) : (
                  // No box around the list: rows are separated from each other,
                  // but the group has no top edge above the first row or bottom
                  // edge under the last.
                  <div className="overflow-hidden">
                    {visible.map((row, index) => (
                      <FolderRowView
                        key={row.folderRel}
                        row={row}
                        first={index === 0}
                        onOpenContext={() => setOpen(false)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </>
      </StandardDialog>

      <ConfirmDialog
        open={confirmUpdate !== null}
        title={`Update ${confirmUpdate?.length ?? 0} folder contexts?`}
        message={
          <p>
            This will run the selected engine for the{' '}
            <span className="font-medium text-foreground">{confirmUpdate?.length ?? 0}</span>{' '}
            folders in this tab, rewriting existing CLAUDE.md files and creating any that are
            missing. It can take time and use your model quota.
          </p>
        }
        confirmLabel="Update"
        confirmIcon="sync"
        destructive
        onCancel={() => setConfirmUpdate(null)}
        onConfirm={() => {
          const folderRels = confirmUpdate ?? []
          setConfirmUpdate(null)
          void Promise.all(
            folderRels.map((folderRel) => api().folderContext.rescanFolder(folderRel))
          )
        }}
      />
    </>
  )
}

function FolderRowView({
  row,
  first,
  onOpenContext
}: {
  row: FolderRow
  first: boolean
  onOpenContext(): void
}): JSX.Element {
  const vault = useVaultStore((s) => s.vault)
  const iconOverrides = useUiStore((s) => s.iconOverrides)
  const iconColorOverrides = useUiStore((s) => s.iconColorOverrides)
  // Whichever engine Settings names — the same one these buttons will spend.
  const engineProvider = useUiStore((s) => s.settings?.engine?.provider) ?? 'claude'
  const errorId = useId()
  const [errorExpanded, setErrorExpanded] = useState(false)
  const hasError = row.jobState === 'failed'
  const fullError = row.errorMessage?.trim() || 'No error details were provided by the engine.'
  // Same source the sidebar tree uses, so a folder the user gave a custom icon
  // or colour keeps that identity here instead of becoming an anonymous dot.
  const iconName = iconOverrides[row.folderRel] ?? 'folder'
  const iconColor = iconColorOverrides[row.folderRel] || 'text-muted-foreground'

  // An exclusion set on an ancestor covers this folder too, so name the folder
  // that actually carries it rather than implying this row owns the setting.
  const inheritedFrom = row.disabledBy && row.disabledBy !== row.folderRel ? row.disabledBy : null

  async function enableAi(): Promise<void> {
    const target = row.disabledBy ?? row.folderRel
    const r = await api().folderContext.enableAiSync(target)
    if (!r.ok) {
      pushToast(`Could not let the assistant read "${target}". ${r.error ?? ''}`.trim())
      return
    }
    await Promise.all([
      useContextStore.getState().refresh(),
      useFolderStatusStore.getState().refresh()
    ])
  }

  async function openContext(): Promise<void> {
    if (!vault || !row.hasContextFile) return
    const separator = vault.root.includes('\\') ? '\\' : '/'
    const path = [vault.root.replace(/[\\/]+$/, ''), ...row.folderRel.split('/'), 'CLAUDE.md'].join(
      separator
    )
    await openDocument(path)
    onOpenContext()
  }

  return (
    <div className={cn('text-[12px]', !first && 'border-t border-border')}>
      <div
        className={cn(
          'flex min-w-0 items-center gap-2.5 px-2 py-2',
          errorExpanded && 'bg-red-500/[0.035]'
        )}
      >
        <Icon name={iconName} size={13} className={cn('shrink-0', iconColor)} />

        <button
          type="button"
          onClick={hasError ? () => setErrorExpanded((v) => !v) : () => void openContext()}
          disabled={!hasError && !row.hasContextFile}
          aria-expanded={hasError ? errorExpanded : undefined}
          aria-controls={hasError ? errorId : undefined}
          title={hasError ? 'Show the full error' : row.folderRel}
          className="min-w-0 flex-1 text-left disabled:cursor-default"
        >
          <span className="block truncate font-mono text-foreground">
            {row.folderRel || '(root)'}
          </span>
        </button>

        <span className="flex shrink-0 items-center gap-2 text-[10px] text-muted-foreground">
          {/* Queued / generating / failed all live in the Running tab, so each
              row has to say which of the three it actually is. */}
          {row.jobState ? (
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-[5px] bg-bg-3 px-1.5 py-0.5',
                JOB_META[row.jobState].tone
              )}
            >
              <span
                className={cn(
                  'inline-block size-1.5 rounded-full',
                  JOB_META[row.jobState].dot,
                  row.jobState === 'running' && 'animate-pulse'
                )}
              />
              {JOB_META[row.jobState].label}
            </span>
          ) : null}
          {row.metrics ? (
            <span>
              {fmtInt(row.metrics.noteCount)} {row.metrics.noteCount === 1 ? 'note' : 'notes'}
            </span>
          ) : null}
          {row.nextScheduledAt && row.jobState === 'pending' ? (
            <span>next {formatEta(row.nextScheduledAt)}</span>
          ) : null}
          {row.lastSuccess ? <span>updated {formatAge(row.lastSuccess)}</span> : null}
          {inheritedFrom ? <span>via {inheritedFrom}</span> : null}
        </span>

        {/* Explicit buttons rather than a click-anywhere row: opening the
            briefing and re-running it are different enough that guessing
            which one a click meant would be wrong half the time. */}
        <span className="flex shrink-0 items-center gap-1">
          {row.aiDisabled ? (
            // Nothing else here is meaningful while AI access is off — there is
            // no briefing to open and generating one is refused — so the single
            // useful action replaces both.
            <button
              type="button"
              onClick={() => void enableAi()}
              title={
                inheritedFrom
                  ? `Re-enable AI access (currently excluded via ${inheritedFrom})`
                  : 'Re-enable AI access for this folder'
              }
              className={cn(ROW_ACTION, 'gap-1.5')}
            >
              <Icon name="check" size={11} className="codicon-emerald" />
              Enable
            </button>
          ) : !row.hasContextFile ? (
            // Nothing to open yet, so the row offers the one thing that can
            // change that — spelled out, since it is the whole action here.
            <button
              type="button"
              disabled={row.jobState === 'running'}
              onClick={() => void api().folderContext.rescanFolder(row.folderRel)}
              title="Generate this folder's context"
              className={cn(ROW_ACTION, 'gap-1.5')}
            >
              {/* The engine that will actually run this, from Settings. A
                  fixed Claude mark told the user the wrong thing the moment
                  they switched provider — and this button is where they find
                  out which one maintains their vault. */}
              <ProviderGlyph id={engineProvider} size={11} />
              Generate
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void openContext()}
                title="Open CLAUDE.md"
                className={cn(ROW_ACTION, 'gap-1.5')}
              >
                <Icon name="go-to-file" size={11} />
                Open
              </button>
              <button
                type="button"
                disabled={row.jobState === 'running'}
                onClick={() => void api().folderContext.rescanFolder(row.folderRel)}
                title="Regenerate this context"
                aria-label="Regenerate this context"
                className={cn(ROW_ACTION, 'w-[26px] justify-center px-0')}
              >
                <ProviderGlyph id={engineProvider} size={11} />
              </button>
            </>
          )}
        </span>
      </div>

      {hasError && errorExpanded ? (
        <div id={errorId} className="border-t border-red-400/20 px-2 pb-3 pt-2.5">
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium text-red-300">
            <Icon name="error" size={11} className="codicon-red" />
            Full error
          </div>
          <pre className="max-h-64 select-text overflow-auto whitespace-pre-wrap break-words rounded-[8px] bg-background px-3 py-2.5 font-mono text-[10.5px] leading-[1.55] text-foreground [overflow-wrap:anywhere]">
            {fullError}
          </pre>
        </div>
      ) : null}
    </div>
  )
}

function EmptyBucket({ bucket }: { bucket: Bucket }): JSX.Element {
  const text: Record<Bucket, string> = {
    behind: 'Every folder briefing is up to date.',
    running: 'Nothing is queued, generating, or failed.',
    done: 'No folder has an up-to-date briefing yet.',
    disabled: 'No folder has AI access turned off.'
  }
  return (
    <div className="px-6 py-12 text-center text-[12px] text-muted-foreground">
      <Icon name="circle-large-outline" size={20} className="mb-2 text-muted-foreground/60" />
      <div>{text[bucket]}</div>
    </div>
  )
}

function formatAge(ms: number): string {
  const delta = Date.now() - ms
  if (delta < 60_000) return 'just now'
  const m = Math.round(delta / 60_000)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

function formatEta(ms: number): string {
  const delta = ms - Date.now()
  if (delta <= 0) return 'shortly'
  const m = Math.round(delta / 60_000)
  if (m < 60) return `in ${m}m`
  const h = Math.round(m / 60)
  return `in ${h}h`
}
