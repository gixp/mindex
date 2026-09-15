import { registerOverlay } from '@/platform/registry/overlays'
import { QuickAskCorner } from '@/features/layout/components/QuickAskCorner'

/** What this part of the app draws over the workspace. */
export function registerOverlays(): void {
  registerOverlay({ id: 'layout.quickAsk', order: 23, Component: QuickAskCorner })
}
