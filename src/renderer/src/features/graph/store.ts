import { create } from 'zustand'
import { api } from '@/platform/api'
import { useVaultStore } from '@/platform/workspace'

/**
 * The graph view's settings, stored with the vault.
 *
 * Same shape and same posture as `treeSort`: a zustand store that writes
 * through to `VaultSettings` on every change, loaded once when the vault
 * opens. It lives in the config rather than in localStorage because how far
 * apart a graph wants to be spread is a property of the vault — a forty-note
 * vault and a two-thousand-note one want different answers, and carrying one
 * machine's preference across all of them is the wrong sharing.
 *
 * Deliberately small: nothing here decides *what* the graph contains — that
 * follows the file tree — and nothing decides how labels behave, which is
 * always "once you are zoomed in far enough to read them".
 */

interface GraphViewState {
  /** Multiple of d3's default forces (link 30, charge -30). 1 is stock. */
  spacing: number
  setSpacing(v: number): void
  /** Apply what the vault had stored; called when a vault opens. */
  hydrate(v: { spacing?: number } | undefined): void
  reset(): void
}

export const SPACING_MIN = 0.4
export const SPACING_MAX = 5
const DEFAULTS = { spacing: 1 }

function clampSpacing(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return DEFAULTS.spacing
  return Math.min(SPACING_MAX, Math.max(SPACING_MIN, v))
}

function persist(spacing: number): void {
  if (!useVaultStore.getState().vault?.root) return
  void api().settings.setVault({ graphView: { spacing } })
}

export const useGraphViewStore = create<GraphViewState>((set) => ({
  spacing: DEFAULTS.spacing,

  setSpacing(v) {
    const spacing = clampSpacing(v)
    set({ spacing })
    persist(spacing)
  },

  hydrate(v) {
    set({ spacing: clampSpacing(v?.spacing) })
  },

  reset() {
    set({ ...DEFAULTS })
  }
}))
