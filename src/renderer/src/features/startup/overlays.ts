import { registerOverlay } from '@/platform/registry/overlays'
import { StartupScreen } from '@/features/startup/components/StartupScreen'

/** What this part of the app draws over the workspace. */
export function registerOverlays(): void {
  registerOverlay({ id: 'startup.screen', order: 16, Component: StartupScreen })
}
