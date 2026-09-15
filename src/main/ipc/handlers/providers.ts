import { handle } from '@main/ipc/handle'
import { IPC } from '@shared/ipc-channels'
import { safe } from '@main/util/result'
import type { ProviderInfo } from '@shared/types'
import { detectAllProviders } from '@main/providers/detect'
import { allProviderSpecs, providerSpec, toProviderId } from '@main/providers/registry'
import { fetchCodexModels } from '@main/providers/codex-catalogue'
import { installProvider } from '@main/providers/install'
import { openLoginTerminal } from '@main/providers/terminal'

export function registerProvidersHandlers(): void {
  async function buildProviderInfo(): Promise<ProviderInfo[]> {
    const [statuses, codexModels] = await Promise.all([
      detectAllProviders(),
      // Only Codex needs asking. Claude and Gemini take version-free aliases,
      // so their compiled-in lists cannot go stale; Codex wants concrete
      // slugs, so its list comes from the CLI itself.
      fetchCodexModels()
    ])
    return allProviderSpecs().map((spec) => {
      const models = (spec.id === 'codex' ? codexModels : null) ?? spec.models
      return {
        id: spec.id,
        label: spec.label,
        installHint: spec.installHint,
        loginHint: spec.loginHint,
        models: models.map((m) => ({ value: m.value, label: m.label, tier: m.tier })),
        // The CLI lists its models best-first, so the head of the list is the
        // right default — falling back to the spec's own when it came up empty.
        defaultModel: models[0]?.value ?? spec.defaultModel,
        status: statuses.find((s) => s.id === spec.id) ?? {
          id: spec.id,
          installed: false,
          authenticated: false
        }
      }
    })
  }

  handle(IPC.providers.detect, () => safe<ProviderInfo[]>(() => buildProviderInfo()))

  handle(IPC.providers.install, (_e, rawId: string) =>
    safe<ProviderInfo[]>(async () => {
      const id = toProviderId(rawId)
      if (!id) throw new Error(`Unknown provider: ${rawId}`)
      const result = await installProvider(id)
      if (!result.ok) throw new Error(result.error ?? 'Install failed')
      const info = await buildProviderInfo()
      // npm exiting cleanly is not the same as the CLI being runnable
      // afterwards, and the difference used to be invisible: the screen simply
      // put the Download button back, so the person clicked it again and got
      // the same nothing. If the probe still cannot find it, say that instead.
      const spec = providerSpec(id)
      if (info.find((p) => p.id === id)?.status.installed !== true) {
        throw new Error(
          `Installed, but \`${spec.bin}\` still could not be run afterwards. Try Re-check, or run \`${spec.installHint}\` in a terminal.`
        )
      }
      return info
    })
  )

  handle(IPC.providers.openLoginTerminal, (_e, rawId: string) =>
    safe<void>(async () => {
      const id = toProviderId(rawId)
      if (!id) throw new Error(`Unknown provider: ${rawId}`)
      const result = await openLoginTerminal(id)
      if (!result.ok) throw new Error(result.error ?? 'Could not open a terminal')
    })
  )
}
