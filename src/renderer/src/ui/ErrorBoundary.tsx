import * as React from 'react'
import * as Sentry from '@sentry/electron/renderer'
import { ErrorWindow } from './ErrorWindow'

/**
 * The last line of defence for a render crash.
 *
 * Without one of these anywhere, a single component throwing unmounts the
 * whole tree and leaves an empty window — no message, no way back, and
 * whatever was being typed still only in memory. This replaces that with
 * something readable and two ways out.
 *
 * Reads no app state: it must still render when the thing that broke *is* a
 * store, the preload bridge, or the settings load. It does use the shared
 * window, on the founder's call, so the crash screen looks like every other
 * window rather than like a thing built in a hurry. The cost is stated
 * plainly: if the dialog library itself is what broke, this cannot draw.
 *
 * Reusable on purpose. Wrapping individual panels (so one crashing pane does
 * not take the others with it) is the real goal; that lands with the shell
 * restructure, since wrapping them today would churn a file that is about to
 * move. Until then this is mounted once, at the root.
 */

interface ErrorBoundaryProps {
  children: React.ReactNode
  /** Which part of the app this guards — shown to the user, sent with the report. */
  label?: string
}

interface ErrorBoundaryState {
  error: Error | null
  /** Bumped by "Try again" to force a fresh subtree rather than re-rendering
   *  the one that just threw with the same props. */
  attempt: number
}

function details(error: Error, label: string | undefined): string {
  return [label ? `Where: ${label}` : null, error.stack ?? `${error.name}: ${error.message}`]
    .filter(Boolean)
    .join('\n')
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null, attempt: 0 }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error }
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Console first: if the report below is what throws, the stack is still
    // somewhere a developer can reach.
    console.error('[render-crash]', this.props.label ?? 'root', error, info.componentStack)
    try {
      Sentry.captureException(error, {
        tags: { boundary: this.props.label ?? 'root' },
        extra: { componentStack: info.componentStack }
      })
    } catch {
      // Reporting must never be the reason the fallback fails to render.
    }
  }

  override render(): React.ReactNode {
    const { error } = this.state
    if (!error) {
      return <React.Fragment key={this.state.attempt}>{this.props.children}</React.Fragment>
    }

    const text = details(error, this.props.label)

    return (
      <CrashCard
        text={text}
        onRetry={() => this.setState((st) => ({ error: null, attempt: st.attempt + 1 }))}
      />
    )
  }
}

/**
 * What a render crash looks like.
 *
 * Its own component so it can be looked at without breaking something first:
 * a crash screen is the one screen nobody sees while designing it, which is
 * how it ends up being the worst-looking thing in an application.
 */
export function CrashCard({ text, onRetry }: { text: string; onRetry(): void }): JSX.Element {
  return (
    <ErrorWindow
      open
      title="Something in the interface stopped working"
      subtitle="Your notes are files on disk and were not touched by this. Anything typed since the last save may not have been written yet — reopening the note will show what is actually on disk."
      detail={text}
      actionLabel="Try again"
      actionIcon="debug-restart"
      // There is nothing behind this to go back to, so closing it means the
      // one thing that could help: drop the error and render the tree again.
      onAction={onRetry}
    />
  )
}
