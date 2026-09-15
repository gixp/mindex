import { registerOverlay } from '@/platform/registry/overlays'
import { SourceControlModal } from '@/features/git/components/SourceControlModal'

/** What this part of the app draws over the workspace. */
export function registerOverlays(): void {
  registerOverlay({ id: 'git.sourceControl', order: 4, Component: SourceControlModal })
}
