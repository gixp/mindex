import { useState } from 'react'
import { StandardDialog } from './StandardDialog'
import { Icon } from './icon'
import { linkify } from './linkify'

/**
 * How every failure in the app is shown — one window, one shape.
 *
 * There were two of these and they had nothing in common: the render-crash
 * screen was a hand-drawn card, and the dialog everything else reports through
 * was a different hand-drawn card with different padding, a different icon
 * size, its buttons in a different order and its copy button in a different
 * place. A person meeting both would not know they came from one program.
 *
 * The shape: the standard window, the error mark, the headline as the title,
 * the detail in a block that wraps rather than scrolling sideways — a message
 * or a stack trace both end in the part that says where the fault was, and a
 * horizontal scrollbar hides exactly that — with copying on the block itself,
 * and a single way out at the bottom right.
 */
export function ErrorWindow({
  open,
  title,
  subtitle,
  detail,
  actionLabel,
  actionIcon,
  onAction,
  onDismiss
}: {
  open: boolean
  title: string
  /** One line under the headline, when there is something worth reassuring
   *  about — what a crash did *not* damage, say. */
  subtitle?: React.ReactNode
  /** The message, or the stack trace. Shown verbatim. */
  detail: string
  actionLabel: string
  actionIcon: string
  /**
   * The way through the failure. Closing the window does this too, unless
   * `onDismiss` says otherwise — for most failures there is nothing else
   * closing could mean.
   */
  onAction(): void
  /**
   * What closing means, when it is not the action.
   *
   * Needed once the action stopped always being "Close": a window offering
   * "Try again" cannot treat the X in its corner as a retry, because the X is
   * how you say you are done.
   */
  onDismiss?(): void
}): JSX.Element {
  const [copied, setCopied] = useState(false)

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(detail)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Nothing to say: the clipboard is either there or it is not, and a
      // failure to copy an error message is not itself worth a second error.
    }
  }

  return (
    <StandardDialog
      open={open}
      onOpenChange={onDismiss ?? onAction}
      icon="error"
      title={title}
      subtitle={subtitle}
      // Narrower than a working window on purpose: there is nothing to lay out
      // here, only a sentence and a block of text, and a wide box makes both
      // harder to read rather than easier.
      width={640}
      height="auto"
    >
      <div className="relative">
        <div className="max-h-[52vh] select-text overflow-y-auto rounded-12 bg-bg-2 p-3 pr-10 font-mono text-11 leading-relaxed [overflow-wrap:anywhere]">
          <ErrorDetail detail={detail} />
        </div>
        {/* On the thing it copies, not down in the row of ways out: copying
            the detail is something you do *to* the report, not a way through
            the failure. */}
        <button
          type="button"
          title={copied ? 'Copied' : 'Copy details'}
          aria-label="Copy details"
          onClick={() => void copy()}
          className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-8 text-c-2 transition-colors hover:bg-bg-3 hover:text-c-1"
        >
          <Icon name={copied ? 'check' : 'copy'} size={12} className="codicon-inherit" />
        </button>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onAction}
          className="inline-flex h-8 items-center gap-1.5 rounded-10 bg-accent-1 px-3.5 text-12 font-medium text-white transition-colors hover:bg-accent-1/90 [&_.codicon::before]:!text-white"
        >
          <Icon name={actionIcon} size={12} />
          {actionLabel}
        </button>
      </div>
    </StandardDialog>
  )
}

/**
 * The detail, with the two kinds of line told apart.
 *
 * A failure report is almost always one sentence saying what went wrong
 * followed by a machine's account of where it was at the time. Flat, in one
 * colour, the sentence is buried in the account — which is backwards: the
 * sentence is the part a person reads, and the frames are the part they send
 * to someone else. So the sentence is drawn at full strength and the frames a
 * step back, and the eye finds the first line without being told to.
 */
const FRAME = /^\s*(at\s|Caused by:|\.\.\.\s\d)/

function ErrorDetail({ detail }: { detail: string }): JSX.Element {
  const lines = detail.replace(/\s+$/, '').split('\n')
  return (
    <>
      {lines.map((line, i) => (
        <div
          key={i}
          className={
            FRAME.test(line)
              ? 'whitespace-pre-wrap break-words pl-3 text-c-2/70'
              : 'whitespace-pre-wrap break-words text-c-1'
          }
        >
          {/* `plain`: a URL in here is part of a path far more often than it is
              somewhere to go, so it is not painted. */}
          {line ? linkify(line, { plain: true }) : '\u00a0'}
        </div>
      ))}
    </>
  )
}
