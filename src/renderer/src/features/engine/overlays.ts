import { registerOverlay } from '@/platform/registry/overlays'
import { EngineLogDialogConnected } from '@/features/engine/components/EngineLogDialogConnected'

/** What this part of the app draws over the workspace. */
export function registerOverlays(): void {
  registerOverlay({ id: 'engine.log', order: 6, Component: EngineLogDialogConnected })
}
