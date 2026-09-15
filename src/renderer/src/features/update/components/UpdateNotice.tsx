import type { ReactNode } from 'react'
import type { UpdateStatus } from '@shared/types'
import { ActionButton } from '@/ui/action-button'
import { api } from '@/platform/api'
import { useUiStore } from '@/platform/app-settings'
import { useUpdateOffer } from '@/features/update/lib/useUpdateOffer'
import { useUpdateNoticeStore } from '@/features/update/store'
import { releaseText } from '@shared/release-text'
import { Icon } from '@/ui/icon'

/**
 * The same ground as the message box in the right sidebar.
 *
 * Not a tint of the accent, which this wore briefly and which made a notice
 * about a 200 MB download look like the most important thing on screen. The
 * blue is spent where it does the work — one filled button — and the panel
 * itself is the rung the composer already uses, so a floating thing and a
 * docked thing agree about what a surface is.
 *
 * It wears an edge like every modal window, but not the same token, and the
 * reason is arithmetic rather than taste. A dialog is filled one rung lower
 * than this, and the border a dialog uses sits two tenths of a point away from
 * this fill on the dark theme — a line that is there in the markup and absent
 * on the screen. The system's own answer for a control filled at this rung is
 * the line drawn at the rung above it, which is what this is, and it reads on
 * both themes.
 */
const UPDATE_SURFACE: React.CSSProperties = {
  background: 'hsl(var(--bg-3))',
  border: '1px solid hsl(var(--bd-3))',
  boxShadow: 'var(--sh-2)'
}

/**
 * The update, offered in the corner.
 *
 * It used to be a card pinned into the left sidebar, above the workspace
 * switcher, on the reasoning that a notice with no deadline must not vanish on
 * its own. That reasoning still holds and is now served better: the header
 * carries a button for as long as an update exists, so this can behave like
 * what it is — an announcement — and be closed without the offer being lost.
 *
 * Pinned to the bottom-right corner of the window, always the same place. It
 * briefly covers the round chat button when that one is out, which is the
 * trade: a notice that moves depending on what else is on screen is a notice
 * you have to find twice.
 */
export function UpdateNotice(): JSX.Element | null {
  const { status, version, shown, working } = useUpdateOffer()
  const close = useUpdateNoticeStore((s) => s.close)

  if (!status || !version || !shown) return null

  /** Not this version, ever — kept in the settings, so a restart honours it. */
  function dismiss(): void {
    if (!version) return
    close(version)
    void api()
      .settings.setApp({ dismissedUpdateVersion: version })
      .then((r) => {
        if (r.ok && r.data) useUiStore.setState({ settings: r.data })
      })
  }

  return (
    <div
      role="status"
      style={UPDATE_SURFACE}
      className="fixed bottom-5 right-5 z-toast w-[340px] max-w-[calc(100vw-2.5rem)] rounded-10 px-3 py-2.5"
    >
      {/* Closing is not dismissing: it says "not now, not this sitting", and
          the header button brings it straight back. Absent while something is
          downloading or installing — there is nothing to close, only work to
          watch. */}
      {!working ? (
        <button
          type="button"
          onClick={() => close(version)}
          title="Close"
          aria-label="Close"
          className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
        >
          <Icon name="close" size={14} />
        </button>
      ) : null}
      <div className={working ? undefined : 'pr-6'}>
        <Body status={status} version={version} />
      </div>
      <Actions status={status} onStart={() => void api().update.start()} onDismiss={dismiss} />
    </div>
  )
}

function Body({ status, version }: { status: UpdateStatus; version: string }): JSX.Element {
  if (status.phase === 'downloading') {
    const pct = Math.round((status.progress ?? 0) * 100)
    return (
      <>
        <Line icon="cloud-download" text={`Downloading v${version}… ${pct}%`} />
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-bg-1">
          <div
            className="h-full rounded-full bg-c-2 transition-[width] duration-200"
            style={{ width: `${pct}%` }}
          />
        </div>
      </>
    )
  }
  if (status.phase === 'ready') {
    // Only reachable now when the relaunch did not take: Install downloads and
    // restarts in one go, so nothing is left staged in the ordinary case. The
    // watchdog that lands here says why, and that is the line worth showing.
    return (
      <>
        <Line icon="check" text={`Version ${version} is ready`} />
        <p className="mt-1 text-11.5 leading-snug text-muted-foreground/80">
          {status.error ?? 'Restart Mindex to finish updating.'}
        </p>
      </>
    )
  }
  if (status.phase === 'installing') {
    return <Line icon="sync" text="Installing — Mindex will restart…" />
  }
  if (status.phase === 'manual' || status.phase === 'error') {
    return (
      <>
        <Line icon="warning" text="Update couldn't install" />
        {status.error ? (
          <p className="mt-1 text-11.5 leading-snug text-muted-foreground/80">{status.error}</p>
        ) : null}
      </>
    )
  }
  // Absent is the ordinary case, not a hole to fill. Checked here as well as
  // in the feed parser because the app half re-reads the feed at launch and
  // once an hour, so a status already in memory — 0.3.7's, whose summary is
  // the word "null" — outlives a fix made only where the feed is parsed.
  const summary = releaseText(status.description)
  return (
    <>
      <Line icon="cloud-download" text={`Version ${version} available`} />
      {summary ? (
        <p className="mt-1 text-11.5 leading-snug text-muted-foreground/80">{summary}</p>
      ) : null}
    </>
  )
}

function Line({ icon, text }: { icon: string; text: string }): JSX.Element {
  return (
    <div className="flex items-center gap-1.5 text-12.5 text-foreground">
      <Icon name={icon} size={14} className="shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate">{text}</span>
    </div>
  )
}

/** A word, and nothing else: no ground, no edge, no box of its own. */
const linkBtn =
  'text-11 text-muted-foreground transition-colors hover:text-foreground [&:hover_.codicon]:!text-foreground'

/**
 * The one thing to press, and the only blue in the notice.
 *
 * `ActionButton` rather than a hand-written pill: that component exists
 * because thirty-seven buttons written out by hand had settled on four heights
 * and nine radii between them, and a notice that floats over the app is the
 * last place that should invent a thirty-eighth. `sm` is the size the app
 * gives a button inside a panel this dense.
 *
 * Right-hand end of the row, with whatever declines it sitting plainly to its
 * left — the shape a dialog's buttons take everywhere, so which one is the
 * action needs no reading.
 */
function Primary({ onClick, children }: { onClick(): void; children: ReactNode }): JSX.Element {
  return (
    <ActionButton tone="primary" size="sm" onClick={onClick}>
      {children}
    </ActionButton>
  )
}

function Actions({
  status,
  onStart,
  onDismiss
}: {
  status: UpdateStatus
  onStart(): void
  onDismiss(): void
}): JSX.Element | null {
  // Nothing to press while it is working — and nothing to close either: the
  // download is already paid for, so hiding the progress would only lose the
  // user their only view of it.
  if (status.phase === 'downloading' || status.phase === 'installing') return null

  if (status.phase === 'ready') {
    return (
      <Row>
        <Primary onClick={() => void api().update.installNow()}>Restart now</Primary>
      </Row>
    )
  }

  if (status.phase === 'manual' || status.phase === 'error') {
    return (
      <Row>
        <button type="button" className={linkBtn} onClick={onDismiss}>
          Not now
        </button>
        <button type="button" className={linkBtn} onClick={() => void api().update.openDownload()}>
          Download
        </button>
        <Primary onClick={onStart}>Try again</Primary>
      </Row>
    )
  }

  return (
    <Row>
      <button type="button" className={linkBtn} onClick={onDismiss}>
        Not now
      </button>
      <Primary onClick={onStart}>Install</Primary>
    </Row>
  )
}

/** Everything in the row ends at the right edge, the action last. */
function Row({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="mt-2 flex items-center justify-end gap-3">{children}</div>
}
