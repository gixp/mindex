import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { listRootScopedManagedFiles, resolvedFilename } from '@shared/managed-files'
import type { ProviderId } from '@shared/types'

export async function ensureRootManagedFiles(
  vaultRoot: string,
  provider: ProviderId
): Promise<void> {
  for (const spec of listRootScopedManagedFiles()) {
    const abs = path.join(vaultRoot, resolvedFilename(spec, provider))
    let exists = false
    try {
      await fsp.access(abs)
      exists = true
    } catch {}
    if (exists) continue
    if (!spec.defaultContent) continue
    try {
      await fsp.writeFile(abs, spec.defaultContent(vaultRoot, provider), 'utf8')
    } catch {}
  }
}
