import { handle } from '@main/ipc/handle'
import { BrowserWindow, dialog } from 'electron'
import { IPC } from '@shared/ipc-channels'
import { safe } from '@main/util/result'
import { currentVault } from '@main/vault/opener'
import type { ProviderId } from '@shared/types'
import { warmChatSession } from '@main/chat/runner'
import {
  cancelChatTurnApi,
  deleteChatSessionApi,
  getChatSessionApi,
  listChatSessionsApi,
  sendChatMessageApi
} from '@main/chat/api'
import type {
  ChatRespondToPermissionInput,
  ChatSendInput,
  ChatSession,
  ChatSessionSummary,
  ChatWarmInput
} from '@shared/chat'
import type { AcpCommand, AcpConfigOption } from '@shared/acp'
import {
  acpTabCommands,
  acpTabOptions,
  respondToPermission,
  setAcpTabOption
} from '@main/acp/chat-session'
import { writeAttachmentBlob } from '@main/chat/attachments'
import { getMainWindow } from '@main/ipc/broadcast'

export function registerChatHandlers(): void {
  handle(IPC.chat.send, (_e, input: ChatSendInput) =>
    safe<{ turnId: string; jobId: string }>(async () => {
      const v = currentVault()
      if (!v) throw new Error('No vault open')
      return sendChatMessageApi(input)
    })
  )

  handle(IPC.chat.cancel, (_e, sessionId: string) =>
    safe<void>(async () => {
      cancelChatTurnApi(sessionId)
    })
  )

  handle(IPC.chat.list, () =>
    safe<ChatSessionSummary[]>(async () => {
      const v = currentVault()
      if (!v) return []
      return listChatSessionsApi()
    })
  )

  handle(IPC.chat.get, (_e, sessionId: string) =>
    safe<ChatSession | null>(async () => {
      const v = currentVault()
      if (!v) return null
      return getChatSessionApi(sessionId)
    })
  )

  handle(IPC.chat.deleteSession, (_e, sessionId: string) =>
    safe<void>(async () => {
      const v = currentVault()
      if (!v) throw new Error('No vault open')
      await deleteChatSessionApi(sessionId)
    })
  )

  handle(IPC.chat.writeAttachmentBlob, (_e, input: { bytes: ArrayBuffer; extension: string }) =>
    safe<{ path: string }>(async () => writeAttachmentBlob(input))
  )

  handle(IPC.chat.warm, (_e, input: ChatWarmInput) =>
    safe<void>(async () => {
      if (!currentVault()) return
      // Never awaited by the renderer for its effect — the CLI takes about ten
      // seconds to become useful, and blocking a click on that would trade one
      // wait for another.
      await warmChatSession(input.sessionId, { ...input, userText: '' })
    })
  )

  handle(IPC.chat.getAgentOptions, (_e, input: { sessionId: string; provider: ProviderId }) =>
    safe<AcpConfigOption[]>(async () => acpTabOptions(input.sessionId, input.provider))
  )

  handle(IPC.chat.getAgentCommands, (_e, input: { sessionId: string; provider: ProviderId }) =>
    safe<AcpCommand[]>(async () => acpTabCommands(input.sessionId, input.provider))
  )

  handle(
    IPC.chat.setAgentOption,
    (
      _e,
      input: {
        sessionId: string
        provider: ProviderId
        optionId: string
        value: string | boolean
      }
    ) =>
      safe<boolean>(async () =>
        setAcpTabOption(input.sessionId, input.provider, input.optionId, input.value)
      )
  )

  handle(IPC.chat.respondToPermission, (_e, input: ChatRespondToPermissionInput) =>
    safe<boolean>(async () => respondToPermission(input.requestId, input.optionId))
  )

  handle(IPC.chat.pickAttachments, () =>
    safe<string[]>(async () => {
      const win = getMainWindow() ?? BrowserWindow.getFocusedWindow() ?? undefined
      const result = await (win
        ? dialog.showOpenDialog(win, {
            title: 'Attach files',
            properties: ['openFile', 'multiSelections']
          })
        : dialog.showOpenDialog({
            title: 'Attach files',
            properties: ['openFile', 'multiSelections']
          }))
      return result.canceled ? [] : result.filePaths
    })
  )
}
