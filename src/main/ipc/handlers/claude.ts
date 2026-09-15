import { handle } from '@main/ipc/handle'
import { IPC } from '@shared/ipc-channels'
import { safe } from '@main/util/result'
import { currentVault } from '@main/vault/opener'
import {
  deleteSession,
  listRecentChats,
  readSessionTitle,
  sessionFileExists,
  unwatchAll,
  unwatchProject,
  watchProject
} from '@main/claude/sessions'
import type { RecentChat } from '@main/claude/sessions'
import { type SlashCommandEntry } from '@shared/slash-commands'
import { listSlashCommands } from '@main/claude/config/commands'

export function registerClaudeHandlers(): void {
  handle(IPC.claude.getSessionTitle, (_e, sessionId: string) =>
    safe<string | null>(async () => {
      const v = currentVault()
      if (!v) return null
      return readSessionTitle(v.root, sessionId)
    })
  )

  handle(IPC.claude.sessionFileExists, (_e, sessionId: string) =>
    safe<boolean>(async () => {
      const v = currentVault()
      if (!v) return false
      return sessionFileExists(v.root, sessionId)
    })
  )

  handle(IPC.claude.watchProject, () =>
    safe<void>(async () => {
      const v = currentVault()
      if (!v) return
      unwatchAll()
      watchProject(v.root)
    })
  )

  handle(IPC.claude.unwatchProject, () =>
    safe<void>(async () => {
      const v = currentVault()
      if (!v) {
        unwatchAll()
        return
      }
      unwatchProject(v.root)
    })
  )

  handle(IPC.claude.listRecentChats, () =>
    safe<RecentChat[]>(async () => {
      const v = currentVault()
      if (!v) return []
      return listRecentChats(v.root)
    })
  )

  handle(IPC.claude.deleteSession, (_e, sessionId: string) =>
    safe<void>(async () => {
      const v = currentVault()
      if (!v) return
      deleteSession(v.root, sessionId)
    })
  )

  handle(IPC.claude.listCommands, () => safe<SlashCommandEntry[]>(async () => listSlashCommands()))
}
