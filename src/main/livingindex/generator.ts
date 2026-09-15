import { rescanLivingIndex } from './runner'
import { getVault } from '@main/vault/state'

export async function rebuildRootContext(): Promise<void> {
  const vault = getVault()
  if (!vault) return
  rescanLivingIndex(vault.root)
}
