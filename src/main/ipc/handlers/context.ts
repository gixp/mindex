import { handle } from '@main/ipc/handle'
import { IPC } from '@shared/ipc-channels'
import { safe } from '@main/util/result'
import { currentVault } from '@main/vault/opener'
import { buildContextOverview } from '@main/suggestions/overview'
import type { ContextOverview } from '@shared/suggestions'

export function registerContextHandlers(): void {
  handle(IPC.context.overview, () =>
    safe<ContextOverview>(async () => {
      const v = currentVault()
      if (!v) throw new Error('No vault open')
      return await buildContextOverview(v.root)
    })
  )
}
