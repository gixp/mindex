import type { VaultInfo } from '@shared/types'

let current: VaultInfo | null = null

export function setVault(info: VaultInfo | null): void {
  current = info
}

export function getVault(): VaultInfo | null {
  return current
}

export function requireVault(): VaultInfo {
  if (!current) throw new Error('No vault is open')
  return current
}
