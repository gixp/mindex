import { useEffect, useMemo, useRef, useState } from 'react'
import { useJobsStore } from '@/features/engine/store'
import { useUiStore } from '@/platform/app-settings'
import { useVaultStore } from '@/platform/workspace'
import { api } from '@/platform/api'
import { Icon } from '@/ui/icon'
import { StandardDialog } from '@/ui/StandardDialog'
import { cn } from '@/ui/cn'
import type { EngineLogEntry } from '@shared/types'

/** The same button as every other window's: fills with its own edge. */
const ACTION =
  'inline-flex h-[26px] shrink-0 items-center gap-1.5 rounded-8 border border-bd-1 px-2 text-11 font-medium text-c-2 transition-colors hover:bg-bg-3 hover:text-c-1 disabled:cursor-not-allowed disabled:opacity-30'

const LEVEL_COLOR = {
  info: 'text-muted-foreground',
  warn: 'text-amber-400',
  error: 'text-red-400'
} as const

interface EngineLogDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
}

/** One log line, as the plain text a copy hands over. */
function lineText(entry: EngineLogEntry): string {
  const feature = entry.feature ? ` [${entry.feature}]` : ''
  const scope = entry.scope ? ` (${entry.scope})` : ''
  return `${new Date(entry.ts).toISOString()} ${entry.level.toUpperCase()}${feature}${scope} ${entry.message}`
}

/**
 * A copy button that says it worked.
 *
 * Copying is invisible by nature — the clipboard gives no feedback of its own,
 * and without the tick you press it twice and still do not know.
 */
function CopyButton({
  text,
  label,
  compact
}: {
  text(): string
  label: string
  compact?: boolean
}): JSX.Element {
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!done) return
    const t = setTimeout(() => setDone(false), 1200)
    return () => clearTimeout(t)
  }, [done])

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text())
      setDone(true)
    } catch {
      /* a clipboard the OS refused is not worth an error dialog */
    }
  }

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => void copy()}
        title={label}
        aria-label={label}
        className="shrink-0 inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground/50 opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
      >
        <Icon name={done ? 'check' : 'copy'} size={10} />
      </button>
    )
  }

  return (
    <button type="button" onClick={() => void copy()} className={ACTION}>
      <Icon name={done ? 'check' : 'copy'} size={11} className="codicon-inherit" />
      {done ? 'Copied' : label}
    </button>
  )
}

export function EngineLogDialog({ open, onOpenChange }: EngineLogDialogProps): JSX.Element {
  const log = useJobsStore((s) => s.log)
  const jobs = useJobsStore((s) => s.jobs)
  const paused = useJobsStore((s) => s.paused)
  const pause = useJobsStore((s) => s.pause)
  const resume = useJobsStore((s) => s.resume)
  const cancel = useJobsStore((s) => s.cancel)
  const clearLog = useJobsStore((s) => s.clearLog)
  const settings = useUiStore((s) => s.settings)
  const vault = useVaultStore((s) => s.vault)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [filter, setFilter] = useState('')
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    if (!open || version !== null) return
    void api()
      .app.getVersion()
      .then((r) => setVersion(r.ok && r.data ? r.data : '?'))
  }, [open, version])

  // Free text over the whole line, so `mcp`, `warn` and a folder name are all
  // the same gesture. Everything here is one string per row anyway, and a set
  // of dropdowns would be more chrome than a debug view earns.
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!needle) return log
    return log.filter((e) => lineText(e).toLowerCase().includes(needle))
  }, [log, filter])

  useEffect(() => {
    if (!open) return
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [shown.length, open])

  const activeJobs = Object.values(jobs).filter(
    (j) => j.status === 'running' || j.status === 'pending'
  )

  /**
   * The log plus the state needed to read it.
   *
   * A log pasted on its own leaves out everything that decides what is in it —
   * which CLI is running, whether the search tools are switched on, which
   * version this is. Those questions come back every single time, so they go
   * in the copy.
   */
  function diagnostics(): string {
    const engine = settings?.engine
    const head = [
      `Mindex ${version ? `v${version}` : '(version unknown)'}`,
      `platform: ${navigator.userAgent.includes('Mac') ? 'macOS' : navigator.platform}`,
      `provider: ${engine?.provider ?? '(none)'} · model: ${engine?.model || '(cli default)'}`,
      `auto context: ${engine?.autoContextEnabled === true ? 'on' : 'off'}`,
      `types skill: ${engine?.vaultSkillEnabled !== false ? 'on' : 'off'}`,
      `search tools: ${engine?.searchToolEnabled !== false ? 'on' : 'off'}`,
      `vault: ${vault ? vault.name : '(none open)'}`,
      `entries: ${shown.length}${shown.length !== log.length ? ` of ${log.length} (filtered)` : ''}`,
      ''
    ]
    return [...head, ...shown.map(lineText)].join('\n')
  }

  const counts = useMemo(() => {
    let warn = 0
    let error = 0
    for (const e of log) {
      if (e.level === 'warn') warn++
      else if (e.level === 'error') error++
    }
    return { warn, error }
  }, [log])

  return (
    <StandardDialog
      open={open}
      onOpenChange={onOpenChange}
      icon="vm-running"
      title="Engine"
      subtitle="The background work Mindex does on this vault — what is running, what it did, and what went wrong."
      width={800}
      height={560}
    >
      {activeJobs.length > 0 ? (
        <div className="shrink-0">
          <div className="pb-1 text-11 font-medium uppercase tracking-wider text-c-2">
            Running now
          </div>
          <div className="tree-scroll max-h-[30%] overflow-auto">
            {activeJobs.map((j) => (
              <div
                key={j.id}
                className="group flex items-center gap-2 rounded-8 px-1.5 py-1 text-11 transition-colors hover:bg-bg-2"
              >
                <span
                  className={cn(
                    'inline-flex h-4 shrink-0 items-center rounded-6 px-1 text-9 uppercase',
                    j.status === 'running' ? 'bg-accent-1/15 text-accent-1' : 'bg-bg-3 text-c-2'
                  )}
                >
                  {j.status}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-c-1" title={j.scope}>
                  {j.feature} · {shortenScope(j.scope)}
                </span>
                <button
                  type="button"
                  onClick={() => void cancel(j.id)}
                  title="Stop this one"
                  aria-label="Stop this job"
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-6 text-c-2 transition-colors hover:bg-bg-3 hover:text-c-1"
                >
                  <Icon name="close" size={10} className="codicon-inherit" />
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        {/* Narrow on purpose: it is a filter, not the subject of the window,
            and it was taking the whole width from the things that answer a
            question without being typed into. */}
        <div className="relative w-[200px] shrink-0">
          <Icon
            name="filter"
            size={11}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 codicon-muted"
          />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter"
            className="h-[26px] w-full rounded-8 border border-bd-1 bg-transparent pl-7 pr-2 text-11 text-c-1 outline-none transition-colors placeholder:text-c-2/60 focus:border-bd-2"
          />
        </div>
        {/* The counts answer "did anything go wrong" before you filter, rather
            than by filtering. `mcp` stays: it is the one subsystem people
            search for by name. */}
        <FilterChip
          label="Errors"
          count={counts.error}
          dot="bg-red-400"
          active={filter === 'error'}
          onClick={() => setFilter(filter === 'error' ? '' : 'error')}
        />
        <FilterChip
          label="Warnings"
          count={counts.warn}
          dot="bg-amber-400"
          active={filter === 'warn'}
          onClick={() => setFilter(filter === 'warn' ? '' : 'warn')}
        />
        <FilterChip
          label="mcp"
          active={filter === 'mcp'}
          onClick={() => setFilter(filter === 'mcp' ? '' : 'mcp')}
        />

        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => (paused ? void resume() : void pause())}
            title={paused ? 'Let it start work again' : 'Stop it starting anything new'}
            className={cn(ACTION, paused && 'border-amber-400 text-amber-400')}
          >
            <Icon
              name={paused ? 'debug-start' : 'debug-pause'}
              size={11}
              className="codicon-inherit"
            />
            {paused ? 'Resume' : 'Pause'}
          </button>
          <CopyButton text={diagnostics} label="Copy report" />
          <button
            type="button"
            onClick={() => void clearLog()}
            title="Empty the log"
            className={ACTION}
          >
            <Icon name="clear-all" size={11} className="codicon-inherit" />
            Clear
          </button>
        </span>
      </div>

      <div ref={scrollRef} className="scroll-plain min-h-0 flex-1 overflow-auto font-mono text-11">
        {shown.length === 0 ? (
          <p className="py-6 text-center text-11 text-c-2">
            {log.length === 0
              ? 'Nothing has happened yet. Work appears here as it runs.'
              : 'Nothing matches that filter.'}
          </p>
        ) : (
          shown.map((entry, i) => (
            <div
              key={`${entry.ts}-${i}`}
              className={cn(
                'group flex items-start gap-2 rounded-6 py-0.5 pl-1.5 pr-1 transition-colors hover:bg-bg-2',
                entry.level === 'error' && 'bg-red-400/[0.06]'
              )}
            >
              <span className="shrink-0 text-c-2/60">{formatTime(entry.ts)}</span>
              <span className={cn('w-9 shrink-0 uppercase', LEVEL_COLOR[entry.level])}>
                {entry.level}
              </span>
              {entry.feature ? (
                <span className="shrink-0 text-c-2/80">[{entry.feature}]</span>
              ) : null}
              <span className="min-w-0 flex-1 break-words text-c-1">{entry.message}</span>
              <CopyButton compact text={() => lineText(entry)} label="Copy line" />
            </div>
          ))
        )}
      </div>
    </StandardDialog>
  )
}

/**
 * A count you can press.
 *
 * The number is the point: someone opening this window wants to know whether
 * anything went wrong before they decide to read anything, and a filter that
 * only filters makes them try it to find out.
 */
function FilterChip({
  label,
  count,
  dot,
  active,
  onClick
}: {
  label: string
  count?: number
  dot?: string
  active: boolean
  onClick(): void
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-[26px] shrink-0 items-center gap-1.5 rounded-8 border px-2 text-11 transition-colors',
        active ? 'border-accent-1 text-c-1' : 'border-bd-1 text-c-2 hover:bg-bg-3 hover:text-c-1'
      )}
    >
      {dot ? <span className={cn('h-1.5 w-1.5 rounded-full', dot)} /> : null}
      {label}
      {count !== undefined ? <span className="tabular-nums text-c-2">{count}</span> : null}
    </button>
  )
}

function shortenScope(scope: string): string {
  const parts = scope.split('/').filter(Boolean)
  return parts.slice(-2).join('/')
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}
