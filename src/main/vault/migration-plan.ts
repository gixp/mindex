import { promises as fsp } from 'node:fs'
import path from 'node:path'
import type { MigrationAction, MigrationPlan } from '@shared/types'
import { listRootScopedManagedFiles, resolvedFilename } from '@shared/managed-files'
import { vaultSettingsFile, vaultPolicyFile } from '@main/util/paths'
import { currentProvider } from '@main/providers/engine-choice'

const IGNORE_DIRS = new Set([
  '.git',
  'node_modules',
  '.obsidian',
  '.mindex',
  '.vault',
  '.backups',
  '.claude',
  '.DS_Store'
])
const MAX_WALK_FILES = 50_000

interface WalkResult {
  fileCount: number
  totalBytes: number
}

export async function buildMigrationPlan(vaultRoot: string): Promise<MigrationPlan> {
  const vaultName = path.basename(vaultRoot)
  const actions: MigrationAction[] = []

  const needsMeta = !(await exists(vaultSettingsFile(vaultRoot)))
  const needsPolicy = !(await exists(vaultPolicyFile(vaultRoot)))
  if (needsMeta || needsPolicy) {
    const created: string[] = []
    if (needsMeta) created.push('.mindex/settings.json')
    if (needsPolicy) created.push('.mindex/policy.json')
    actions.push({
      kind: 'create-vault-meta',
      title: 'Create vault metadata',
      details: created.map((f) => `Create ${f}`)
    })
  }

  const walk = await walkVault(vaultRoot)

  const provider = currentProvider()
  const missingRoot: string[] = []
  for (const spec of listRootScopedManagedFiles()) {
    const filename = resolvedFilename(spec, provider)
    const abs = path.join(vaultRoot, filename)
    if (!(await exists(abs))) missingRoot.push(filename)
  }
  if (missingRoot.length > 0) {
    actions.push({
      kind: 'seed-root-managed',
      title: `Seed root file${missingRoot.length === 1 ? '' : 's'}`,
      details: missingRoot.map((f) => `Create ${f}`)
    })
  }

  actions.push({
    kind: 'enable-folder-context',
    title: 'Background: generate a per-folder context file',
    details: [
      'After opening, your engine will start writing short context files into',
      'each sub-folder (up to 4 at a time, throttled). You can pause or',
      'disable this in Settings → Folder context.'
    ]
  })

  const isAlreadyMindex = !needsMeta && !needsPolicy && missingRoot.length === 0

  const proposedBackupPath = path.join(
    vaultRoot,
    '.backups',
    `pre-migration-${timestampSlug()}.zip`
  )

  return {
    vaultRoot,
    vaultName,
    isAlreadyMindex,
    actions,
    backupFileCount: walk.fileCount,
    backupBytes: walk.totalBytes,
    proposedBackupPath
  }
}

async function walkVault(vaultRoot: string): Promise<WalkResult> {
  const out: WalkResult = { fileCount: 0, totalBytes: 0 }
  await walk(vaultRoot)
  return out

  async function walk(dir: string): Promise<void> {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (out.fileCount >= MAX_WALK_FILES) return
      if (IGNORE_DIRS.has(e.name)) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        await walk(full)
        continue
      }
      if (!e.isFile()) continue
      out.fileCount += 1
      try {
        const stat = await fsp.stat(full)
        out.totalBytes += stat.size
      } catch {}
    }
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p)
    return true
  } catch {
    return false
  }
}

function timestampSlug(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  )
}
