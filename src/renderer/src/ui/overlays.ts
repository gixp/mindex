import { registerOverlay } from '@/platform/registry/overlays'
import { PromptDialog } from '@/ui/PromptDialog'
import { ConfirmHost } from '@/ui/ConfirmHost'
import { Toaster } from '@/ui/Toaster'
import { TableModal } from '@/ui/TableModal'

/** What this part of the app draws over the workspace. */
export function registerOverlays(): void {
  registerOverlay({ id: 'ui.prompt', order: 10, Component: PromptDialog })
  // Beside the prompt, and above it: a confirmation raised from inside one
  // has to cover it.
  registerOverlay({ id: 'ui.confirm', order: 10.5, Component: ConfirmHost })
  registerOverlay({ id: 'ui.toaster', order: 14, Component: Toaster })
  registerOverlay({ id: 'ui.tableModal', order: 21, Component: TableModal })
}
