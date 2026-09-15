import { ConfirmDialog } from '@/ui/ConfirmDialog'
import { useConfirmStore } from '@/ui/confirm'

/**
 * The one mounted confirmation, driven by whoever called `confirmAction`.
 *
 * Mounted at the root, like the prompt beside it, so an action that lives in a
 * command list or a store can still ask a question.
 */
export function ConfirmHost(): JSX.Element {
  const request = useConfirmStore((s) => s.request)
  const resolve = useConfirmStore((s) => s.resolve)

  return (
    <ConfirmDialog
      open={request !== null}
      title={request?.title ?? ''}
      message={request?.message ?? ''}
      confirmLabel={request?.confirmLabel}
      destructive={request?.destructive}
      onConfirm={() => resolve(true)}
      onCancel={() => resolve(false)}
    />
  )
}
