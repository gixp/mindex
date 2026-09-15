// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import type { AcpConfigOption } from '@shared/acp'
import { installApiStub } from '@/test/apiStub'
import { useAgentOptionsStore } from './store-agentOptions'

/**
 * The menus after a change of assistant.
 *
 * The store holds on to a list when a new answer comes back empty, which is
 * right: empty means "not reached yet", and blanking a tab's menus
 * mid-conversation reads as the app breaking.
 *
 * It was wrong across a *switch*, because the guard was keyed on the tab alone.
 * The list in hand then belonged to the previous assistant, so keeping it left
 * the composer offering Claude's models on a tab that had moved to Gemini —
 * the visible half of the provider-switch bug.
 */

const TAB = 'tab-1'
const CLAUDE_OPTIONS = [
  { id: 'model', name: 'Model', kind: 'select', currentValue: 'opus', options: [] }
] as unknown as AcpConfigOption[]
const GEMINI_OPTIONS = [
  { id: 'model', name: 'Model', kind: 'select', currentValue: 'pro', options: [] }
] as unknown as AcpConfigOption[]

/** Answers `getAgentOptions` per provider, so one stub serves a whole switch. */
function stubOptions(byProvider: Record<string, AcpConfigOption[]>): void {
  installApiStub({
    chat: {
      getAgentOptions: async ({ provider }: { provider: string }) => ({
        ok: true as const,
        data: byProvider[provider] ?? []
      }),
      getAgentCommands: async () => ({ ok: true as const, data: [] })
    }
  })
}

/** A promise this test releases by hand, to fix the order two answers land in. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

beforeEach(() => {
  useAgentOptionsStore.setState({ byTab: {}, commandsByTab: {}, providerByTab: {} })
})

describe('agent options across a change of assistant', () => {
  it('replaces the list even when the new assistant answers with nothing', async () => {
    stubOptions({ claude: CLAUDE_OPTIONS, gemini: [] })

    await useAgentOptionsStore.getState().load(TAB, 'claude')
    expect(useAgentOptionsStore.getState().byTab[TAB]).toEqual(CLAUDE_OPTIONS)

    // Gemini has not been reached yet, so it answers empty. The old behaviour
    // kept Claude's models on screen; nothing there is choosable on Gemini.
    await useAgentOptionsStore.getState().load(TAB, 'gemini')
    expect(useAgentOptionsStore.getState().byTab[TAB]).toEqual([])
  })

  it('still refuses to blank a list when the same assistant answers empty', async () => {
    stubOptions({ claude: CLAUDE_OPTIONS })

    await useAgentOptionsStore.getState().load(TAB, 'claude')
    stubOptions({ claude: [] })
    await useAgentOptionsStore.getState().load(TAB, 'claude')

    // Empty here means "still starting" or "closed for sitting idle", not
    // "these choices are gone".
    expect(useAgentOptionsStore.getState().byTab[TAB]).toEqual(CLAUDE_OPTIONS)
  })

  it('takes the new assistant’s own list', async () => {
    stubOptions({ claude: CLAUDE_OPTIONS, gemini: GEMINI_OPTIONS })

    await useAgentOptionsStore.getState().load(TAB, 'claude')
    await useAgentOptionsStore.getState().load(TAB, 'gemini')
    expect(useAgentOptionsStore.getState().byTab[TAB]).toEqual(GEMINI_OPTIONS)
  })

  it('drops a late answer for the assistant already switched away from', async () => {
    // Claude's request is held open past Gemini's, so it lands last. Without a
    // guard the slower reply wins and the menus go back to the old assistant.
    const held = deferred()
    installApiStub({
      chat: {
        getAgentOptions: async ({ provider }: { provider: string }) => {
          if (provider === 'claude') {
            await held.promise
            return { ok: true as const, data: CLAUDE_OPTIONS }
          }
          return { ok: true as const, data: GEMINI_OPTIONS }
        },
        getAgentCommands: async () => ({ ok: true as const, data: [] })
      }
    })

    const slow = useAgentOptionsStore.getState().load(TAB, 'claude')
    await useAgentOptionsStore.getState().load(TAB, 'gemini')
    held.resolve()
    await slow

    expect(useAgentOptionsStore.getState().byTab[TAB]).toEqual(GEMINI_OPTIONS)
  })
})
