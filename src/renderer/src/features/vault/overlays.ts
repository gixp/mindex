import { registerOverlay } from '@/platform/registry/overlays'
import { CloneVaultDialogConnected } from '@/features/vault/components/CloneVaultDialogConnected'
import { MigrationConfirmDialog } from '@/features/vault/components/MigrationConfirmDialog'

/** What this part of the app draws over the workspace. */
export function registerOverlays(): void {
  registerOverlay({ id: 'vault.clone', order: 5, Component: CloneVaultDialogConnected })
  registerOverlay({ id: 'vault.migration', order: 7, Component: MigrationConfirmDialog })
}
