import type { ChatSendInput, ChatSession, ChatSessionSummary } from '@shared/chat'
import { deleteSession as deleteSessionInStore, getSession, listSessionSummaries } from './store'
import { cancelChatTurn, enqueueChatTurn } from './runner'
import { endAcpChatSession } from '@main/acp/chat-session'
import { setBridgeScope } from '@main/mcp/bridge'
import { withRequestShape } from './request-shape'

export function sendChatMessageApi(input: ChatSendInput): { turnId: string; jobId: string } {
  const text = input.text.trim()
  if (!text) throw new Error('Chat message is empty')
  // Moved before the turn is queued, so the tools this message reaches for are
  // already fenced when the first of them is called. The conversation's key is
  // its own id — the same one its tool server was handed.
  setBridgeScope(input.sessionId, input.shape?.scope ?? null)
  return enqueueChatTurn({
    sessionId: input.sessionId,
    // The choice becomes words here rather than in the window: this is where a
    // message is assembled, and an instruction said in two places is an
    // instruction that will eventually disagree with itself.
    userText: withRequestShape(text, input.shape, input.shape?.scope?.note ?? ''),
    attachments: input.attachments,
    provider: input.provider,
    model: input.model,
    effort: input.effort,
    permissionMode: input.permissionMode
  })
}

export function cancelChatTurnApi(sessionId: string): void {
  cancelChatTurn(sessionId)
}

export function listChatSessionsApi(): ChatSessionSummary[] {
  return listSessionSummaries()
}

export function getChatSessionApi(sessionId: string): ChatSession | null {
  return getSession(sessionId) ?? null
}

export async function deleteChatSessionApi(sessionId: string): Promise<void> {
  // Closing the tab ends its session. Without this the connection would sit
  // there holding a conversation that no longer exists anywhere else.
  endAcpChatSession(sessionId)
  cancelChatTurn(sessionId)
  await deleteSessionInStore(sessionId)
}
