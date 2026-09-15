import { create } from 'zustand'

/**
 * What the pointer is over, shared between the file tree and the graph.
 *
 * The graph is the tree drawn differently, so hovering a row there should
 * light up the same thing here. Kept in its own store rather than in `ui`
 * because it changes on every mouse move across the sidebar: anything
 * subscribed to it re-renders at that rate, and that list should stay short
 * enough to name — the graph canvas, and nothing else.
 *
 * The value is always an **absolute** path, even for a folder, whose tree row
 * is keyed relatively. Normalising at the one place that sets it is what lets
 * the graph compare it straight against a node id.
 */
interface HoverState {
  path: string | null
  setHovered(path: string | null): void
}

export const useHoverStore = create<HoverState>((set) => ({
  path: null,
  setHovered(path) {
    // Guarded so a mouse moving within one row does not publish the same value
    // dozens of times and re-render the canvas for each.
    set((s) => (s.path === path ? s : { path }))
  }
}))
