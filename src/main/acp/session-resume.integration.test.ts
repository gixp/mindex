import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { endAllAcpChatSessions, runAcpChatTurn } from './chat-session'
import { ensureSession, getSession, startChatStore } from '@main/chat/store'
import type { AgentJobOptions } from '@main/agent-engine/engine'

/**
 * `session/load` end to end, through the real production path
 * (`runAcpChatTurn` → `chat-session.ts`'s `acquire` → `chat/store.ts`'s
 * `agentSessionId`/`agentProvider`), not the raw `AcpSession` probe that
 * first confirmed Claude's adapter supports this at all
 * (`docs/acp-session-load-findings.md`).
 *
 *   RUN_ACP_INTEGRATION=1 npx vitest run src/main/acp/session-resume.integration.test.ts
 */

const enabled = process.env.RUN_ACP_INTEGRATION === '1'

describe.skipIf(!enabled)('session/load through the real chat-session path', () => {
  let cwd: string

  beforeAll(async () => {
    cwd = mkdtempSync(join(tmpdir(), 'mindex-resume-'))
    writeFileSync(join(cwd, 'probe.txt'), 'the secret word is pineapple\n')
    await startChatStore({ vaultRoot: cwd })
  })

  afterEach(() => {
    endAllAcpChatSessions()
  })

  it(
    'a second tab-open, after the first adapter process is gone, genuinely remembers the earlier turn',
    { timeout: 180_000 },
    async () => {
      const sessionId = 'resume-test-tab'
      ensureSession(sessionId)

      const opts: AgentJobOptions = { provider: 'claude', cwd, prompt: '' }

      // First open: no agentSessionId recorded yet, so this is an ordinary
      // `session/new`.
      const first = await runAcpChatTurn(
        sessionId,
        opts,
        'turn-1',
        'Read probe.txt and remember the secret word. Reply with just "ok".',
        () => {}
      )
      expect(first?.ok).toBe(true)

      const recorded = getSession(sessionId)
      expect(recorded?.agentProvider).toBe('claude')
      expect(recorded?.agentSessionId).toBeTruthy()

      // The adapter process this ran on is gone now — a real restart would
      // lose it the same way; `endAllAcpChatSessions` in `afterEach` from a
      // *previous* run already covers the ordinary teardown path, so this
      // ends it explicitly mid-test to force the next turn to open a
      // completely new process.
      endAllAcpChatSessions()

      const events: { kind: string; text?: string }[] = []
      const second = await runAcpChatTurn(
        sessionId,
        opts,
        'turn-2',
        'What was the secret word I told you to remember? One word only.',
        (e) => events.push(e as { kind: string; text?: string })
      )
      expect(second?.ok).toBe(true)

      const reply = events
        .filter((e) => e.kind === 'assistant_text')
        .map((e) => e.text ?? '')
        .join('')
      expect(reply.toLowerCase()).toContain('pineapple')
    }
  )

  it.each(['codex', 'gemini'] as const)(
    '%s: a second tab-open never breaks, whether or not that adapter actually supports resuming',
    { timeout: 180_000 },
    async (provider) => {
      // Not asserting resume works here — only that requesting it is safe.
      // `AcpSession.open` falls back to a plain `session/new` for any adapter
      // that either does not advertise `agentCapabilities.loadSession` or
      // rejects the specific id, and this is what proves that fallback holds
      // for real adapters, not just the mocked-failure case.
      const sessionId = `resume-test-${provider}`
      ensureSession(sessionId)
      const opts: AgentJobOptions = { provider, cwd, prompt: '' }

      const first = await runAcpChatTurn(sessionId, opts, 't1', 'Reply with just "ok".', () => {})
      expect(first?.ok).toBe(true)
      endAllAcpChatSessions()

      const second = await runAcpChatTurn(
        sessionId,
        opts,
        't2',
        'Reply with just "ok" again.',
        () => {}
      )
      expect(second?.ok).toBe(true)
    }
  )
})
