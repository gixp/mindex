import { registerOverlay } from '@/platform/registry/overlays'
import { ErrorDialogConnected } from '@/platform/ErrorDialogConnected'
import { IconPickerHost } from '@/platform/IconPickerHost'

/** What this part of the app draws over the workspace. */
export function registerOverlays(): void {
  registerOverlay({ id: 'platform.errorDialog', order: 13, Component: ErrorDialogConnected })
  registerOverlay({ id: 'platform.iconPicker', order: 22, Component: IconPickerHost })
}
