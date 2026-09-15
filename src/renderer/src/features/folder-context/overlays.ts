import { registerOverlay } from '@/platform/registry/overlays'
import { EngineStatusModal } from '@/features/folder-context/components/EngineStatusModal'

/** What this part of the app draws over the workspace. */
export function registerOverlays(): void {
  registerOverlay({ id: 'folderContext.engineStatus', order: 3, Component: EngineStatusModal })
}
