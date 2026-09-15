import { registerOverlay } from '@/platform/registry/overlays'
import { WriteConflictDialog } from '@/features/editor/components/WriteConflictDialog'

/** What this part of the app draws over the workspace. */
export function registerOverlays(): void {
  registerOverlay({ id: 'editor.writeConflict', order: 9, Component: WriteConflictDialog })
}
