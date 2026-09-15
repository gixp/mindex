import { registerOverlay } from '@/platform/registry/overlays'
import { FileHistoryModal } from '@/features/history/components/FileHistoryModal'

/** What this part of the app draws over the workspace. */
export function registerOverlays(): void {
  registerOverlay({ id: 'history.fileHistory', order: 8, Component: FileHistoryModal })
}
