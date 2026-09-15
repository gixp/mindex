import { describe, expect, it } from 'vitest'
import { applySessionConfig } from './config'
import type { SessionConfigOption } from './protocol'
import type { AcpSession } from './session'
import type { AgentJobOptions } from '@main/agent-engine/engine'

/**
 * The shapes are Claude's real ones — a mode and a model advertised as a list.
 * See `surface.test.ts` for the captured traffic these come from.
 */
const claudeOptions: SessionConfigOption[] = [
  {
    id: 'mode',
    type: 'select',
    category: 'mode',
    currentValue: 'default',
    options: [
      { value: 'default', name: 'Manual' },
      { value: 'acceptEdits', name: 'Accept Edits' },
      { value: 'auto', name: 'Auto' }
    ]
  },
  {
    id: 'model',
    type: 'select',
    category: 'model',
    currentValue: 'sonnet',
    options: [
      { value: 'sonnet', name: 'Sonnet' },
      { value: 'opus', name: 'Opus' },
      { value: 'fable', name: 'Fable' }
    ]
  }
]

/** Only the two members `applySessionConfig` touches. */
function fakeSession(options: SessionConfigOption[] = claudeOptions): {
  session: AcpSession
  applied: Array<[string, string | boolean]>
} {
  const applied: Array<[string, string | boolean]> = []
  const session = {
    configOptions: options,
    async setConfigOption(id: string, value: string | boolean): Promise<boolean> {
      applied.push([id, value])
      return true
    }
  } as unknown as AcpSession
  return { session, applied }
}

describe('applySessionConfig', () => {
  it('sends the model the tab chose, not the one remembered from an earlier pick', async () => {
    // The bug this exists for: the composer shows the tab's model, so a chip
    // reading "Opus" sat above a conversation every turn of which was being
    // set to something else. The remembered entry is only refreshed when a
    // pick lands on a live session of the same assistant — which a new tab has
    // not got — so it goes stale by construction.
    const { session, applied } = fakeSession()
    const opts = { model: 'opus' } as AgentJobOptions

    await applySessionConfig(session, opts, { model: 'fable' })

    expect(applied).toEqual([['model', 'opus']])
  })

  it('still applies a remembered model when the tab named none', async () => {
    const { session, applied } = fakeSession()

    await applySessionConfig(session, {} as AgentJobOptions, { model: 'fable' })

    expect(applied).toEqual([['model', 'fable']])
  })

  it('lets the agent’s own menu keep every other axis', async () => {
    // Mode, thought level and the persona are chosen in the agent's menu and
    // are recorded nowhere else, so the remembered value is the only record of
    // them and must still win over the tab's vocabulary.
    const { session, applied } = fakeSession()
    const opts = { model: 'opus', permissionMode: 'acceptEdits' } as AgentJobOptions

    await applySessionConfig(session, opts, { mode: 'auto' })

    expect(applied).toEqual([
      ['model', 'opus'],
      ['mode', 'auto']
    ])
  })

  it('applies the model before anything else', async () => {
    // Choosing one rewrites which options exist and what they offer.
    const { session, applied } = fakeSession()
    const opts = { model: 'opus', permissionMode: 'acceptEdits' } as AgentJobOptions

    await applySessionConfig(session, opts, {})

    expect(applied.map(([id]) => id)).toEqual(['model', 'mode'])
  })

  it('skips a model the agent does not offer rather than failing the turn', async () => {
    const { session, applied } = fakeSession()

    await applySessionConfig(session, { model: 'gpt-5.6-sol' } as AgentJobOptions, {})

    expect(applied).toEqual([])
  })
})
