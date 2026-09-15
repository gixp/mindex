import { handle } from '@main/ipc/handle'
import type { IndexStats, VaultInfo } from '@shared/types'
import { IPC } from '@shared/ipc-channels'
import { safe } from '@main/util/result'
import { getAppSettings, removeRecentVault, removeOpenWorkspace } from '@main/settings/app-settings'
import {
  closeVault,
  createNewVault,
  currentVault,
  openVault,
  pickNewVaultDialog,
  pickVaultDialog
} from '@main/vault/opener'
import { buildMigrationPlan } from '@main/vault/migration-plan'
import { createPreMigrationBackup } from '@main/vault/migration-backup'
import type { MigrationPlan } from '@shared/types'
import { getStats } from '@main/index/indexer'
import { broadcast } from '@main/ipc/broadcast'

export function registerVaultHandlers(): void {
  handle(IPC.vault.pickRoot, () =>
    safe<VaultInfo>(async () => {
      const picked = await pickVaultDialog()
      if (!picked) throw new Error('Cancelled')
      const info = await openVault(picked)
      broadcast<VaultInfo>(IPC.events.vaultChanged, info)
      const stats = getStats()
      broadcast<IndexStats>(IPC.events.indexUpdated, stats)
      return info
    })
  )

  handle(IPC.vault.pickRootDialog, () =>
    safe<{ root: string }>(async () => {
      const picked = await pickVaultDialog()
      if (!picked) throw new Error('Cancelled')
      return { root: picked }
    })
  )

  handle(IPC.vault.analyze, (_e, root: string) =>
    safe<MigrationPlan>(async () => {
      return await buildMigrationPlan(root)
    })
  )

  handle(IPC.vault.openWithMigration, (_e, root: string, opts: { skipBackup: boolean }) =>
    safe<VaultInfo & { backupPath?: string }>(async () => {
      console.log('[migration] openWithMigration start', { root, opts })
      let backupPath: string | undefined
      if (!opts.skipBackup) {
        const plan = await buildMigrationPlan(root)
        console.log('[migration] plan', {
          actions: plan.actions.length,
          files: plan.backupFileCount,
          bytes: plan.backupBytes
        })
        if (plan.actions.length > 0 || plan.backupFileCount > 0) {
          console.log('[migration] zipping →', plan.proposedBackupPath)
          await createPreMigrationBackup(root, plan.proposedBackupPath)
          console.log('[migration] zip done')
          backupPath = plan.proposedBackupPath
        }
      }
      console.log('[migration] openVault start')
      const info = await openVault(root)
      console.log('[migration] openVault done', info.name)
      broadcast<VaultInfo>(IPC.events.vaultChanged, info)
      const stats = getStats()
      broadcast<IndexStats>(IPC.events.indexUpdated, stats)
      return { ...info, backupPath }
    })
  )

  handle(IPC.vault.createNew, () =>
    safe<VaultInfo>(async () => {
      const picked = await pickNewVaultDialog()
      if (!picked) throw new Error('Cancelled')
      const info = await createNewVault(picked)
      broadcast<VaultInfo>(IPC.events.vaultChanged, info)
      const stats = getStats()
      broadcast<IndexStats>(IPC.events.indexUpdated, stats)
      return info
    })
  )

  handle(IPC.vault.open, (_e, root: string) =>
    safe<VaultInfo>(async () => {
      const info = await openVault(root)
      broadcast<VaultInfo>(IPC.events.vaultChanged, info)
      const stats = getStats()
      broadcast<IndexStats>(IPC.events.indexUpdated, stats)
      return info
    })
  )

  handle(IPC.vault.close, () =>
    safe<void>(async () => {
      await closeVault()
      broadcast<null>(IPC.events.vaultChanged, null)
    })
  )

  handle(IPC.vault.current, () => safe(async () => currentVault()))

  handle(IPC.vault.recent, () => safe(async () => (await getAppSettings()).recentVaults))

  handle(IPC.vault.removeRecent, (_e, root: string) =>
    safe<void>(async () => {
      await removeRecentVault(root)
    })
  )

  handle(IPC.vault.openWorkspaces, () => safe(async () => (await getAppSettings()).openWorkspaces))

  handle(IPC.vault.removeOpenWorkspace, (_e, root: string) =>
    safe<void>(async () => {
      await removeOpenWorkspace(root)
    })
  )
}
