import { create } from 'zustand'
import { useEffect } from 'react'
import type { AcpCommand, AcpConfigOption } from '@shared/acp'
import type { ProviderId } from '@shared/types'
import { api } from '@/platform/api'
import { usableProviders, useProvidersStore } from '@/platform/engines'

/**
 * What each chat tab's assistant can be configured with.
 *
 * Filled from the list learned at launch, so a tab's menus are complete the
 * moment it opens. Once its own conversation is up, that answers instead —
 * only a live conversation knows which value is actually selected.
 *
 * Empty means the assistant has never been reached: not installed, not signed
 * in, or the direct connection is switched off. The composer falls back to the
 * built-in menus, which is exactly how it behaved before any of this existed.
 */

/**
 * A session id no tab can have, for asking about an assistant rather than a
 * conversation.
 *
 * The app process answers `getAgentOptions` from the live conversation when the
 * id names one and from the list learned at launch when it does not — so an id
 * that names nothing is how you ask for the learned list on its own. Tab ids
 * are UUIDs or a dash-joined timestamp, neither of which can contain a colon.
 */
const NO_SESSION = 'mindex:no-session'

interface AgentOptionsState {
  byTab: Record<string, AcpConfigOption[]>
  /**
   * What each assistant advertises, learned at launch and belonging to no
   * conversation.
   *
   * The menus list every assistant, not only the one being talked to, and the
   * names in them used to come from a tab — so the assistant that tab happened
   * to be on was named by itself ("Opus 5") and every other one by the list
   * compiled into Mindex ("Opus"). Switching a tab from one assistant to
   * another rewrote half the menu, which is not something a menu should do.
   */
  byProvider: Partial<Record<ProviderId, AcpConfigOption[]>>
  /** Slash commands the assistant reports — its own plus the user's skills. */
  commandsByTab: Record<string, AcpCommand[]>
  /** Remembered so a broadcast that names no tab can refresh every one of them. */
  providerByTab: Record<string, ProviderId>
  init(): () => void
  load(sessionId: string, provider: ProviderId): Promise<void>
  loadProvider(provider: ProviderId): Promise<void>
  choose(sessionId: string, optionId: string, value: string | boolean): Promise<void>
}

let installed: { off: () => void } | null = null
/** In flight, so a re-render cannot start a second ask for the same assistant. */
const askingProvider = new Set<ProviderId>()

export const useAgentOptionsStore = create<AgentOptionsState>((set, get) => ({
  byTab: {},
  byProvider: {},
  commandsByTab: {},
  providerByTab: {},

  init() {
    if (installed) return installed.off
    const off = api().on.chatAgentOptions(({ sessionId }) => {
      const { providerByTab } = get()
      // No tab named: the launch-time list changed, and every open tab may be
      // showing it.
      const ids = sessionId === null ? Object.keys(providerByTab) : [sessionId]
      for (const id of ids) {
        const provider = providerByTab[id]
        if (provider) void get().load(id, provider)
      }
      // The learned lists are what changed, so they are re-asked too.
      if (sessionId === null) {
        for (const provider of Object.keys(get().byProvider) as ProviderId[]) {
          askingProvider.delete(provider)
          void get().loadProvider(provider)
        }
      }
    })
    installed = { off }
    return off
  },

  async load(sessionId: string, provider: ProviderId) {
    // Which assistant this list is *for*. Read back when the answers land, so a
    // reply for the assistant the person has already switched away from is
    // dropped instead of overwriting the one they switched to. Two loads are in
    // flight across every switch and there is no guarantee they finish in order.
    const previous = get().providerByTab[sessionId]
    const switched = previous !== undefined && previous !== provider
    set((s) => ({ providerByTab: { ...s.providerByTab, [sessionId]: provider } }))

    // Asked for alongside the settings and held to the same rule: a list that
    // came back empty never replaces one already in hand.
    void api()
      .chat.getAgentCommands({ sessionId, provider })
      .then((r) => {
        if (!r.ok) return
        const commands = r.data ?? []
        set((s) => {
          if (s.providerByTab[sessionId] !== provider) return s
          if (!switched && commands.length === 0 && (s.commandsByTab[sessionId]?.length ?? 0) > 0) {
            return s
          }
          const next: Record<string, AcpCommand[]> = { ...s.commandsByTab }
          next[sessionId] = commands
          return { commandsByTab: next }
        })
      })

    const res = await api().chat.getAgentOptions({ sessionId, provider })
    if (!res.ok) return
    const options = res.data ?? []
    set((s) => {
      // Late answer for an assistant that is no longer the one on screen.
      if (s.providerByTab[sessionId] !== provider) return s

      // An empty answer never overwrites a list we already have. Empty means
      // several different things — never reached, still starting, closed for
      // sitting idle — and letting any of them blank the menus mid-conversation
      // reads as the app breaking.
      //
      // Except right after a switch, where the list in hand belongs to the
      // *previous* assistant. Keeping it there was the visible half of the
      // provider-switch bug: the menus went on offering Claude's models while
      // the tab had moved to Gemini. An empty list is the honest answer for an
      // assistant that has not been reached yet.
      if (!switched && options.length === 0 && (s.byTab[sessionId]?.length ?? 0) > 0) return s
      const byTab: Record<string, AcpConfigOption[]> = { ...s.byTab }
      byTab[sessionId] = options
      return { byTab }
    })
  },

  /**
   * Ask one assistant what it offers, with no conversation involved.
   *
   * Asked once per assistant per launch: the answer comes off disk in the app
   * process and only changes when that assistant is re-learned, which arrives
   * as a broadcast and clears the guard above. An empty answer is dropped
   * rather than stored, for the same reason a tab's is — empty means never
   * reached, and letting it through would blank the names it is here to
   * supply.
   */
  async loadProvider(provider: ProviderId) {
    if (askingProvider.has(provider)) return
    askingProvider.add(provider)
    const res = await api().chat.getAgentOptions({ sessionId: NO_SESSION, provider })
    if (!res.ok) {
      askingProvider.delete(provider)
      return
    }
    const options = res.data ?? []
    if (options.length === 0) return
    set((s) => ({ byProvider: { ...s.byProvider, [provider]: options } }))
  },

  async choose(sessionId: string, optionId: string, value: string | boolean) {
    // Shown as chosen straight away. The assistant replies with its own full
    // list moments later and that reply wins — including when it refuses, so a
    // rejected pick corrects itself rather than sticking as a lie.
    set((s) => {
      const current = s.byTab[sessionId]
      if (!current) return s
      const byTab: Record<string, AcpConfigOption[]> = { ...s.byTab }
      byTab[sessionId] = current.map((o) => (o.id === optionId ? { ...o, currentValue: value } : o))
      return { byTab }
    })
    const provider = get().providerByTab[sessionId]
    if (!provider) return
    await api().chat.setAgentOption({ sessionId, provider, optionId, value })
  }
}))

/**
 * What every installed, signed-in assistant advertises about itself.
 *
 * Keyed by assistant, so a menu listing all of them can name each one the way
 * that one names itself. The asking happens here rather than at startup
 * because this is where the answer is wanted, and it is cheap and idempotent —
 * see `loadProvider`.
 */
export function useAdvertisedOptions(): Partial<Record<ProviderId, AcpConfigOption[]>> {
  const items = useProvidersStore((s) => s.items)
  const byProvider = useAgentOptionsStore((s) => s.byProvider)
  const loadProvider = useAgentOptionsStore((s) => s.loadProvider)
  useEffect(() => {
    for (const p of usableProviders(items)) void loadProvider(p.id)
  }, [items, loadProvider])
  return byProvider
}

/** This tab's advertised settings. Empty when the assistant was never reached. */
export function useAgentOptions(sessionId: string): AcpConfigOption[] {
  return useAgentOptionsStore((s) => s.byTab[sessionId] ?? EMPTY)
}

/** This tab's slash commands. Empty falls back to the ones Mindex carries. */
export function useAgentCommands(sessionId: string): AcpCommand[] {
  return useAgentOptionsStore((s) => s.commandsByTab[sessionId] ?? EMPTY_COMMANDS)
}

// One shared empty array: a fresh `[]` from the selector would make every store
// update look like a change and re-render the composer constantly.
const EMPTY: AcpConfigOption[] = []
const EMPTY_COMMANDS: AcpCommand[] = []
