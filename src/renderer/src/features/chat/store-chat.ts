import { create } from 'zustand'
import type { ProviderId } from '@shared/types'
import type {
  ChatAssistantTextPayload,
  ChatEffort,
  ChatMessage,
  ChatPart,
  ChatPermissionMode,
  ChatPermissionRequestPayload,
  ChatPermissionResolvedPayload,
  ChatSendInput,
  ChatSession,
  ChatTextPart,
  ChatToolPart,
  ChatToolResultPayload,
  ChatToolUsePayload,
  ChatTurn,
  ChatTurnDonePayload,
  ChatTurnStartPayload
} from '@shared/chat'
import { api } from '@/platform/api'
import { useTabsStore, registerChatContentProbe } from '@/features/terminal/store-tabs'

interface ChatState {
  sessions: Record<string, ChatSession>
  loading: Record<string, boolean>

  init(): () => void
  ensureLoaded(sessionId: string): Promise<void>
  /** Start this tab's CLI early so the first message does not pay for it. */
  warm(sessionId: string): void
  send(input: ChatSendInput): Promise<void>
  cancel(sessionId: string): Promise<void>
  removeSession(sessionId: string): Promise<void>
  /** Answers a live permission prompt. `optionId: null` declines it. */
  respondToPermission(sessionId: string, requestId: string, optionId: string | null): Promise<void>
}

let installed: { off: () => void } | null = null

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: {},
  loading: {},
  init() {
    if (installed) return installed.off
    const offStart = api().on.chatTurnStart((p: ChatTurnStartPayload) => {
      applyTurnStart(set, get, p)
    })
    const offText = api().on.chatAssistantText((p: ChatAssistantTextPayload) => {
      applyAssistantDelta(set, get, p)
    })
    const offTool = api().on.chatToolUse((p: ChatToolUsePayload) => {
      applyToolUse(set, get, p)
    })
    const offToolResult = api().on.chatToolResult((p: ChatToolResultPayload) => {
      applyToolResult(set, get, p)
    })
    const offDone = api().on.chatTurnDone((p: ChatTurnDonePayload) => {
      applyTurnDone(set, get, p)
    })
    const offSession = api().on.chatSessionUpdated(({ sessionId }) => {
      const session = get().sessions[sessionId]
      const streaming = session?.turns.some(
        (t) => t.status === 'streaming' || t.status === 'pending'
      )
      if (streaming) return
      void reloadSession(set, sessionId)
    })
    const offPermissionRequest = api().on.chatPermissionRequest(
      (p: ChatPermissionRequestPayload) => {
        applyPermissionRequest(set, p)
      }
    )
    const offPermissionResolved = api().on.chatPermissionResolved(
      (p: ChatPermissionResolvedPayload) => {
        applyPermissionResolved(set, p)
      }
    )
    const off = (): void => {
      offStart()
      offText()
      offTool()
      offToolResult()
      offDone()
      offSession()
      offPermissionRequest()
      offPermissionResolved()
      installed = null
    }
    installed = { off }
    return off
  },

  warm(sessionId) {
    const tab = useTabsStore.getState().tabs.find((t) => t.id === sessionId)
    const cfg = tab?.chat
    // Fire-and-forget on purpose: the CLI needs about ten seconds to be
    // useful, and the point is to spend them before the user types, not to
    // make anything wait on them.
    void api().chat.warm({
      sessionId,
      provider: cfg?.provider,
      model: cfg?.model,
      effort: cfg?.effort,
      permissionMode: cfg?.permissionMode
    })
  },

  async ensureLoaded(sessionId) {
    const s = get()
    if (s.sessions[sessionId] || s.loading[sessionId]) return
    set((prev) => ({ loading: { ...prev.loading, [sessionId]: true } }))
    await reloadSession(set, sessionId)
    set((prev) => {
      const next = { ...prev.loading }
      delete next[sessionId]
      return { loading: next }
    })
  },

  async send(input) {
    await api().chat.send(input)
  },

  async cancel(sessionId) {
    await api().chat.cancel(sessionId)
  },

  async removeSession(sessionId) {
    await api().chat.deleteSession(sessionId)
    set((prev) => {
      const next = { ...prev.sessions }
      delete next[sessionId]
      return { sessions: next }
    })
  },

  async respondToPermission(sessionId, requestId, optionId) {
    // Cleared here rather than waiting on the `permissionResolved` broadcast:
    // that round trip is what makes the choice real, but the buttons should
    // not sit clickable for the gap while it's in flight.
    set((prev) => {
      const session = prev.sessions[sessionId]
      if (!session) return prev
      const turns = session.turns.map((t) =>
        t.pendingPermission?.requestId === requestId ? { ...t, pendingPermission: undefined } : t
      )
      return { sessions: { ...prev.sessions, [sessionId]: { ...session, turns } } }
    })
    await api().chat.respondToPermission({ sessionId, requestId, optionId })
  }
}))

async function reloadSession(
  set: (fn: (prev: ChatState) => Partial<ChatState>) => void,
  sessionId: string
): Promise<void> {
  const res = await api().chat.get(sessionId)
  if (!res.ok) return
  const session = res.data
  if (!session) {
    set((prev) => {
      const next = { ...prev.sessions }
      delete next[sessionId]
      return { sessions: next }
    })
    return
  }
  set((prev) => ({ sessions: { ...prev.sessions, [sessionId]: session } }))
}

function applyTurnStart(
  set: (fn: (prev: ChatState) => Partial<ChatState>) => void,
  get: () => ChatState,
  p: ChatTurnStartPayload
): void {
  set((prev) => {
    const existing = prev.sessions[p.sessionId]
    const now = Date.now()
    const newTurn: ChatTurn = {
      id: p.turnId,
      user: p.user,
      status: 'pending',
      startedAt: now
    }
    const session: ChatSession = existing
      ? { ...existing, turns: [...existing.turns, newTurn], updatedAt: now }
      : {
          id: p.sessionId,
          createdAt: now,
          updatedAt: now,
          turns: [newTurn]
        }
    return {
      sessions: { ...prev.sessions, [p.sessionId]: session }
    }
  })
  void reloadSession(set, p.sessionId)
}

function concatText(parts: ChatPart[]): string {
  return parts
    .filter((p): p is ChatTextPart => p.type === 'text')
    .map((p) => p.text)
    .join('')
}

function applyAssistantDelta(
  set: (fn: (prev: ChatState) => Partial<ChatState>) => void,
  _get: () => ChatState,
  p: ChatAssistantTextPayload
): void {
  set((prev) => {
    const session = prev.sessions[p.sessionId]
    if (!session) return prev
    const turns = session.turns.map((t) => {
      if (t.id !== p.turnId) return t
      const parts = (t.assistant?.parts ?? []).slice()
      const last = parts[parts.length - 1]
      if (last && last.type === 'text') {
        parts[parts.length - 1] = { ...last, text: last.text + p.deltaText }
      } else {
        parts.push({ type: 'text', text: p.deltaText })
      }
      const assistant: ChatMessage = t.assistant
        ? { ...t.assistant, parts, text: concatText(parts) }
        : {
            id: `${t.id}-a`,
            role: 'assistant',
            ts: Date.now(),
            parts,
            text: concatText(parts)
          }
      return { ...t, assistant, status: 'streaming' as const }
    })
    return {
      sessions: {
        ...prev.sessions,
        [p.sessionId]: { ...session, turns, updatedAt: Date.now() }
      }
    }
  })
}

function applyToolUse(
  set: (fn: (prev: ChatState) => Partial<ChatState>) => void,
  _get: () => ChatState,
  p: ChatToolUsePayload
): void {
  set((prev) => {
    const session = prev.sessions[p.sessionId]
    if (!session) return prev
    const turns = session.turns.map((t) => {
      if (t.id !== p.turnId) return t
      const toolPart: ChatToolPart = {
        type: 'tool',
        id: p.id,
        name: p.name,
        input: p.input,
        status: 'running'
      }
      const parts = [...(t.assistant?.parts ?? []), toolPart]
      const assistant: ChatMessage = t.assistant
        ? { ...t.assistant, parts }
        : { id: `${t.id}-a`, role: 'assistant', text: '', ts: Date.now(), parts }
      return {
        ...t,
        assistant,
        status: t.status === 'pending' ? ('streaming' as const) : t.status
      }
    })
    return {
      sessions: {
        ...prev.sessions,
        [p.sessionId]: { ...session, turns, updatedAt: Date.now() }
      }
    }
  })
}

function applyToolResult(
  set: (fn: (prev: ChatState) => Partial<ChatState>) => void,
  _get: () => ChatState,
  p: ChatToolResultPayload
): void {
  set((prev) => {
    const session = prev.sessions[p.sessionId]
    if (!session) return prev
    const turns = session.turns.map((t) => {
      if (t.id !== p.turnId || !t.assistant?.parts) return t
      const status: ChatToolPart['status'] = p.isError ? 'error' : 'done'
      let matched = false
      let parts = t.assistant.parts.map((part) => {
        if (part.type === 'tool' && part.id === p.toolUseId) {
          matched = true
          return { ...part, result: p.preview, status }
        }
        return part
      })
      if (!matched) {
        const arr = parts.slice()
        for (let i = arr.length - 1; i >= 0; i--) {
          const part = arr[i]!
          if (part.type === 'tool' && part.status === 'running') {
            arr[i] = { ...part, result: p.preview, status }
            break
          }
        }
        parts = arr
      }
      return { ...t, assistant: { ...t.assistant, parts } }
    })
    return {
      sessions: {
        ...prev.sessions,
        [p.sessionId]: { ...session, turns, updatedAt: Date.now() }
      }
    }
  })
}

function applyPermissionRequest(
  set: (fn: (prev: ChatState) => Partial<ChatState>) => void,
  p: ChatPermissionRequestPayload
): void {
  set((prev) => {
    const session = prev.sessions[p.sessionId]
    if (!session) return prev
    const turns = session.turns.map((t) =>
      t.id === p.turnId
        ? {
            ...t,
            pendingPermission: {
              requestId: p.requestId,
              toolCallId: p.toolCallId,
              title: p.title,
              toolKind: p.toolKind,
              diff: p.diff,
              options: p.options
            }
          }
        : t
    )
    return {
      sessions: { ...prev.sessions, [p.sessionId]: { ...session, turns, updatedAt: Date.now() } }
    }
  })
}

function applyPermissionResolved(
  set: (fn: (prev: ChatState) => Partial<ChatState>) => void,
  p: ChatPermissionResolvedPayload
): void {
  set((prev) => {
    const session = prev.sessions[p.sessionId]
    if (!session) return prev
    const turns = session.turns.map((t) =>
      t.id === p.turnId && t.pendingPermission?.requestId === p.requestId
        ? { ...t, pendingPermission: undefined }
        : t
    )
    return { sessions: { ...prev.sessions, [p.sessionId]: { ...session, turns } } }
  })
}

const TAB_TITLE_RE = /^[ \t]*@@title:[ \t]*(.+?)[ \t]*$/m
function extractTabTitle(text: string): { title: string | null; cleaned: string } {
  const m = text.match(TAB_TITLE_RE)
  if (!m || !m[1]) return { title: null, cleaned: text }
  const title = m[1].trim().slice(0, 60)
  const cleaned = text
    .replace(/^[ \t]*@@title:[ \t]*.+?[ \t]*$\n?/m, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { title: title || null, cleaned }
}

function applyTurnDone(
  set: (fn: (prev: ChatState) => Partial<ChatState>) => void,
  _get: () => ChatState,
  p: ChatTurnDonePayload
): void {
  let pendingTitle: string | null = null
  set((prev) => {
    const session = prev.sessions[p.sessionId]
    if (!session) return prev
    const turns = session.turns.map((t) => {
      if (t.id !== p.turnId) return t
      let assistant = t.assistant
      if (p.ok) {
        let parts = (assistant?.parts ?? []).slice()
        const hasText = parts.some((pt) => pt.type === 'text' && pt.text.trim().length > 0)
        if (!hasText && p.finalText) parts.push({ type: 'text', text: p.finalText })
        parts = parts.map((pt) => {
          if (pt.type !== 'text') return pt
          const { title, cleaned } = extractTabTitle(pt.text)
          if (title && !pendingTitle) pendingTitle = title
          return cleaned === pt.text ? pt : { ...pt, text: cleaned }
        })
        if (assistant || parts.length > 0) {
          const text = concatText(parts) || extractTabTitle(p.finalText ?? '').cleaned
          assistant = assistant
            ? { ...assistant, parts, text }
            : { id: `${t.id}-a`, role: 'assistant', ts: Date.now(), parts, text }
        }
      }
      // A turn that is over cannot still be running a tool. Nothing else ever
      // closes these: a tool card leaves `running` when the agent says so, and
      // an agent that died mid-call — the connection dropped, the adapter
      // errored — never says so. The card then span for as long as the tab
      // stayed open, directly under the red line explaining that the turn had
      // failed. Two opposite claims about the same moment.
      //
      // A failed turn marks them failed; a turn that ended cleanly without
      // closing one marks it done, because the work it describes did finish.
      const open = assistant?.parts ?? []
      if (open.some((pt) => pt.type === 'tool' && pt.status === 'running')) {
        assistant = {
          ...assistant!,
          parts: open.map((pt) =>
            pt.type === 'tool' && pt.status === 'running'
              ? { ...pt, status: p.ok ? ('done' as const) : ('error' as const) }
              : pt
          )
        }
      }

      return {
        ...t,
        assistant,
        status: p.ok ? ('done' as const) : ('failed' as const),
        errorMessage: p.errorMessage,
        errorReason: p.errorReason,
        finishedAt: Date.now(),
        usage: p.usage ?? t.usage,
        // A turn that has finished cannot still be waiting on someone — the
        // `permissionResolved` broadcast should already have cleared this,
        // this is only the backstop for whatever order the two arrive in.
        pendingPermission: undefined
      }
    })
    return {
      sessions: {
        ...prev.sessions,
        [p.sessionId]: { ...session, turns, updatedAt: Date.now() }
      }
    }
  })
  if (pendingTitle) {
    const store = useTabsStore.getState()
    const tab = store.tabs.find((t) => t.id === p.sessionId)
    if (tab && !tab.customTitle) store.setCustomTitle(p.sessionId, pendingTitle)
  }
}

// Lets the tab store ask whether a chat has anything in it without importing
// this module and creating a cycle. See registerChatContentProbe.
registerChatContentProbe(
  (sessionId) => (useChatStore.getState().sessions[sessionId]?.turns.length ?? 0) > 0
)
