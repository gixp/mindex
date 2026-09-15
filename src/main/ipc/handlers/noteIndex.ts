import { handle } from '@main/ipc/handle'
import type { IndexStats } from '@shared/types'
import { IPC } from '@shared/ipc-channels'
import { safe } from '@main/util/result'
import { getStats, rebuildIndex, getBacklinks, getLinkHealth, listTasks } from '@main/index/indexer'
import { broadcast } from '@main/ipc/broadcast'

export function registerIndexHandlers(): void {
  handle(IPC.index.stats, () => safe(async () => getStats()))

  handle(IPC.index.rebuild, () =>
    safe(async () => {
      const stats = await rebuildIndex()
      broadcast<IndexStats>(IPC.events.indexUpdated, stats)
      return stats
    })
  )

  handle(IPC.index.backlinks, (_e, p: string) => safe(async () => getBacklinks(p)))

  handle(IPC.index.linkHealth, () => safe(async () => getLinkHealth()))

  handle(IPC.index.tasks, () => safe(async () => listTasks()))
}
