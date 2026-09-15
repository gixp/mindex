import { ErrorDialog } from '@/ui/ErrorDialog'
import { useNotificationsStore } from './notifications'

/** Lived in the window's root, purely because that is where it was mounted. */
export function ErrorDialogConnected(): JSX.Element | null {
  const modal = useNotificationsStore((s) => s.errorModal)
  const close = useNotificationsStore((s) => s.closeError)
  if (!modal.open) return null
  return (
    <ErrorDialog open={modal.open} title={modal.title} message={modal.message} onClose={close} />
  )
}
