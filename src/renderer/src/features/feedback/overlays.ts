import { registerOverlay } from '@/platform/registry/overlays'
import { BugReportModal } from '@/features/feedback/components/BugReportModal'

/** What this part of the app draws over the workspace. */
export function registerOverlays(): void {
  registerOverlay({ id: 'feedback.bugReport', order: 12, Component: BugReportModal })
}
