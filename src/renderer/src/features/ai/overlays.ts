import { registerOverlay } from '@/platform/registry/overlays'
import { ProposalDock } from '@/features/ai/components/ProposalDock'
import { CaptureHost } from '@/features/ai/components/CaptureHost'

/** What this part of the app draws over the workspace. */
export function registerOverlays(): void {
  registerOverlay({ id: 'ai.proposalDock', order: 15, Component: ProposalDock })
  // Between the dock and the gates, and there is no whole number left there.
  // The position decides what covers what: this is a modal and has to cover
  // the dock below it, while a startup or sign-in gate has to cover both. A
  // fraction says exactly that without renumbering a list whose order is a
  // decision someone else made and recorded.
  registerOverlay({ id: 'ai.capture', order: 15.5, Component: CaptureHost })
}
