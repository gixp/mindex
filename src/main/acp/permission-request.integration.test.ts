import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  endAllAcpChatSessions,
  respondToPermission,
  runAcpChatTurn,
  setAcpPermissionListener
} from './chat-session'
import type { AgentJobOptions } from '@main/agent-engine/engine'
import type { ChatPermissionRequestPayload } from '@shared/chat'

/**
 * The full pipeline this app actually runs — `runAcpChatTurn`, not a raw
 * `AcpSession.prompt` call — against a real Claude adapter, standing in for
 * the renderer with `setAcpPermissionListener`/`respondToPermission` exactly
 * as `ipc/broadcast.ts`/`ipc/handlers/chat.ts` wire them.
 *
 *   RUN_ACP_INTEGRATION=1 npx vitest run src/main/acp/permission-request.integration.test.ts
 */

const enabled = process.env.RUN_ACP_INTEGRATION === '1'

describe.skipIf(!enabled)('live permission-request round trip', () => {
  let cwd: string
  let sessionId: string

  beforeAll(() => {
    cwd = mkdtempSync(join(tmpdir(), 'mindex-permreq-'))
  })

  afterEach(() => {
    endAllAcpChatSessions()
  })

  it(
    'a real edit under a mode that asks pauses the turn, and answering it resumes and finishes the edit',
    { timeout: 180_000 },
    async () => {
      sessionId = 'test-tab-1'
      writeFileSync(join(cwd, 'probe.txt'), 'hello from mindex\n')

      const requests: ChatPermissionRequestPayload[] = []
      const resolved: string[] = []
      setAcpPermissionListener(
        (payload) => {
          requests.push(payload)
          // Approve the first "allow" option the instant it arrives — the
          // point here is the pipeline, not exercising a person's UI clicks.
          const allow = payload.options.find((o) => (o.kind ?? '').startsWith('allow'))
          if (allow) respondToPermission(payload.requestId, allow.optionId)
        },
        (_sessionId, _turnId, requestId) => {
          resolved.push(requestId)
        }
      )

      const opts: AgentJobOptions = {
        provider: 'claude',
        cwd,
        prompt: '',
        // `default` is Claude's id for the mode that actually asks — see
        // `docs/acp-mcp-wiring-findings.md`. `acceptEdits`/`auto`/… would not
        // exercise this path at all.
        permissionMode: 'default'
      }

      const events: { kind: string }[] = []
      const result = await runAcpChatTurn(
        sessionId,
        opts,
        'edit-turn-1',
        'Edit probe.txt: change "hello" to "goodbye". Nothing else.',
        (e) => events.push(e)
      )

      expect(result?.ok).toBe(true)
      expect(requests.length).toBeGreaterThan(0)
      expect(requests[0]?.toolCallId).toBeTruthy()
      expect(requests[0]?.diff?.newText).toContain('goodbye')
      expect(resolved).toEqual(requests.map((r) => r.requestId))
      expect(readFileSync(join(cwd, 'probe.txt'), 'utf8')).toContain('goodbye')
    }
  )

  it(
    'declining the request leaves the file untouched and still finishes the turn',
    { timeout: 180_000 },
    async () => {
      sessionId = 'test-tab-2'
      writeFileSync(join(cwd, 'probe2.txt'), 'hello from mindex\n')

      setAcpPermissionListener(
        (payload) => {
          const reject = payload.options.find((o) => (o.kind ?? '').startsWith('reject'))
          respondToPermission(payload.requestId, reject?.optionId ?? null)
        },
        () => {}
      )

      const opts: AgentJobOptions = {
        provider: 'claude',
        cwd,
        prompt: '',
        permissionMode: 'default'
      }

      const result = await runAcpChatTurn(
        sessionId,
        opts,
        'edit-turn-2',
        'Edit probe2.txt: change "hello" to "goodbye". Nothing else.',
        () => {}
      )

      expect(result?.ok).toBe(true)
      expect(readFileSync(join(cwd, 'probe2.txt'), 'utf8')).not.toContain('goodbye')
    }
  )
})
