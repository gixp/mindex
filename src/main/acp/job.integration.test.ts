import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AcpSession } from './session'
import { flattenValues } from './protocol'
import { buildSurface } from './surface'
import { isUnpromptedMode } from '@shared/acp'
import type { StreamEvent } from '@main/providers/stream-parser'

/**
 * Talks to a real ACP adapter over the network and the user's own credentials.
 *
 * Opt-in for the obvious reasons — it downloads a package on a cold npm cache,
 * spends tokens on the signed-in account, and fails on a machine with no
 * `claude login`. Nothing in CI should depend on any of that.
 *
 *   RUN_ACP_INTEGRATION=1 npx vitest run src/main/acp/job.integration.test.ts
 *
 * What it is actually for: the claims in `docs/acp-phase0-findings.md` were
 * measured once, by hand, against adapter versions current that day. This is
 * how they get re-checked when an adapter moves.
 */

const enabled = process.env.RUN_ACP_INTEGRATION === '1'

describe.skipIf(!enabled)('AcpSession against the real Claude adapter', () => {
  it('reuses the existing claude login and answers a prompt', { timeout: 180_000 }, async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'mindex-acp-'))
    writeFileSync(join(cwd, 'probe.txt'), 'hello from mindex acp\n')

    const session = await AcpSession.open({ provider: 'claude', cwd })
    try {
      // The finding this whole migration rested on: with `claude login`
      // already done, the adapter asks for no sign-in method at all.
      expect(session.authMethods).toEqual([])
      expect(session.sessionId).toBeTruthy()

      // Claude advertises its settings; the axes are keyed by category
      // because the ids differ between vendors.
      const categories = session.configOptions.map((o) => o.category)
      expect(categories).toContain('model')
      expect(categories).toContain('thought_level')
      expect(categories).toContain('mode')

      const events: StreamEvent[] = []
      const turn = await session.prompt(
        [
          {
            type: 'text',
            text: 'Read probe.txt in the current directory and reply with its exact contents. Nothing else.'
          }
        ],
        (e) => events.push(e)
      )

      expect(turn.stopReason).toBe('end_turn')
      // Token cost comes from the prompt response, not the usage_update
      // notifications — those measure context-window fill.
      expect(turn.usage?.outputTokens).toBeGreaterThan(0)

      const text = events
        .filter(
          (e): e is Extract<StreamEvent, { kind: 'assistant_text' }> => e.kind === 'assistant_text'
        )
        .map((e) => e.text)
        .join('')
      expect(text).toContain('hello from mindex acp')

      // Every tool call that opened must have closed, or the transcript
      // renders a card that spins forever.
      const uses = events.filter((e) => e.kind === 'tool_use').length
      const results = events.filter((e) => e.kind === 'tool_result').length
      expect(results).toBe(uses)
    } finally {
      session.close()
    }
  })

  it(
    'changes the model on a live session instead of restarting it',
    { timeout: 120_000 },
    async () => {
      // The behaviour the stdout path could not have: model is argv there, so
      // changing it meant killing the process and losing the warm start.
      const cwd = mkdtempSync(join(tmpdir(), 'mindex-acp-'))
      const session = await AcpSession.open({ provider: 'claude', cwd })
      try {
        const model = session.configOptions.find((o) => o.category === 'model')
        expect(model).toBeDefined()
        // Through `flattenValues`, because values may arrive grouped — reading
        // the flat shape only would find nothing on an agent that groups.
        const haiku = flattenValues(model?.options).find((v) => v.value === 'haiku')
        expect(haiku).toBeDefined()

        const ok = await session.setConfigOption(model!.id, 'haiku')
        expect(ok).toBe(true)
        expect(session.alive).toBe(true)

        const after = session.configOptions.find((o) => o.category === 'model')
        expect(after?.currentValue).toBe('haiku')
      } finally {
        session.close()
      }
    }
  )

  it('builds a menu out of what the agent really advertises', { timeout: 120_000 }, async () => {
    // The claim Phase 4 rests on: everything the composer draws comes from
    // the agent, and it offers more than Mindex used to hardcode.
    const cwd = mkdtempSync(join(tmpdir(), 'mindex-acp-'))
    const session = await AcpSession.open({ provider: 'claude', cwd })
    try {
      const surface = buildSurface(session.configOptions, session.modes)

      const mode = surface.find((o) => o.category === 'mode')
      const model = surface.find((o) => o.category === 'model')
      const effort = surface.find((o) => o.category === 'thought_level')
      expect(mode).toBeDefined()
      expect(model).toBeDefined()
      expect(effort).toBeDefined()

      // More than the four modes and five effort rungs Mindex drew by hand.
      expect(mode!.values.length).toBeGreaterThan(4)
      expect(effort!.values.length).toBeGreaterThan(5)

      // The mode surface must never be folded in twice.
      expect(surface.filter((o) => o.category === 'mode')).toHaveLength(1)

      // Every row is drawable: a label and something to pick.
      for (const option of surface) {
        expect(option.label.length).toBeGreaterThan(0)
        if (option.type === 'select') expect(option.values.length).toBeGreaterThan(0)
      }

      // The persona selector is NOT advertised, and this assertion is the
      // record of that.
      //
      // The menu has a row for it, found by name because it would arrive with
      // no axis at all. Adapter 0.77.0 does not send one: its option builder
      // takes modes, models, model infos and an effort seed, and produces
      // exactly the four axes above. Subagents exist in that adapter as turn
      // events — a task it reports having run — not as something to choose in
      // advance. Verified twice on 2026-09-15: by reading the built adapter,
      // and by this session, with global agent definitions present on the
      // machine and none of them offered.
      //
      // When this starts failing, the adapter has grown the option and the row
      // is finally worth wiring up.
      const persona = surface.find((o) => o.category === undefined && o.id === 'agent')
      expect(persona).toBeUndefined()

      // And the warning fires on the mode that removes all prompting.
      const bypass = mode!.values.find((v) => v.value === 'bypassPermissions')
      expect(bypass).toBeDefined()
      expect(isUnpromptedMode({ id: bypass!.value, label: bypass!.label })).toBe(true)
    } finally {
      session.close()
    }
  })

  it('carries the conversation across turns on one session', { timeout: 180_000 }, async () => {
    // What "persistent" has to mean. The stdout path got this by re-entering
    // the CLI's own transcript with `--resume` after killing the process;
    // here the session simply stays open.
    const cwd = mkdtempSync(join(tmpdir(), 'mindex-acp-'))
    const session = await AcpSession.open({ provider: 'claude', cwd })
    try {
      await session.prompt(
        [{ type: 'text', text: 'Remember the number 8317. Reply with just "ok".' }],
        () => {}
      )

      let text = ''
      await session.prompt(
        [
          {
            type: 'text',
            text: 'What number did I ask you to remember? Reply with only the digits.'
          }
        ],
        (e) => {
          if (e.kind === 'assistant_text') text += e.text
        }
      )
      expect(text).toContain('8317')
    } finally {
      session.close()
    }
  })

  it('interrupts a turn without ending the session', { timeout: 180_000 }, async () => {
    // The capability the stdout path had none of: cancelling there meant
    // SIGTERM, because there is no way to interrupt a streaming stdin process.
    const cwd = mkdtempSync(join(tmpdir(), 'mindex-acp-'))
    const session = await AcpSession.open({ provider: 'claude', cwd })
    try {
      const turn = session.prompt(
        [
          {
            type: 'text',
            text: 'Count slowly from 1 to 500, writing every number on its own line.'
          }
        ],
        () => {}
      )
      // Let it get going, then interrupt.
      await new Promise((r) => setTimeout(r, 2500))
      session.cancel()

      const result = await turn
      expect(result.stopReason).toBe('cancelled')
      // The session survived the interruption — this is the whole point.
      expect(session.alive).toBe(true)

      let text = ''
      const after = await session.prompt(
        [{ type: 'text', text: 'Reply with just the word: alive' }],
        (e) => {
          if (e.kind === 'assistant_text') text += e.text
        }
      )
      expect(after.stopReason).toBe('end_turn')
      expect(text.toLowerCase()).toContain('alive')
    } finally {
      session.close()
    }
  })
})
