import { ErrorWindow } from './ErrorWindow'

/**
 * The window every reported failure in the app opens — a transcription that
 * failed, a chat turn that errored, a git command that came back non-zero.
 * Anything calling `showError` lands here.
 *
 * It is the crash screen's window, with a different headline and a different
 * word on the button: one failure looks like another whatever produced it.
 * Before this the two were separately hand-drawn and shared nothing.
 */
export function ErrorDialog({
  open,
  title,
  message,
  onClose
}: {
  open: boolean
  title: string
  message: string
  onClose(): void
}): JSX.Element {
  return (
    <ErrorWindow
      open={open}
      title={title}
      detail={message}
      actionLabel="Dismiss"
      actionIcon="check"
      onAction={onClose}
    />
  )
}
