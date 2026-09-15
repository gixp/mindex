import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  ChatMessage,
  ChatPart,
  ChatSession,
  ChatSessionSummary,
  ChatTextPart,
  ChatToolPart,
  ChatTurn
} from '@shared/chat'
import { readJson, writeJson } from '@main/util/fs-helpers'
import { chatDir, chatSessionFile, legacyVoiceDir } from '@main/util/paths'

const sessions = new Map<string, ChatSession>()
let vaultRoot: string | null = null
let updateListener: ((sessionId: string) => void) | null = null
const persistTimers = new Map<string, NodeJS.Timeout>()
const PERSIST_DEBOUNCE_MS = 150

/**
 * Move `.mindex/voice/` to `.mindex/chat/` once.
 *
 * The directory was named after the module, and the module was renamed — but
 * the files in it are the user's actual conversations, so this renames rather
 * than starting empty. A rename, never a copy-and-delete: an interrupted run
 * then leaves one directory or the other, never half of each. Skipped if the
 * new directory already exists, so it can only ever run once.
 */
async function migrateLegacyDir(vaultRoot: string, target: string): Promise<void> {
  const legacy = legacyVoiceDir(vaultRoot)
  try {
    if (await exists(target)) return
    if (!(await exists(legacy))) return
    await fs.rename(legacy, target)
    console.log(`[chat] migrated ${legacy} → ${target}`)
  } catch {
    /* a failed migration must not stop the vault from opening */
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

export function setChatUpdateListener(listener: ((sessionId: string) => void) | null): void {
  updateListener = listener
}

export async function startChatStore(opts: { vaultRoot: string }): Promise<{ stop(): void }> {
  vaultRoot = opts.vaultRoot
  sessions.clear()
  const dir = chatDir(opts.vaultRoot)
  await migrateLegacyDir(opts.vaultRoot, dir)
  try {
    await fs.mkdir(dir, { recursive: true })
    const entries = await fs.readdir(dir)
    for (const name of entries) {
      if (!name.endsWith('.json')) continue
      const sid = name.replace(/\.json$/, '')
      const loaded = await readJson<ChatSession>(path.join(dir, name))
      if (!loaded) continue
      loaded.turns = loaded.turns.map((t) =>
        t.status === 'pending' || t.status === 'streaming'
          ? {
              ...t,
              status: 'failed',
              errorMessage: 'Interrupted by app restart',
              finishedAt: Date.now()
            }
          : t
      )
      sessions.set(sid, loaded)
    }
  } catch {}
  return {
    stop() {
      for (const t of persistTimers.values()) clearTimeout(t)
      persistTimers.clear()
      sessions.clear()
      vaultRoot = null
    }
  }
}

export function getSession(sessionId: string): ChatSession | undefined {
  return sessions.get(sessionId)
}

export function ensureSession(sessionId: string): ChatSession {
  const existing = sessions.get(sessionId)
  if (existing) return existing
  const now = Date.now()
  const fresh: ChatSession = {
    id: sessionId,
    createdAt: now,
    updatedAt: now,
    turns: []
  }
  sessions.set(sessionId, fresh)
  persistAndNotify(sessionId)
  return fresh
}

export function listSessionSummaries(): ChatSessionSummary[] {
  return Array.from(sessions.values())
    .map<ChatSessionSummary>((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      turnCount: s.turns.length,
      firstUserText: s.turns[0]?.user.text.slice(0, 120)
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * Records which live agent session (if any) this tab's next `session/load`
 * should try to resume. Called once a turn's `AcpSession` actually has a
 * `sessionId` — whether that came from `session/new` or from a successful
 * `session/load` itself, so the value here always tracks the *current*
 * agent-side session, not the first one this tab ever opened.
 */
export function setAgentSession(sessionId: string, provider: string, agentSessionId: string): void {
  const s = sessions.get(sessionId)
  if (!s) return
  if (s.agentProvider === provider && s.agentSessionId === agentSessionId) return
  s.agentProvider = provider
  s.agentSessionId = agentSessionId
  persistAndNotify(sessionId)
}

export function appendTurn(sessionId: string, turn: ChatTurn): void {
  const s = sessions.get(sessionId)
  if (!s) return
  s.turns.push(turn)
  s.updatedAt = Date.now()
  persistAndNotify(sessionId)
}

export function updateTurn(sessionId: string, turnId: string, patch: Partial<ChatTurn>): void {
  const s = sessions.get(sessionId)
  if (!s) return
  const idx = s.turns.findIndex((t) => t.id === turnId)
  if (idx === -1) return
  s.turns[idx] = { ...s.turns[idx]!, ...patch }
  s.updatedAt = Date.now()
  persistAndNotify(sessionId)
}

function concatTextParts(parts: ChatPart[]): string {
  return parts
    .filter((p): p is ChatTextPart => p.type === 'text')
    .map((p) => p.text)
    .join('')
}

function ensureAssistant(turn: ChatTurn): ChatMessage {
  if (!turn.assistant) {
    turn.assistant = {
      id: `${turn.id}-a`,
      role: 'assistant',
      text: '',
      ts: Date.now(),
      parts: []
    }
  }
  if (!turn.assistant.parts) turn.assistant.parts = []
  return turn.assistant
}

export function appendAssistantDelta(sessionId: string, turnId: string, deltaText: string): void {
  const s = sessions.get(sessionId)
  if (!s) return
  const turn = s.turns.find((t) => t.id === turnId)
  if (!turn) return
  const a = ensureAssistant(turn)
  const parts = a.parts!
  const last = parts[parts.length - 1]
  if (last && last.type === 'text') last.text += deltaText
  else parts.push({ type: 'text', text: deltaText })
  a.text = concatTextParts(parts)
  if (turn.status === 'pending') turn.status = 'streaming'
  s.updatedAt = Date.now()
  persistAndNotify(sessionId)
}

export function appendToolUse(
  sessionId: string,
  turnId: string,
  tool: { id: string; name: string; input: unknown }
): void {
  const s = sessions.get(sessionId)
  if (!s) return
  const turn = s.turns.find((t) => t.id === turnId)
  if (!turn) return
  const a = ensureAssistant(turn)
  a.parts!.push({
    type: 'tool',
    id: tool.id,
    name: tool.name,
    input: tool.input,
    status: 'running'
  })
  if (turn.status === 'pending') turn.status = 'streaming'
  s.updatedAt = Date.now()
  persistAndNotify(sessionId)
}

export function setToolResult(
  sessionId: string,
  turnId: string,
  r: { toolUseId: string; isError: boolean; preview?: string }
): void {
  const s = sessions.get(sessionId)
  if (!s) return
  const turn = s.turns.find((t) => t.id === turnId)
  if (!turn?.assistant?.parts) return
  const parts = turn.assistant.parts
  let part = parts.find((p): p is ChatToolPart => p.type === 'tool' && p.id === r.toolUseId)
  if (!part) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]!
      if (p.type === 'tool' && p.status === 'running') {
        part = p
        break
      }
    }
  }
  if (!part) return
  part.result = r.preview
  part.status = r.isError ? 'error' : 'done'
  s.updatedAt = Date.now()
  persistAndNotify(sessionId)
}

export async function deleteSession(sessionId: string): Promise<void> {
  if (!vaultRoot) return
  sessions.delete(sessionId)
  const timer = persistTimers.get(sessionId)
  if (timer) {
    clearTimeout(timer)
    persistTimers.delete(sessionId)
  }
  try {
    await fs.rm(chatSessionFile(vaultRoot, sessionId), { force: true })
  } catch {}
  updateListener?.(sessionId)
}

function persistAndNotify(sessionId: string): void {
  updateListener?.(sessionId)
  const existing = persistTimers.get(sessionId)
  if (existing) clearTimeout(existing)
  persistTimers.set(
    sessionId,
    setTimeout(() => {
      persistTimers.delete(sessionId)
      void persistSession(sessionId)
    }, PERSIST_DEBOUNCE_MS)
  )
}

async function persistSession(sessionId: string): Promise<void> {
  if (!vaultRoot) return
  const s = sessions.get(sessionId)
  if (!s) return
  try {
    await writeJson(chatSessionFile(vaultRoot, sessionId), s)
  } catch {}
}
