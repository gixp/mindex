import { registerOverlay } from '@/platform/registry/overlays'
import { CommandPalette } from '@/features/palette/components/CommandPalette'

/** What this part of the app draws over the workspace. */
export function registerOverlays(): void {
  registerOverlay({ id: 'palette.command', order: 2, Component: CommandPalette })
}
