import type { ProviderId } from '@shared/types'
import { getCachedAppSettings } from '@main/settings/app-settings'
import { currentProvider } from '@main/providers/engine-choice'
import { getVault } from '@main/vault/state'
import { listTypeDefs } from '@main/types/definitions'
import { removeTypesSkill, syncTypesSkill } from './generate'
import { syncGeminiMcp } from '@main/mcp/gemini-settings'

const ALL_PROVIDERS: ProviderId[] = ['claude', 'codex', 'gemini']

/**
 * Bring the generated note-type skill in line with the vault, the active
 * provider and the setting — the one entry point every caller uses.
 *
 * Runs on vault open, on a type being saved or reset, and on a change of
 * provider. Cheap when there is nothing to do: the writer compares content
 * first and returns without touching the file when it matches.
 */
export async function syncVaultTypesSkill(): Promise<void> {
  const vault = getVault()
  if (!vault) return

  await syncGeminiMcp(vault.root, {
    provider: currentProvider(),
    enabled: getCachedAppSettings().engine?.searchToolEnabled !== false
  }).catch(() => {})

  const enabled = getCachedAppSettings().engine?.vaultSkillEnabled !== false
  if (!enabled) {
    for (const provider of ALL_PROVIDERS) {
      await removeTypesSkill(vault.root, provider).catch(() => {})
    }
    return
  }

  const defs = await listTypeDefs()
  const provider = currentProvider()
  const written = await syncTypesSkill(vault.root, provider, defs, ALL_PROVIDERS)
  if (!written) {
    console.log(`[skills] ${provider}: mindex-note-types is user-owned — not regenerated`)
  }
}
