/**
 * Every part of the app that draws over the workspace, gathered once.
 *
 * This is the only place that knows the full list, and it knows it as a list
 * of registrations rather than as markup: a feature declares its own overlay
 * in its own folder, and adding one no longer means editing the window's
 * root. The paint order lives with each declaration, so importing them in a
 * different order cannot change which dialog covers which.
 */
import { registerOverlays as registerAi } from '@/features/ai/overlays'
import { registerOverlays as registerEditor } from '@/features/editor/overlays'
import { registerOverlays as registerEngine } from '@/features/engine/overlays'
import { registerOverlays as registerFeedback } from '@/features/feedback/overlays'
import { registerOverlays as registerFolderContext } from '@/features/folder-context/overlays'
import { registerOverlays as registerGit } from '@/features/git/overlays'
import { registerOverlays as registerHistory } from '@/features/history/overlays'
import { registerOverlays as registerLayout } from '@/features/layout/overlays'
import { registerOverlays as registerLinks } from '@/features/links/overlays'
import { registerOverlays as registerOnboarding } from '@/features/onboarding/overlays'
import { registerOverlays as registerPalette } from '@/features/palette/overlays'
import { registerOverlays as registerStartup } from '@/features/startup/overlays'
import { registerOverlays as registerUpdate } from '@/features/update/overlays'
import { registerOverlays as registerVault } from '@/features/vault/overlays'
import { registerOverlays as registerUi } from '@/ui/overlays'
import { registerOverlays as registerPlatform } from '@/platform/overlays'

export function registerAllOverlays(): void {
  registerAi()
  registerEditor()
  registerEngine()
  registerFeedback()
  registerFolderContext()
  registerGit()
  registerHistory()
  registerLayout()
  registerLinks()
  registerOnboarding()
  registerPalette()
  registerStartup()
  registerUpdate()
  registerVault()
  registerUi()
  registerPlatform()
}
