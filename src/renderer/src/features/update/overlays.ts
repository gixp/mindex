import { registerOverlay } from '@/platform/registry/overlays'
import { UpdateNotice } from '@/features/update/components/UpdateNotice'

/** What this part of the app draws over the workspace. */
export function registerOverlays(): void {
  // After the proposal dock (15) and the quick-ask corner (23) so that when
  // all three are out, this one is on top — it is the only one of the three
  // that is not always reachable again from somewhere else.
  registerOverlay({ id: 'update.notice', order: 24, Component: UpdateNotice })
}
