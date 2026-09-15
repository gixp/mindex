import { create } from 'zustand'
import type { ProviderId, ProviderInfo, NodeRuntimeStatus } from '@shared/types'
import { api } from '@/platform/api'

/**
 * Which CLIs are installed and signed in — asked once, shared by everyone.
 *
 * Detection is three `--version` probes plus three credential lookups. That is
 * cheap but not free, and it was being run by the startup sequence, then again
 * every time Settings opened, then once more per chat tab. The answer only
 * changes when the user installs something or signs in, which is exactly when
 * they would press Re-check — so the only refreshes are the one at launch and
 * the ones they ask for.
 */
interface ProvidersState {
  items: ProviderInfo[]
  /** True while a probe is in flight, so the button can say so. */
  checking: boolean
  /** False until the first probe has completed — the UI shows "Checking…". */
  loaded: boolean
  /** Fetch once. Safe to call from anywhere; later callers get the cache. */
  load(): Promise<void>
  /** Probe again, on explicit request. */
  refresh(): Promise<void>
  /** Which provider is mid-`npm install -g`, if any. */
  installing: ProviderId | null
  /**
   * 0–100, shown as the card's fill.
   *
   * `npm install -g` gives no byte-level signal to report — main only learns
   * success or failure at exit — so this is a decelerating estimate that
   * eases toward 92% and never claims to be finished until the install
   * actually has. Real, not smooth-for-its-own-sake: an indeterminate sweep
   * was tried first and asked to be replaced with an actual fill.
   */
  installProgress: number
  /** Set when the last install attempt failed — cleared on the next try. */
  installError: string | null
  /** Runs the CLI's own install command, then folds the fresh probe in. */
  install(id: ProviderId): Promise<void>
  /** Set when the last sign-in attempt failed to even open a terminal —
   *  cleared on the next try. */
  signInError: string | null
  /** Opens the OS's own terminal with the provider's login command. */
  signIn(id: ProviderId): Promise<void>
  /**
   * Progress of Mindex's own private Node.js runtime setup (see
   * main/providers/node-runtime.ts), which an install silently runs first
   * if it isn't ready yet. Null once that step is done (or was never
   * needed) — the UI falls back to the plain `installProgress` estimate.
   */
  nodeRuntimeStatus: NodeRuntimeStatus | null
  /** Subscribes to the node-runtime status broadcast. Call once at startup. */
  init(): () => void
}

let inflight: Promise<void> | null = null

async function probe(set: (p: Partial<ProvidersState>) => void): Promise<void> {
  set({ checking: true })
  const r = await api().providers.detect()
  set({
    items: r.ok && r.data ? r.data : [],
    checking: false,
    loaded: true
  })
}

export const useProvidersStore = create<ProvidersState>((set, get) => ({
  items: [],
  checking: false,
  loaded: false,
  installing: null,
  installProgress: 0,
  installError: null,
  signInError: null,
  nodeRuntimeStatus: null,

  init() {
    return api().on.nodeRuntimeStatus((status) => set({ nodeRuntimeStatus: status }))
  },

  async load() {
    if (get().loaded) return
    // Collapse concurrent first-callers onto one probe rather than racing three.
    if (!inflight) {
      inflight = probe(set).finally(() => {
        inflight = null
      })
    }
    await inflight
  },

  async refresh() {
    if (!inflight) {
      inflight = probe(set).finally(() => {
        inflight = null
      })
    }
    await inflight
  },

  async install(id) {
    set({ installing: id, installError: null, installProgress: 0, nodeRuntimeStatus: null })
    // Ease toward 92% so the bar is always visibly moving without ever
    // claiming a completion it hasn't seen; the last stretch to 100% only
    // happens once npm actually exits, below.
    const timer = setInterval(() => {
      set((s) => ({ installProgress: s.installProgress + (92 - s.installProgress) * 0.06 }))
    }, 200)
    const r = await api().providers.install(id)
    clearInterval(timer)
    if (r.ok && r.data) {
      set({ installProgress: 100 })
      // Let the bar visibly reach the end before the card flips back to the
      // ready tile — snapping straight from 92% to gone reads as a glitch.
      await new Promise((resolve) => setTimeout(resolve, 220))
      set({ items: r.data, installing: null, installProgress: 0 })
    } else {
      set({ installing: null, installProgress: 0, installError: r.ok ? 'Install failed' : r.error })
    }
  },

  async signIn(id) {
    set({ signInError: null })
    const r = await api().providers.openLoginTerminal(id)
    if (!r.ok) set({ signInError: r.error ?? 'Could not open a terminal' })
  }
}))

/** The usable ones, in display order — what a model menu should offer. */
export function usableProviders(items: ProviderInfo[]): ProviderInfo[] {
  return items.filter((p) => p.status.installed && p.status.authenticated)
}

/**
 * Whether Mindex has at least one assistant it can actually use right now.
 *
 * The single question every "connect a provider" surface in the app asks:
 * the empty right panel, the floating chat button, the AI settings cards, the
 * right-sidebar view picker, the Auto Context dialog and its per-folder
 * triggers in the tree. One shared answer rather than five separate copies of
 * the same check, so none of them can ever disagree with the others about
 * whether a real assistant is behind them.
 *
 * Optimistic before the first probe answers (`loaded` false): assumed ready,
 * so a working setup never flashes an empty state for the moment before the
 * check that would prove it has finished.
 */
export function useHasProvider(): boolean {
  const loaded = useProvidersStore((s) => s.loaded)
  const items = useProvidersStore((s) => s.items)
  if (!loaded) return true
  return usableProviders(items).length > 0
}
