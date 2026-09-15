import path from 'node:path'
import os from 'node:os'

export function projectCommandsDir(vaultRoot: string): string {
  return path.join(vaultRoot, '.claude', 'commands')
}

export function globalCommandsDir(): string {
  return path.join(os.homedir(), '.claude', 'commands')
}
