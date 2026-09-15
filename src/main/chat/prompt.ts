import type { ChatMessage, ChatTurn } from '@shared/chat'

const HISTORY_MAX_TURNS = 12

export interface BuildChatPromptInput {
  history: ChatTurn[]
  userText: string
  isFirstTurn: boolean
}

export function buildChatPrompt(input: BuildChatPromptInput): string {
  const user = input.userText.trim()
  const trimmedHistory = truncateHistory(input.history)
  if (trimmedHistory.length === 0) return user

  const lines: string[] = []
  for (const t of trimmedHistory) {
    if (t.user) lines.push(formatMessage(t.user))
    if (t.assistant && t.status === 'done') lines.push(formatMessage(t.assistant))
  }
  return `${lines.join('\n\n')}\n\nUser: ${user}`
}

function truncateHistory(history: ChatTurn[]): ChatTurn[] {
  if (history.length <= HISTORY_MAX_TURNS) return history
  return history.slice(-HISTORY_MAX_TURNS)
}

function formatMessage(m: ChatMessage): string {
  const speaker = m.role === 'user' ? 'User' : 'Assistant'
  return `${speaker}: ${m.text.trim()}`
}
