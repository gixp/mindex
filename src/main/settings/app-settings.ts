import path from 'node:path'
import { ulid } from 'ulid'
import type { AppSettings, RecentVault, VaultInfo } from '@shared/types'
import { ensureDir, readJson, writeJson } from '@main/util/fs-helpers'
import { appConfigDir, appConfigFile, isPathInside } from '@main/util/paths'

const FILE = 'app-settings.json'
const RECENT_LIMIT = 10

const DEFAULTS: AppSettings = {
  recentVaults: [],
  openWorkspaces: [],
  panelSizes: { left: 20, center: 50, right: 30 },
  leftPanelHidden: false,
  rightPanelHidden: true
}

interface LegacyIconSettings {
  iconOverrides?: Record<string, string>
  iconColorOverrides?: Record<string, string>
}

let cached: AppSettings | null = null

async function load(): Promise<AppSettings> {
  if (cached) return cached
  await ensureDir(appConfigDir())
  const data = await readJson<AppSettings>(appConfigFile(FILE))
  cached = { ...DEFAULTS, ...(data ?? {}) }
  return cached
}

async function save(s: AppSettings): Promise<void> {
  cached = s
  await writeJson(appConfigFile(FILE), s)
}

export async function getAppSettings(): Promise<AppSettings> {
  return await load()
}

/** Synchronous read of whatever was last loaded/saved, for the handful of call
 *  sites that are sync callbacks (file-watcher handlers) with no room to
 *  await. Falls back to `DEFAULTS` if nothing has loaded yet — in practice
 *  `getAppSettings()` runs early enough at startup that this is warm well
 *  before any of those callbacks can fire. */
export function getCachedAppSettings(): AppSettings {
  return cached ?? DEFAULTS
}

export async function patchAppSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await load()
  const next: AppSettings = { ...current, ...patch }
  await save(next)
  return next
}

/** Ensure a stable anonymous analytics install id exists. Returns the id plus
 *  whether this call created it (i.e. this is the first run on this machine).
 *  Never tied to note content — purely an opaque ULID. */
export async function ensureAnalyticsIdentity(): Promise<{
  installId: string
  isFirstRun: boolean
}> {
  const current = await load()
  if (current.analytics?.installId) {
    return { installId: current.analytics.installId, isFirstRun: false }
  }
  const installId = ulid()
  await save({
    ...current,
    analytics: { ...current.analytics, installId, firstSeenAt: Date.now() }
  })
  return { installId, isFirstRun: true }
}

/** Merge-patch the analytics sub-object without clobbering sibling fields. */
export async function patchAnalytics(
  patch: Partial<NonNullable<AppSettings['analytics']>>
): Promise<AppSettings> {
  const current = await load()
  return await patchAppSettings({ analytics: { ...current.analytics, ...patch } })
}

export async function recordRecentVault(info: VaultInfo): Promise<void> {
  const current = await load()
  const filtered = current.recentVaults.filter((r) => r.root !== info.root)
  const recent: RecentVault = {
    root: info.root,
    name: info.name,
    lastOpened: Date.now()
  }
  const next: AppSettings = {
    ...current,
    recentVaults: [recent, ...filtered].slice(0, RECENT_LIMIT),
    lastVault: info.root
  }
  await save(next)
}

export async function removeRecentVault(root: string): Promise<void> {
  const current = await load()
  const filtered = current.recentVaults.filter((r) => r.root !== root)
  await save({ ...current, recentVaults: filtered })
}

/** Pin a workspace to the switcher. Unlike `recordRecentVault`, this list is
 *  never auto-pruned by size or recency — entries only leave via an explicit
 *  close (`removeOpenWorkspace`). */
export async function addOpenWorkspace(info: VaultInfo): Promise<void> {
  const current = await load()
  const filtered = current.openWorkspaces.filter((r) => r.root !== info.root)
  const entry: RecentVault = {
    root: info.root,
    name: info.name,
    lastOpened: Date.now()
  }
  await save({ ...current, openWorkspaces: [entry, ...filtered] })
}

export async function removeOpenWorkspace(root: string): Promise<void> {
  const current = await load()
  const filtered = current.openWorkspaces.filter((r) => r.root !== root)
  await save({ ...current, openWorkspaces: filtered })
}

export function nameFromPath(absPath: string): string {
  return path.basename(absPath) || absPath
}

export async function takeAppIconOverridesForVault(
  vaultRoot: string
): Promise<Required<LegacyIconSettings>> {
  const current = await load()
  const legacy = current as AppSettings & LegacyIconSettings
  const allIcon = legacy.iconOverrides ?? {}
  const allColor = legacy.iconColorOverrides ?? {}
  if (Object.keys(allIcon).length === 0 && Object.keys(allColor).length === 0) {
    return { iconOverrides: {}, iconColorOverrides: {} }
  }
  const belongs = (key: string): boolean => !path.isAbsolute(key) || isPathInside(key, vaultRoot)
  const split = (
    all: Record<string, string>
  ): { moved: Record<string, string>; leftover: Record<string, string> } => {
    const moved: Record<string, string> = {}
    const leftover: Record<string, string> = {}
    for (const [k, v] of Object.entries(all)) {
      if (belongs(k)) moved[k] = v
      else leftover[k] = v
    }
    return { moved, leftover }
  }
  const icon = split(allIcon)
  const color = split(allColor)

  const next = { ...current } as AppSettings & LegacyIconSettings
  if (Object.keys(icon.leftover).length > 0) next.iconOverrides = icon.leftover
  else delete next.iconOverrides
  if (Object.keys(color.leftover).length > 0) next.iconColorOverrides = color.leftover
  else delete next.iconColorOverrides
  await save(next)

  return { iconOverrides: icon.moved, iconColorOverrides: color.moved }
}
