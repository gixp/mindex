import { registerOverlay } from '@/platform/registry/overlays'
import { OnboardingDialog } from '@/features/onboarding/components/OnboardingDialog'

/** What this part of the app draws over the workspace. */
export function registerOverlays(): void {
  registerOverlay({ id: 'onboarding.dialog', order: 20, Component: OnboardingDialog })
}
