import { handle } from '@main/ipc/handle'
import { IPC } from '@shared/ipc-channels'
import { safe } from '@main/util/result'
import { currentVault } from '@main/vault/opener'
import type { FolderContextFile, FolderContextSnapshot, FolderStatusEntry } from '@shared/types'
import {
  disableAiSyncApi,
  enableAiSyncApi,
  listFolderContextApi,
  listFolderStatuses,
  readFolderContextApi,
  rescanAllFolderContextApi,
  rescanFolderContextApi
} from '@main/folderContext/api'

export function registerFolderContextHandlers(): void {
  handle(IPC.folderContext.list, () =>
    safe<FolderContextSnapshot>(async () => {
      const v = currentVault()
      if (!v) return { files: [], builtAt: Date.now() }
      return await listFolderContextApi(v.root)
    })
  )

  handle(IPC.folderContext.read, (_e, folderRel: string) =>
    safe<FolderContextFile | null>(async () => {
      const v = currentVault()
      if (!v) return null
      return await readFolderContextApi(v.root, folderRel)
    })
  )

  handle(IPC.folderContext.rescanFolder, (_e, folderRel: string) =>
    safe<void>(async () => {
      const v = currentVault()
      if (!v) throw new Error('No vault open')
      await rescanFolderContextApi(v.root, folderRel)
    })
  )

  handle(IPC.folderContext.rescanAll, () =>
    safe<void>(async () => {
      const v = currentVault()
      if (!v) throw new Error('No vault open')
      const snap = await listFolderContextApi(v.root)
      await rescanAllFolderContextApi(v.root, snap)
    })
  )

  handle(IPC.folderContext.status, () =>
    safe<FolderStatusEntry[]>(async () => {
      return listFolderStatuses()
    })
  )

  handle(IPC.folderContext.disableAiSync, (_e, folderRel: string) =>
    safe<void>(async () => {
      const v = currentVault()
      if (!v) throw new Error('No vault open')
      await disableAiSyncApi(v.root, folderRel)
    })
  )

  handle(IPC.folderContext.enableAiSync, (_e, folderRel: string) =>
    safe<void>(async () => {
      const v = currentVault()
      if (!v) throw new Error('No vault open')
      await enableAiSyncApi(folderRel)
    })
  )
}
