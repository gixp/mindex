import { useEffect, useMemo, useState } from 'react'
import type { HistoryVersion } from '@shared/types'
import { useUiStore } from '@/platform/app-settings'
import { useHistoryStore } from '@/features/history/store'
import { api } from '@/platform/api'
import { StandardDialog } from '@/ui/StandardDialog'
import { ConfirmDialog } from '@/ui/ConfirmDialog'
import { Icon } from '@/ui/icon'
import { ActionButton } from '@/ui/action-button'
import { cn } from '@/ui/cn'
import { HistoryDiff } from './HistoryDiff'

function relTime(ts: number): string {
  const diff = Date.now() - ts
  const s = Math.floor(diff / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} hr ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} days ago`
  return new Date(ts).toLocaleDateString()
}

function fmtSize(bytes?: number): string {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

/**
 * The version a control names, short enough for a button.
 *
 * The clock alone where that is unambiguous — most of a file's history is from
 * today — and the date in front of it otherwise, because "2:28 AM" on its own
 * says nothing about which 2:28 AM is about to overwrite the file.
 */
function versionLabel(ts: number): string {
  const clock = fmtClock(ts)
  if (dayKey(ts) === dayKey(Date.now())) return clock
  return `${new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${clock}`
}

function fmtClock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** Day bucket for a version, used as the timeline's group heading. */
function dayKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function dayLabel(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (dayKey(ts) === dayKey(today.getTime())) return 'Today'
  if (dayKey(ts) === dayKey(yesterday.getTime())) return 'Yesterday'
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Size delta against the version immediately older than this one. */
function deltaLabel(cur?: number, prev?: number): string | null {
  if (cur == null || prev == null) return null
  const d = cur - prev
  if (d === 0) return null
  const sign = d > 0 ? '+' : '−'
  const mag = Math.abs(d)
  return `${sign}${mag < 1024 ? `${mag} B` : `${(mag / 1024).toFixed(1)} KB`}`
}

/**
 * Who made this version — the thing that turns a list of saves into a
 * timeline. Renders nothing for `user` (the common case, and labelling every
 * one of your own edits "You" is just noise) and nothing for versions recorded
 * before attribution existed, where the honest answer is "unknown".
 */
function AuthorTag({ version }: { version: HistoryVersion }): JSX.Element | null {
  if (version.deleted) return null
  if (version.author === 'agent') {
    return (
      <span
        title={
          version.authorDetail
            ? `Written while the engine was running (${version.authorDetail})`
            : 'Written while the engine was running'
        }
        className="shrink-0 text-[9px] font-semibold uppercase tracking-wider text-accent-1/80"
      >
        Agent
      </span>
    )
  }
  if (version.author === 'external') {
    return (
      <span
        title="Changed outside Mindex — another editor, a git operation, or a sync client"
        className="shrink-0 text-[9px] font-semibold uppercase tracking-wider text-amber-400/70"
      >
        External
      </span>
    )
  }
  return null
}

export function FileHistoryModal(): JSX.Element | null {
  const modal = useUiStore((s) => s.historyModal)
  const close = useUiStore((s) => s.closeFileHistory)
  const versions = useHistoryStore((s) => s.versions)
  const loading = useHistoryStore((s) => s.loading)
  const loadFor = useHistoryStore((s) => s.loadFor)
  const restore = useHistoryStore((s) => s.restore)
  const reset = useHistoryStore((s) => s.reset)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [oldText, setOldText] = useState<string>('')
  const [newText, setNewText] = useState<string>('')
  const [diffLoading, setDiffLoading] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [confirmRestore, setConfirmRestore] = useState(false)

  const path = modal.path

  useEffect(() => {
    if (modal.open && path) {
      void loadFor(path)
    } else {
      reset()
      setSelectedId(null)
    }
  }, [modal.open, path, loadFor, reset])

  useEffect(() => {
    if (!modal.open || !path) return
    const off = api().on.historyUpdated((relPath) => {
      if (path.endsWith(relPath)) void loadFor(path)
    })
    return off
  }, [modal.open, path, loadFor])

  const newest = useMemo(() => versions.find((v) => !v.deleted) ?? null, [versions])

  useEffect(() => {
    if (selectedId || versions.length === 0) return
    const contentVersions = versions.filter((v) => !v.deleted)
    const pick = contentVersions[1] ?? contentVersions[0]
    if (pick) setSelectedId(pick.id)
  }, [versions, selectedId])

  useEffect(() => {
    if (!path || !selectedId || !newest) {
      setOldText('')
      setNewText('')
      return
    }
    let cancelled = false
    setDiffLoading(true)
    void (async () => {
      const [oldR, newR] = await Promise.all([
        api().history.read(path, selectedId),
        api().history.read(path, newest.id)
      ])
      if (cancelled) return
      setOldText(oldR.ok && oldR.data != null ? oldR.data : '')
      setNewText(newR.ok && newR.data != null ? newR.data : '')
      setDiffLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [path, selectedId, newest])

  // Grouped by day so a long list reads as a timeline instead of 200 identical
  // rows. Built from the store order (newest first), which the groups preserve.
  const days = useMemo(() => {
    const out: Array<{ key: string; label: string; items: HistoryVersion[] }> = []
    for (const v of versions) {
      const key = dayKey(v.ts)
      const last = out[out.length - 1]
      if (last && last.key === key) last.items.push(v)
      else out.push({ key, label: dayLabel(v.ts), items: [v] })
    }
    return out
  }, [versions])

  if (!modal.open || !path) return null

  const fileName = path.split('/').pop() ?? path
  const selected = versions.find((v) => v.id === selectedId) ?? null
  const canRestore = !!selected && !selected.deleted && selected.id !== newest?.id

  async function handleRestore(): Promise<void> {
    if (!path || !selectedId) return
    setRestoring(true)
    try {
      await restore(path, selectedId)
    } finally {
      setRestoring(false)
    }
  }

  return (
    <StandardDialog
      open={modal.open}
      onOpenChange={(o) => {
        if (!o) close()
      }}
      icon="history"
      title="File history"
      subtitle={fileName}
      headerAction={
        // `ml-4` is the offset the diff panel itself carries, so the comparison
        // begins exactly where that panel's edge is.
        <div className="ml-4 flex min-w-0 items-center gap-3">
          {/* What is being compared. It describes the window, not one pane of
              it, which is why it is up here rather than over the diff. */}
          {selected ? (
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[12px] font-medium text-foreground">
                {selected.deleted ? 'Deleted' : relTime(selected.ts)}
              </span>
              <Icon name="arrow-right" size={11} className="shrink-0" />
              <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-300">
                Current
              </span>
            </div>
          ) : (
            <span className="text-[12px] text-muted-foreground">Select a version</span>
          )}
          <ActionButton
            tone="primary"
            size="sm"
            icon="history"
            className="ml-auto"
            disabled={!canRestore || restoring}
            onClick={() => setConfirmRestore(true)}
          >
            {restoring
              ? 'Reverting…'
              : `Revert${selected && !selected.deleted ? ` to ${versionLabel(selected.ts)}` : ''}`}
          </ActionButton>
        </div>
      }
      width={300}
      height={680}
      expanded
      rightSlotWidth={760}
      rightSlotDivider={false}
      rightSlot={
        // A surface of its own rather than a second half of the window: the
        // versions are a list to pick from, the diff is the thing being looked
        // at, and a rung down with its own corners says that without a rule
        // between them.
        <div className="ml-4 flex h-full flex-col rounded-r1 bg-bg-1 p-4">
          {/* Clipped, so a long line scrolling sideways stops at the panel's
              corner rather than running out past it. */}
          <div className="min-h-0 flex-1 overflow-hidden">
            {diffLoading ? (
              <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
                Loading diff…
              </div>
            ) : selected && newest ? (
              <HistoryDiff oldText={oldText} newText={newText} />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                <Icon name="git-compare" size={22} className="opacity-40" />
                <p className="text-[12px] text-muted-foreground">
                  Pick a version on the left to see what changed.
                </p>
              </div>
            )}
          </div>
        </div>
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        {/* No padding of its own on any side: the rows carry theirs, and the
            panel's inset is already around all of it. */}
        <div className="min-h-0 flex-1 overflow-auto">
          {loading && versions.length === 0 ? (
            <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
              Loading…
            </div>
          ) : versions.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <Icon name="history" size={22} className="opacity-40" />
              <p className="text-[12px] text-muted-foreground">
                No history yet. Versions are captured the next time this file changes.
              </p>
            </div>
          ) : (
            days.map((day) => (
              <div key={day.key} className="mb-1 flex flex-col gap-1">
                <div className="sticky top-0 z-pane bg-card/95 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 backdrop-blur">
                  {day.label}
                </div>
                {day.items.map((v) => {
                  const isNewest = v.id === newest?.id
                  const isSelected = selectedId === v.id
                  const globalIdx = versions.indexOf(v)
                  const older = versions[globalIdx + 1]
                  const delta = v.deleted ? null : deltaLabel(v.size, older?.size)

                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setSelectedId(v.id)}
                      className={cn(
                        'group/v relative flex w-full items-center gap-2.5 rounded-[10px] py-1.5 pl-2 pr-2.5 text-left transition-colors',
                        isSelected ? 'bg-accent-1/[0.10]' : 'hover:bg-bg-3'
                      )}
                    >
                      {/* A dot per version, and nothing joining them. The line
                          that used to run through them read as a thread only
                          while the rows touched; spaced apart it was a dashed
                          rule down the side of the list. */}
                      <span className="flex w-3 shrink-0 justify-center self-stretch">
                        <span
                          className={cn(
                            'mt-[5px] h-[7px] w-[7px] shrink-0 self-start rounded-full',
                            v.deleted
                              ? 'bg-red-400'
                              : isNewest
                                ? 'bg-emerald-400'
                                : isSelected
                                  ? 'bg-accent-1'
                                  : 'bg-muted-foreground/40'
                          )}
                        />
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              'truncate text-[12px]',
                              isSelected ? 'font-medium text-foreground' : 'text-c-1'
                            )}
                          >
                            {v.deleted ? 'Deleted' : fmtClock(v.ts)}
                          </span>
                          {isNewest && !v.deleted ? (
                            <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wider text-emerald-400/80">
                              Current
                            </span>
                          ) : null}
                          <AuthorTag version={v} />
                        </span>
                        <span className="mt-px flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
                          <span>{relTime(v.ts)}</span>
                          {v.size != null && !v.deleted ? (
                            <>
                              <span className="opacity-40">·</span>
                              <span className="tabular-nums">{fmtSize(v.size)}</span>
                            </>
                          ) : null}
                          {delta ? (
                            <span
                              className={cn(
                                'tabular-nums',
                                delta.startsWith('+') ? 'text-emerald-400/70' : 'text-red-400/70'
                              )}
                            >
                              {delta}
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmRestore}
        title="Revert to this version?"
        message={
          <>
            {fileName} will be rewritten with the version from{' '}
            <strong className="text-foreground">
              {selected ? relTime(selected.ts) : 'this point'}
            </strong>
            . The version you are replacing stays in this list, so you can go back to it.
          </>
        }
        confirmLabel="Revert"
        confirmIcon="history"
        zIndex={80}
        onCancel={() => setConfirmRestore(false)}
        onConfirm={() => {
          setConfirmRestore(false)
          void handleRestore()
        }}
      />
    </StandardDialog>
  )
}
