import * as Dialog from '@radix-ui/react-dialog'
import { Icon } from './icon'
import { ActionButton } from './action-button'

/**
 * The chrome the app's small modals share — the confirmation and the prompt.
 *
 * It exists because they were two hand-maintained copies of the same markup,
 * down to the class strings. Every change had to be made twice, and the one
 * that got forgotten drifted silently.
 *
 * Deliberately not built on `StandardDialog`: several callers stack these
 * above another portal (tree context menus, pickers) with a custom z-index,
 * which that component's fixed `z-dialog` cannot express.
 */

export const SMALL_DIALOG_OVERLAY =
  'fixed inset-0 bg-scrim data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0'

/** 408px, not the 480 it started at: a confirmation is one sentence and two
 *  buttons, and the wider card made both look stranded. */
export const SMALL_DIALOG_CONTENT =
  'fixed left-1/2 top-1/2 flex w-[408px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 flex-col rounded-r1 border border-bd-3 bg-bg-2 shadow-s2 outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0'

export const SMALL_DIALOG_BODY = 'p-5'

/**
 * Title, optional message, and the close control.
 *
 * The close is bare — no fill, no radius, no box of its own, only a colour
 * shift on hover. A dismiss is the lightest thing on the panel and should not
 * be the only element wearing a button shape.
 */
export function DialogHeading({
  title,
  message,
  onClose
}: {
  title: string
  message?: React.ReactNode
  onClose(): void
}): JSX.Element {
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <Dialog.Title className="break-words text-[15px] font-semibold leading-tight tracking-tight text-foreground">
          {title}
        </Dialog.Title>
        {message ? (
          <div className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{message}</div>
        ) : null}
      </div>
      <Dialog.Close asChild>
        <button type="button" onClick={onClose} aria-label="Close" className={DIALOG_CLOSE_BTN}>
          <Icon name="close" size={14} />
        </button>
      </Dialog.Close>
    </div>
  )
}

/** The paired cancel/confirm row that closes every small modal. */
export function DialogActions({
  cancelLabel = 'Cancel',
  confirmLabel = 'Continue',
  confirmIcon,
  destructive,
  onCancel,
  onConfirm
}: {
  cancelLabel?: string
  confirmLabel?: string
  confirmIcon?: string
  destructive?: boolean
  onCancel(): void
  onConfirm(): void
}): JSX.Element {
  return (
    // The even split is this row's own choice, not the button's. A small modal
    // asks one question and its two answers carry equal weight; a form window
    // does not, which is why `flex-1` came off the button and moved here.
    <div className="mt-4 flex items-center gap-2 [&>button]:flex-1">
      <ActionButton onClick={onCancel}>{cancelLabel}</ActionButton>
      <ActionButton
        tone={destructive ? 'danger' : 'primary'}
        icon={confirmIcon}
        onClick={onConfirm}
      >
        {confirmLabel}
      </ActionButton>
    </div>
  )
}

/** The bare close control: no fill, no radius, no box — only a colour shift. */
/**
 * The way out, top right of every window.
 *
 * `[&_.codicon]` is what makes the hover visible: the button has always
 * animated its own colour, but the cross inside it is an icon, and the base
 * rule paints every icon grey with `!important` — so the button lit up around
 * a mark that stayed exactly as it was. Handled here rather than at each of
 * the eight places that render one.
 */
export const DIALOG_CLOSE_BTN =
  'mt-px inline-flex shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground [&_.codicon]:!text-current [&_.codicon::before]:!text-current [&_.codicon]:transition-colors'
