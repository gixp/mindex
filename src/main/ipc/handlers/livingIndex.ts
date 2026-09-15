import { handle } from '@main/ipc/handle'
import { IPC } from '@shared/ipc-channels'
import { safe } from '@main/util/result'
import { rebuildRootContext } from '@main/livingindex/generator'

export function registerLivingIndexHandlers(): void {
  handle(IPC.livingIndex.rebuild, () =>
    safe<void>(async () => {
      await rebuildRootContext()
    })
  )
}
