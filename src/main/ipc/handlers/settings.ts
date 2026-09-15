import { handle } from '@main/ipc/handle'
import { IPC } from '@shared/ipc-channels'
import { safe } from '@main/util/result'
import { getAppSettings, getCachedAppSettings, patchAppSettings } from '@main/settings/app-settings'
import {
  getVaultPolicy,
  getVaultSettings,
  patchVaultPolicy,
  patchVaultSettings
} from '@main/settings/vault-settings'
import { toProviderId } from '@main/providers/registry'
import { syncContextFilenames } from '@main/context/filename'
import { syncVaultTypesSkill } from '@main/skills/sync'
import { contextFilename } from '@shared/context-filename'
import { getVault } from '@main/vault/state'
import { engineScheduler, logEngine } from '@main/agent-engine'
import {
  armAutoRunsForFolderRels,
  armAutoRunsForPendingFolders,
  FEATURE as FOLDER_CONTEXT_FEATURE
} from '@main/folderContext/runner'
import { FEATURE as LIVING_INDEX_FEATURE } from '@main/livingindex/runner'
import { buildContextOverview } from '@main/suggestions/overview'
import { setNotificationsEnabled } from '@main/notifications/service'
import { registerAllExternalMcp, unregisterAllExternalMcp } from '@main/mcp/external-targets'

export function registerSettingsHandlers(): void {
  handle(IPC.settings.getApp, () => safe(async () => await getAppSettings()))

  handle(IPC.settings.setApp, (_e, patch) =>
    safe(async () => {
      const prevSettings = getCachedAppSettings()
      const wasContextEngineEnabled = prevSettings.engine?.contextEngineEnabled !== false
      const wasAutoContextEnabled =
        wasContextEngineEnabled && prevSettings.engine?.autoContextEnabled === true
      const prevProvider = toProviderId(prevSettings.engine?.provider)
      // `patchAppSettings` merges one level deep only, so a caller sending a
      // partial `analytics` object would replace the whole thing — taking the
      // install id and first-seen stamp with it, and silently turning this
      // machine into a brand-new install in every count that uses them. The
      // consent switch sends exactly that shape, so the sub-object is merged
      // here rather than trusting every future caller to remember.
      const merged =
        patch && typeof patch === 'object' && 'analytics' in patch
          ? { ...patch, analytics: { ...prevSettings.analytics, ...patch.analytics } }
          : patch
      const next = await patchAppSettings(merged)
      // Consent takes effect at once — a setting that only applies after a
      // restart is not really a consent control.
      if (patch && typeof patch === 'object' && 'analytics' in patch) {
        const { refreshAnalyticsConsent } = await import('@main/telemetry/analytics')
        void refreshAnalyticsConsent()
      }
      if (patch && typeof patch === 'object' && 'notificationsEnabled' in patch) {
        setNotificationsEnabled(next.notificationsEnabled !== false)
      }
      // The active provider decides what the context file is named. Renaming
      // is synchronous with the setting change — the caller's `setApp` only
      // resolves once the vault-wide rename is done, same as it renames once
      // at every vault open. Only reacts if a vault is actually open; a
      // provider chosen before any vault is opened is picked up by the next
      // open's own sync instead. Gated on the provider actually changing, not
      // merely on `engine` being part of the patch — `engine` is one nested
      // object, so any other field inside it (e.g. `autoContextEnabled`) has
      // to be sent as a full `engine` patch too, and re-running a vault-wide
      // rename walk for that would be wasted work at best. At worst, it silently
      // "resolves" folders that only had a stray file under a different
      // provider's name by renaming it into place — which satisfies
      // `hasContextFile` without anything having actually been regenerated.
      if (patch && typeof patch === 'object' && 'engine' in patch) {
        const provider = toProviderId(next.engine?.provider)
        const vault = getVault()
        if (provider && vault && provider !== prevProvider) {
          await syncContextFilenames(vault.root, contextFilename(provider)).catch(() => {})
        }

        // The generated note-type skill lives in the active provider's folder,
        // so it moves with the provider — and it also has its own switch, so
        // this runs on any `engine` patch rather than only on a change of CLI.
        if (vault) await syncVaultTypesSkill().catch(() => {})

        // Auto Context toggled — take effect immediately rather than waiting
        // for the next file change to notice the new mode. Masked by the
        // master switch the same way `wasAutoContextEnabled` is: turning the
        // master off reads as "auto turned off" here even if the underlying
        // auto setting is untouched, and turning it back on with auto already
        // true underneath re-arms everything, the same as flipping auto on.
        const isContextEngineEnabled = next.engine?.contextEngineEnabled !== false
        const isAutoContextEnabled =
          isContextEngineEnabled && next.engine?.autoContextEnabled === true
        // The master switch turning off cancels anything pending outright,
        // whether it was queued by auto or by a manual click that had not
        // started yet — nothing should still be running once it's off.
        if (vault && wasContextEngineEnabled && !isContextEngineEnabled) {
          for (const j of engineScheduler.pending()) {
            if (j.feature === FOLDER_CONTEXT_FEATURE || j.feature === LIVING_INDEX_FEATURE) {
              engineScheduler.cancel(j.scope)
            }
          }
        } else if (vault && isAutoContextEnabled && !wasAutoContextEnabled) {
          armAutoRunsForPendingFolders(vault.root)
          // status.ts only knows about folders touched by a live file event
          // this session — a folder with no context file at all, or one that
          // went stale before the watcher was ever running, never fires one.
          // The on-disk overview is the source of truth for those; fold them
          // in too so nothing sits waiting on a manual click while auto mode
          // is on.
          const overview = await buildContextOverview(vault.root).catch((err: unknown) => {
            logEngine(
              'error',
              `Auto Context sweep failed to read the vault overview: ${err instanceof Error ? err.message : String(err)}`,
              { feature: FOLDER_CONTEXT_FEATURE }
            )
            return null
          })
          if (overview) {
            const stale = overview.folders
              .filter((f) => f.staleness !== 'fresh' && !f.aiDisabled)
              .map((f) => f.folderRel)
            armAutoRunsForFolderRels(vault.root, stale)
            logEngine(
              'info',
              `Auto Context: armed ${stale.length} folder(s) missing or behind on switching to auto mode`,
              { feature: FOLDER_CONTEXT_FEATURE }
            )
          }
        } else if (!isAutoContextEnabled && wasAutoContextEnabled) {
          for (const j of engineScheduler.pending()) {
            if (j.feature === FOLDER_CONTEXT_FEATURE || j.feature === LIVING_INDEX_FEATURE) {
              engineScheduler.cancel(j.scope)
            }
          }
        }

        // Off by default, so this only ever runs when someone has explicitly
        // turned it on — see `AppSettings.engine.externalMcpEnabled`. Synced
        // to the current value rather than diffed against the previous one,
        // the same style `syncGeminiMcp` already uses elsewhere: idempotent
        // either way, so there is no state to get out of step with the file.
        if (next.engine?.externalMcpEnabled === true) {
          await registerAllExternalMcp().catch(() => [])
        } else {
          await unregisterAllExternalMcp().catch(() => {})
        }
      }
      return next
    })
  )

  handle(IPC.mcp.registerExternal, () => safe(async () => await registerAllExternalMcp()))

  handle(IPC.settings.getVault, () => safe(async () => await getVaultSettings()))

  handle(IPC.settings.setVault, (_e, patch) => safe(async () => await patchVaultSettings(patch)))

  handle(IPC.settings.getPolicy, () => safe(async () => await getVaultPolicy()))

  handle(IPC.settings.setPolicy, (_e, patch) => safe(async () => await patchVaultPolicy(patch)))
}
