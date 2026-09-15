import type { FolderContextSettings, VaultPolicy, VaultSettings } from '@shared/types'
import { ensureDir, readJson, writeJson } from '@main/util/fs-helpers'
import { vaultMetaDir, vaultPolicyFile, vaultSettingsFile } from '@main/util/paths'
import { requireVault } from '@main/vault/state'

export const DEFAULT_FOLDER_CONTEXT_SETTINGS: FolderContextSettings = {
  excludedPaths: ['Archive/', '.mindex/']
}

const DEFAULT_SETTINGS: VaultSettings = {
  defaultProjectFolder: 'Projects',
  livingIndexEnabled: true,
  ignoredPaths: ['node_modules', '.git', '.obsidian', '.mindex', '.vault'],
  folderContext: DEFAULT_FOLDER_CONTEXT_SETTINGS
}

const DEFAULT_POLICY: VaultPolicy = {
  writeIsolation: { enabled: false, allowedPaths: ['./'], deniedPaths: [] },
  aiAccessScope: { read: ['./'], write: ['./'] },
  encryption: { enabled: false },
  remoteSync: { enabled: false, url: '', schedule: '0 */6 * * *' },
  transcription: { engine: 'deepgram', language: 'auto' }
}

/**
 * `fileDisplay`, derived once per read from whatever is actually on disk.
 *
 * A vault written before the two old schemas (`treeRowDetails`, `folderView`)
 * merged has no `fileDisplay` at all — this fills it in from them, the same
 * "old key still read, never written" shape as `tabs ?? claudeTabs` above.
 * A vault that already has `fileDisplay` (from a patch made after the merge)
 * just gets it merged over the defaults; the old keys are never consulted
 * again once that happens; because it happens on read rather than being
 * written back, there is no migration step that can run twice or half-fail.
 *
 * Where the two old schemas actually disagreed (icons/date on in one, off in
 * the other), `treeRowDetails` wins — it was the tree's own setting, and the
 * tree is where most people go to change how their files look.
 */
function deriveFileDisplay(data: VaultSettings): NonNullable<VaultSettings['fileDisplay']> {
  if (data.fileDisplay) return data.fileDisplay
  const row = data.treeRowDetails
  const fv = data.folderView
  if (!row && !fv) return {}
  return {
    showFileIcons: row?.showFileIcons ?? fv?.files?.icons,
    showFolderIcons: row?.showFolderIcons ?? fv?.folders?.icons,
    showServiceFileIcons: row?.showServiceFileIcons,
    modified: row?.modified ?? fv?.files?.date,
    dateField: row?.dateField ?? fv?.files?.dateField,
    datePosition: row?.datePosition,
    preview: row?.preview,
    wrapTitle: row?.wrapTitle,
    fileCardSize: fv?.files?.size,
    folderChipSize: fv?.folders?.size
  }
}

export async function getVaultSettings(): Promise<VaultSettings> {
  const vault = requireVault()
  await ensureDir(vaultMetaDir(vault.root))
  const data = await readJson<VaultSettings>(vaultSettingsFile(vault.root))
  const merged = { ...DEFAULT_SETTINGS, ...(data ?? {}) }
  merged.fileDisplay = deriveFileDisplay(merged)
  return merged
}

export async function patchVaultSettings(patch: Partial<VaultSettings>): Promise<VaultSettings> {
  const vault = requireVault()
  const current = await getVaultSettings()
  const next: VaultSettings = { ...current, ...patch }
  await writeJson(vaultSettingsFile(vault.root), next)
  return next
}

export async function getVaultPolicy(): Promise<VaultPolicy> {
  const vault = requireVault()
  await ensureDir(vaultMetaDir(vault.root))
  const data = await readJson<VaultPolicy>(vaultPolicyFile(vault.root))
  return { ...DEFAULT_POLICY, ...(data ?? {}) }
}

export async function patchVaultPolicy(patch: Partial<VaultPolicy>): Promise<VaultPolicy> {
  const vault = requireVault()
  const current = await getVaultPolicy()
  const next: VaultPolicy = { ...current, ...patch }
  await writeJson(vaultPolicyFile(vault.root), next)
  return next
}

export async function ensureVaultMeta(): Promise<void> {
  const vault = requireVault()
  await ensureDir(vaultMetaDir(vault.root))
  const existing = await readJson<VaultSettings>(vaultSettingsFile(vault.root))
  if (!existing) {
    await writeJson(vaultSettingsFile(vault.root), DEFAULT_SETTINGS)
  }
  const policy = await readJson<VaultPolicy>(vaultPolicyFile(vault.root))
  if (!policy) {
    await writeJson(vaultPolicyFile(vault.root), DEFAULT_POLICY)
  }
}
