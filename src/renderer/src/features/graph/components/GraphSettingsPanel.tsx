import { SPACING_MAX, SPACING_MIN, useGraphViewStore } from '@/features/graph/store'

/**
 * The one thing left to adjust about the graph: how far apart it sits.
 *
 * Bottom-left, away from the top-right corner where a node's label is most
 * likely to be — and unframed, because it is one slider rather than a settings
 * surface. Only the control itself takes pointer events; the canvas underneath
 * stays live everywhere else, including the empty space around it.
 *
 * There is nothing else here on purpose. What the graph contains follows the
 * file tree, and labels appear once you are zoomed in far enough to read them,
 * which is the only rule that works on a ten-note and a thousand-note vault
 * alike.
 */
export function GraphSettingsPanel(): JSX.Element {
  const spacing = useGraphViewStore((s) => s.spacing)
  const setSpacing = useGraphViewStore((s) => s.setSpacing)

  return (
    <div className="pointer-events-none absolute bottom-1 left-3 z-pane">
      {/* No card at all — no background, border or shadow. The control sits
          directly on the canvas, so the graph reads as the whole surface
          rather than as something with a panel parked on it. */}
      <div className="pointer-events-auto w-[168px]">
        <div className="pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
          Spacing
        </div>
        <input
          type="range"
          min={SPACING_MIN}
          max={SPACING_MAX}
          step={0.1}
          value={spacing}
          onChange={(e) => setSpacing(Number(e.target.value))}
          aria-label="Spacing"
          className="mindex-range w-full"
        />
      </div>
    </div>
  )
}
