import { registerOverlay } from '@/platform/registry/overlays'
import { LinkHealthModal } from '@/features/links/components/LinkHealthModal'

/** What this part of the app draws over the workspace. */
export function registerOverlays(): void {
  registerOverlay({ id: 'links.health', order: 11, Component: LinkHealthModal })
}
