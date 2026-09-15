import { create } from 'zustand'
import { useUiStore } from '@/platform/app-settings'
import { useProvidersStore } from '@/platform/engines'

/**
 * What the app does before it is ready to be used.
 *
 * These ran already — scattered across effects in App.tsx, each finishing
 * whenever it finished. Naming them and waiting on them together buys two
 * things: the window stops showing half-built chrome while settings are still
 * arriving, and a step that hangs is visible as itself instead of as a
 * generally slow launch.
 */
export type StepId = 'settings' | 'providers'

export interface Step {
  id: StepId
  label: string
  state: 'pending' | 'running' | 'done' | 'failed'
}

const STEPS: { id: StepId; label: string }[] = [
  { id: 'settings', label: 'Loading your settings' },
  { id: 'providers', label: 'Checking engines availability' }
]

interface StartupState {
  /**
   * Per-step outcome. Nothing renders it — the startup screen shows the build,
   * not a running commentary — but it is what says *which* step failed when a
   * launch comes up half-configured, so it is kept as the record.
   */
  steps: Step[]
  done: boolean
  run(): Promise<void>
}

export const useStartupStore = create<StartupState>((set, get) => ({
  steps: STEPS.map((s) => ({ ...s, state: 'pending' })),
  done: false,

  async run() {
    if (get().done) return

    // The steps touch nothing in common — one reads a JSON file, one spawns
    // six CLI probes — so running them in sequence made launch cost their sum
    // for no reason. Concurrent, it costs the slowest, which is the probing.
    //
    // No step is allowed to block the app. A machine with no CLI installed at
    // all must still open the window — the alternative is a product that
    // refuses to start when it is offline.
    const mark = (id: StepId, state: Step['state']): void => {
      set((s) => ({ steps: s.steps.map((x) => (x.id === id ? { ...x, state } : x)) }))
    }

    const step = async (id: StepId, work: () => Promise<unknown>): Promise<void> => {
      mark(id, 'running')
      try {
        await work()
        mark(id, 'done')
      } catch {
        mark(id, 'failed')
      }
    }

    await Promise.all([
      step('settings', () => useUiStore.getState().load()),
      step('providers', () => useProvidersStore.getState().load())
    ])

    set({ done: true })
  }
}))
