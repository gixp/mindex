import * as Dialog from '@radix-ui/react-dialog'
import {
  DialogActions,
  DialogHeading,
  SMALL_DIALOG_BODY,
  SMALL_DIALOG_CONTENT,
  SMALL_DIALOG_OVERLAY
} from './dialog-chrome'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: React.ReactNode
  confirmLabel?: string
  confirmIcon?: string
  cancelLabel?: string
  destructive?: boolean
  zIndex?: number
  onConfirm(): void
  onCancel(): void
}

// Title + message + close, then paired buttons — the shape every confirmation
// (delete, discard, disable sync, …) shares, so they all read as the same kind
// of moment. The chrome itself lives in `dialog-chrome.tsx`, alongside the
// prompt dialog that wears it too.
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Continue',
  confirmIcon,
  cancelLabel = 'Cancel',
  destructive,
  zIndex = 60,
  onConfirm,
  onCancel
}: ConfirmDialogProps): JSX.Element {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay style={{ zIndex }} className={SMALL_DIALOG_OVERLAY} />
        <Dialog.Content
          style={{ zIndex }}
          className={SMALL_DIALOG_CONTENT}
          aria-describedby={undefined}
        >
          <div className={SMALL_DIALOG_BODY}>
            <DialogHeading title={title} message={message} onClose={onCancel} />
            <DialogActions
              cancelLabel={cancelLabel}
              confirmLabel={confirmLabel}
              {...(confirmIcon ? { confirmIcon } : {})}
              {...(destructive ? { destructive } : {})}
              onCancel={onCancel}
              onConfirm={onConfirm}
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
