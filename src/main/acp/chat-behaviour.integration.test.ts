import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AcpSession } from './session'
import { applySessionConfig, optionByCategory } from './config'
import { buildSurface } from './surface'
import type { AgentJobOptions } from '@main/agent-engine/engine'

/**
 * What a conversation actually does, against a real assistant.
 *
 * Opt-in, like the other live tests — it starts real processes, spends real
 * tokens and depends on this machine being signed in:
 *
 *   RUN_ACP_INTEGRATION=1 npx vitest run src/main/acp/chat-behaviour.integration.test.ts
 *
 * Everything here is a path a person takes on an ordinary afternoon and that
 * no unit test can reach: a model chosen from the menu, a mode changed
 * mid-conversation, an answer interrupted halfway and replaced. Each was
 * either written or rewritten recently, and each fails silently rather than
 * loudly when it breaks — a setting that does not apply looks exactly like an
 * assistant that ignored you.
 *
 * Sonnet throughout, because that is what a session is normally run on and a
 * test that proves a different model works proves the wrong thing.
 */

const enabled = process.env.RUN_ACP_INTEGRATION === '1'
const MODEL = 'sonnet'

function opts(over: Partial<AgentJobOptions> = {}): AgentJobOptions {
  return { provider: 'claude', model: MODEL, ...over } as AgentJobOptions
}

async function openSession(): Promise<AcpSession> {
  return AcpSession.open({
    provider: 'claude',
    cwd: mkdtempSync(join(tmpdir(), 'mindex-chat-')),
    // Gemini and Codex route tool calls through this even with no mode set,
    // and an unanswered request fails their own validation. Claude does not
    // need it for the prompts below, but a handler that is present and says
    // yes is what an ordinary conversation has.
    onRequest: async (method, params) => {
      if (method !== 'session/request_permission') return {}
      const p = params as { options?: { optionId: string; kind?: string }[] }
      const pick = p.options?.find((o) => o.kind?.includes('allow')) ?? p.options?.[0]
      return pick
        ? { outcome: { outcome: 'selected', optionId: pick.optionId } }
        : { outcome: { outcome: 'cancelled' } }
    }
  })
}

function textOf(events: { kind: string; [k: string]: unknown }[]): string {
  return events
    .filter((e) => e.kind === 'assistant_text')
    .map((e) => String((e as { text?: unknown }).text ?? ''))
    .join('')
}

describe.skipIf(!enabled)('a conversation on Sonnet', () => {
  it('answers a plain message', { timeout: 180_000 }, async () => {
    const session = await openSession()
    try {
      const { rejected } = await applySessionConfig(session, opts())
      expect(rejected).toEqual([])

      const events: { kind: string }[] = []
      const turn = await session.prompt(
        [{ type: 'text', text: 'Reply with the word READY.' }],
        (e) => events.push(e as { kind: string })
      )

      expect(turn.stopReason).toBe('end_turn')
      expect(textOf(events).toUpperCase()).toContain('READY')
    } finally {
      session.close()
    }
  })

  it(
    'takes the model, the thought level and the mode from the tab',
    { timeout: 180_000 },
    async () => {
      // The three rows the composer owns. A value that does not apply is the
      // failure this exists for: the menu says one thing and the turn runs on
      // another, with nothing anywhere saying so.
      const session = await openSession()
      try {
        const { rejected } = await applySessionConfig(
          session,
          opts({ effort: 'high', permissionMode: 'acceptEdits' })
        )
        expect(rejected).toEqual([])

        expect(optionByCategory(session.configOptions, 'model')?.currentValue).toContain('sonnet')
        expect(optionByCategory(session.configOptions, 'mode')?.currentValue).toBe('acceptEdits')
        expect(optionByCategory(session.configOptions, 'thought_level')?.currentValue).toBeTruthy()
      } finally {
        session.close()
      }
    }
  )

  it('changes the model mid-conversation without a restart', { timeout: 240_000 }, async () => {
    const session = await openSession()
    try {
      await applySessionConfig(session, opts())
      const before = session.sessionId
      await session.prompt([{ type: 'text', text: 'Say ONE.' }], () => {})

      const model = optionByCategory(session.configOptions, 'model')
      expect(model).toBeDefined()

      const { rejected } = await applySessionConfig(session, opts({ model: 'haiku' }))
      expect(rejected).toEqual([])
      // The same session answers the next message — no new session id, which
      // is what "without a restart" means.
      expect(session.sessionId).toBe(before)

      const events: { kind: string }[] = []
      const turn = await session.prompt([{ type: 'text', text: 'Say TWO.' }], (e) =>
        events.push(e as { kind: string })
      )
      expect(turn.stopReason).toBe('end_turn')
      expect(textOf(events).toUpperCase()).toContain('TWO')
    } finally {
      session.close()
    }
  })

  it(
    'advertises exactly the four axes the menus draw — and no persona',
    { timeout: 180_000 },
    async () => {
      // Captured from the adapter on 2026-09-15, because the menus are built
      // from this and there is no other record of what it really offers.
      //
      // The absence matters more than the presence: the composer has a row for
      // an assistant's persona ("Agents"), and Claude advertises none, so that
      // row never appears for Claude however it is drawn. If this assertion ever
      // fails, the adapter has started offering one and the row is finally worth
      // wiring up — that is the signal, not a regression.
      const session = await openSession()
      try {
        const surface = buildSurface(session.configOptions, session.modes)
        expect(surface.map((o) => o.category ?? '(none)').sort()).toEqual([
          'mode',
          'model',
          'model_config',
          'thought_level'
        ])

        const persona = surface.find(
          (o) => !o.category && /agent|persona/i.test(`${o.id} ${o.label}`)
        )
        expect(persona, 'no persona selector is advertised today').toBeUndefined()

        for (const option of surface) {
          expect(option.label.length).toBeGreaterThan(0)
          if (option.type === 'select') expect(option.values.length).toBeGreaterThan(0)
        }
      } finally {
        session.close()
      }
    }
  )

  it('takes fast mode, the one axis outside the three rows', { timeout: 180_000 }, async () => {
    const session = await openSession()
    try {
      const fast = session.configOptions.find((o) => o.category === 'model_config')
      expect(fast).toBeDefined()
      expect(await session.setConfigOption(fast!.id, 'on')).toBe(true)
      expect(session.configOptions.find((o) => o.id === fast!.id)?.currentValue).toBe('on')
    } finally {
      session.close()
    }
  })

  it(
    'interrupts an answer, and takes the next message on the same session',
    { timeout: 240_000 },
    async () => {
      // The whole point of the change this test arrived with. The old behaviour
      // queued the second message behind the first, which is backwards: people
      // type during an answer precisely because the answer is going the wrong
      // way.
      const session = await openSession()
      try {
        await applySessionConfig(session, opts())

        const events: { kind: string }[] = []
        const long = session.prompt(
          [
            {
              type: 'text',
              text: 'Count slowly from 1 to 200, one number per line, with a short sentence about each.'
            }
          ],
          (e) => events.push(e as { kind: string })
        )
        // Long enough that the agent is certainly mid-answer.
        await new Promise((r) => setTimeout(r, 4000))
        session.cancel()

        const stopped = await long
        expect(stopped.stopReason).toBe('cancelled')
        expect(session.alive, 'the session survives the interruption').toBe(true)
        expect(session.busy, 'and is free for the next message').toBe(false)

        const after: { kind: string }[] = []
        const next = await session.prompt(
          [{ type: 'text', text: 'Forget that. Reply with the word AFTER and nothing else.' }],
          (e) => after.push(e as { kind: string })
        )
        expect(next.stopReason).toBe('end_turn')
        expect(textOf(after).toUpperCase()).toContain('AFTER')
      } finally {
        session.close()
      }
    }
  )

  it(
    'reads a file handed over as a link block rather than as a path in the text',
    { timeout: 180_000 },
    async () => {
      const { writeFileSync, mkdtempSync: mkdtemp } = await import('node:fs')
      const dir = mkdtemp(join(tmpdir(), 'mindex-attach-'))
      const file = join(dir, 'secret.md')
      writeFileSync(file, '# Fixture\n\nThe passphrase is BANANA-47.\n')

      const session = await AcpSession.open({ provider: 'claude', cwd: dir })
      try {
        await applySessionConfig(session, opts())
        const { promptBlocks } = await import('./content-blocks')
        const events: { kind: string }[] = []
        const turn = await session.prompt(
          promptBlocks('What is the passphrase in the attached file? Answer with it alone.', [
            file
          ]),
          (e) => events.push(e as { kind: string })
        )
        expect(turn.stopReason).toBe('end_turn')
        expect(textOf(events).toUpperCase()).toContain('BANANA-47')
      } finally {
        session.close()
      }
    }
  )
})
