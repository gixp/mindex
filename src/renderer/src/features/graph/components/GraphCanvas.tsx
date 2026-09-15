import { useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d'
import type { GraphData, GraphNode } from '@shared/graph'
import { nodeRadius } from '@shared/graph'
import type { ProviderId } from '@shared/types'
import { cn } from '@/ui/cn'
import { cssVarColor } from '@/platform/theme'
import { useGraphViewStore } from '@/features/graph/store'
import { useHoverStore } from '@/features/tree/store-hover'
import { useResolvedTheme } from '@/platform/theme'
import type { FileDisplaySettings } from '@/platform/presentation/useFileDisplaySettings'
import { GEMINI_STAR, resolveNodeIcon, whenCodiconFontReady } from './graph-icons'
import { graphNodeLabel } from './graph-labels'

/**
 * The canvas itself. Owns nothing but drawing and hit-testing — what is in the
 * graph is decided upstream by `buildGraph`.
 *
 * `react-force-graph-2d` mutates the objects it is given — it writes `x`, `y`,
 * `vx`, `vy` onto every node as the simulation runs — so a node's identity is
 * where its position lives. `reconcile` below is what keeps that identity
 * across rebuilds.
 */

/**
 * Every node is outlined, not just the interesting ones: against a fill this
 * close to the background a circle with no edge reads as a smudge. Thin enough
 * that it defines the shape without becoming a feature of its own.
 */
const BORDER_WIDTH = 0.5

/** Below this zoom, labels are unreadable anyway and just fill the canvas. */
const LABEL_MIN_SCALE = 1.6

/**
 * How much of the text colour each line and edge is drawn with.
 *
 * The two grounds need different numbers for the same apparent weight, and
 * one set for both is why the light theme's graph came out as pale grey
 * scratches. A light line on near-black is loud at a tenth of its strength —
 * it is the only bright thing on the canvas. A dark line on a near-white page
 * at that strength is barely a smudge, because the page is bright everywhere
 * and the line has to win against all of it.
 *
 * So the light values are roughly two and a half times the dark ones. Not
 * solid black: a vault of a few hundred notes is mostly edges, and at full
 * strength the picture stops being a shape and becomes a mesh.
 */
const INK = {
  dark: { link: 0.12, linkActive: 0.45, contains: 0.06, dim: 0.06, dimIcon: 0.22, border: 0.22 },
  light: { link: 0.32, linkActive: 0.8, contains: 0.16, dim: 0.14, dimIcon: 0.45, border: 0.5 }
} as const

/**
 * How hard every node is pulled back toward the middle of the canvas.
 *
 * Without it a note with no links has nothing acting on it but the repulsion
 * of every other node, so it accelerates outward and stops only when the
 * simulation cools — which is why single notes and small detached clusters
 * ended up parked in the far corners, far outside the picture everything else
 * had settled into. The library's own "center" force does not help: it shifts
 * the whole system so its average sits in the middle, and an outlier is part
 * of that average rather than something it corrects.
 *
 * Gentle on purpose. It has to be weak enough that it never squeezes the
 * linked cluster — the springs and the repulsion still decide that shape —
 * and only strong enough to beat repulsion once a node is already far out,
 * which it does because this grows with distance while repulsion falls off
 * with its square. Deliberately not scaled by the spacing slider: spacing is
 * meant to make the graph bigger, not to let strays travel further.
 */
const GRAVITY = 0.08

interface Movable {
  x?: number
  y?: number
  vx?: number
  vy?: number
}

/**
 * A pull toward the origin, proportional to how far out a node already is —
 * d3's own `forceX`/`forceY` at the centre, written out rather than pulled in
 * as a dependency, since it is six lines and the graph uses nothing else from
 * that package.
 *
 * A d3 force is a function of `alpha` that adds to velocities, plus an
 * `initialize` the simulation calls with the current nodes. Velocity rather
 * than position so it composes with every other force instead of overruling
 * them, and nodes the user has dropped somewhere are unaffected: a pinned
 * node's coordinates are reasserted after the forces run.
 */
export function centerGravity(strength: number): ForceFn {
  let nodes: Movable[] = []
  const force = (alpha: number): void => {
    const k = strength * alpha
    for (const n of nodes) {
      n.vx = (n.vx ?? 0) - (n.x ?? 0) * k
      n.vy = (n.vy ?? 0) - (n.y ?? 0) * k
    }
  }
  force.initialize = (next: Movable[]): void => {
    nodes = next
  }
  return force as ForceFn
}

/** The shape `d3Force` takes: callable, with an `initialize` hook. */
type ForceFn = ((alpha: number) => void) & {
  initialize?: (nodes: Movable[], ...rest: unknown[]) => void
}

interface PositionedNode extends GraphNode {
  x?: number
  y?: number
  /** d3-force's fixed position, set when the user drops a node somewhere. */
  fx?: number
  fy?: number
}

/**
 * Carry positions across a rebuild.
 *
 * `buildGraph` returns fresh objects, and the note index gets a new array
 * identity on every file save — so without this, saving any note anywhere
 * would hand the simulation a graph it has never seen and the whole picture
 * would fly apart and resettle. Nodes that are still here keep their own
 * object (and with it `x`, `y`, `vx`, `vy`); their fields are updated in
 * place because that object is the one the layout is holding.
 *
 * Links are rebuilt every time on purpose: the library rewrites `source` and
 * `target` from ids into node references, so a reused link could still be
 * pointing at a node that has since been removed.
 */
function reconcile(next: GraphData, prev: readonly PositionedNode[]): GraphData {
  const byId = new Map(prev.map((n) => [n.id, n]))
  const nodes = next.nodes.map((n) => {
    const kept = byId.get(n.id)
    if (!kept) return { ...n }
    kept.title = n.title
    kept.type = n.type
    kept.kind = n.kind
    kept.degree = n.degree
    kept.childCount = n.childCount
    kept.orphan = n.orphan
    kept.managed = n.managed
    kept.name = n.name
    return kept
  })
  return { nodes, links: next.links.map((l) => ({ ...l })) }
}

export function GraphCanvas({
  data,
  hidden,
  rowDetails,
  iconOverrides,
  iconColorOverrides,
  engineProvider,
  onOpen
}: {
  data: GraphData
  /** What the tree considers hidden — drives the full-path label and dimming. */
  hidden: ReadonlySet<string>
  rowDetails: FileDisplaySettings
  iconOverrides: Record<string, string>
  iconColorOverrides: Record<string, string>
  engineProvider: ProviderId
  onOpen(node: GraphNode): void
}): JSX.Element {
  const spacing = useGraphViewStore((s) => s.spacing)
  // Hovering a row in the file tree lights up the same node here, and behaves
  // from then on exactly as if the pointer were over it — same neighbourhood
  // highlight, same label, same ring. The graph's own pointer wins when both
  // are live, since that is the one the user is actually looking at.
  const treeHover = useHoverStore((s) => s.path)
  const wrapRef = useRef<HTMLDivElement>(null)
  const fgRef = useRef<ForceGraphMethods | undefined>(undefined)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [pointerHover, setPointerHover] = useState<string | null>(null)
  const [fontReady, setFontReady] = useState(false)
  const [panning, setPanning] = useState(false)
  // A force layout's first half-second is a scatter of nodes flying apart
  // before it settles. Fading in over that hides the thrash and lets the
  // graph arrive rather than appear mid-explosion.
  const [revealed, setRevealed] = useState(false)
  // Whether the pointer is down but has not moved yet. A press that turns out
  // to be a click should never flash the grabbing cursor — only an actual drag
  // is a drag.
  const pressedRef = useRef(false)

  const liveRef = useRef<PositionedNode[]>([])
  const graphData = useMemo(() => {
    const merged = reconcile(data, liveRef.current)
    liveRef.current = merged.nodes as PositionedNode[]
    return merged
  }, [data])

  useEffect(() => {
    const t = setTimeout(() => setRevealed(true), 30)
    return () => clearTimeout(t)
  }, [])

  // The library measures nothing itself — it takes explicit pixels, so it is
  // not mounted at all until the wrapper has been measured. A flag rather
  // than the numbers: it flips false → true exactly once, where the width and
  // height change on every drag of the pane divider, and the forces below
  // must not be reset (and the layout reheated) every time someone resizes.
  const measured = size.width > 0 && size.height > 0

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setSize({ width: el.clientWidth, height: el.clientHeight })
    })
    ro.observe(el)
    setSize({ width: el.clientWidth, height: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  // `fillText` in a font the browser has not loaded yet draws tofu boxes, and
  // a canvas does not repaint itself when the font later arrives — by which
  // point the simulation may have settled and stopped drawing entirely. So the
  // icons are held back until the font is ready, and flipping this state is
  // what asks the library for the repaint that draws them.
  useEffect(() => {
    let cancelled = false
    void whenCodiconFontReady().then(() => {
      if (!cancelled) setFontReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Spacing is two forces, not one: how long the springs are, and how hard
  // nodes push each other away. Moving only the first leaves dense clusters
  // just as tight, because repulsion is what actually opens them up.
  //
  // Both are set as multiples of d3's own defaults (link 30, charge -30), so
  // `spacing: 1` is stock behaviour and the slider reads as "more or less than
  // normal" rather than as an arbitrary number.
  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    fg.d3Force('link')?.distance(30 * spacing)
    fg.d3Force('charge')?.strength(-30 * spacing)
    // Registered here rather than once at mount so it survives the library
    // rebuilding its forces, and so it is re-initialised with the current
    // node array whenever the graph changes.
    fg.d3Force('gravity', centerGravity(GRAVITY))
    // The simulation has usually gone to sleep by now; without a reheat the
    // new forces would only take effect the next time something else woke it.
    fg.d3ReheatSimulation()
    // `measured` is in here because of what it gates. The very first run of
    // this effect happens before the wrapper has a size, so the graph is not
    // mounted, the ref is empty and it returns above having done nothing —
    // and with only `spacing` and `graphData` to depend on it never ran
    // again. The vault's saved spacing was read, shown on the slider, and
    // then quietly not applied: the layout stayed at d3's stock numbers
    // until the slider was touched, which is what made it look like the
    // setting had not been saved.
  }, [spacing, graphData, measured])

  // The pointer can be released anywhere — over the settings card, outside the
  // window, on another monitor — so the end of a drag is listened for on the
  // window rather than on the canvas. Without this the cursor would stay stuck
  // as grabbing after a release that happened off the graph.
  useEffect(() => {
    const end = (): void => {
      pressedRef.current = false
      setPanning(false)
    }
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
  }, [])

  // Re-read whenever the resolved theme flips: canvas has no cascade to
  // inherit a CSS variable through, so this is the one palette in the app
  // that has to be recomputed in JS rather than repainting for free.
  const resolvedTheme = useResolvedTheme()
  const palette = useMemo(
    () => {
      const a = INK[resolvedTheme === 'light' ? 'light' : 'dark']
      return {
        // The same grey as a tab in the middle section, so a node reads as the
        // same kind of object the tab strip is made of.
        node: cssVarColor('--accent'),
        link: cssVarColor('--foreground', a.link),
        linkActive: cssVarColor('--foreground', a.linkActive),
        // Containment is scaffolding, not a link the user wrote — drawn fainter
        // so a folder's spokes never compete with a real wikilink.
        contains: cssVarColor('--foreground', a.contains),
        label: cssVarColor('--foreground', 0.75),
        dim: cssVarColor('--foreground', a.dim),
        dimIcon: cssVarColor('--foreground', a.dimIcon),
        border: cssVarColor('--foreground', a.border)
      }
    },
    // resolvedTheme is read above, for the ink strengths, and is also the
    // trigger for everything else here: cssVarColor reads the CSS variables'
    // *current* values straight off the DOM, which is only correct once the
    // new [data-theme] has actually applied.
    [resolvedTheme]
  )

  // A node shows an icon only when the equivalent tree row would. The tree
  // has three switches, not one — files, folders, and the generated context
  // files separately — so a graph with a single "icons" toggle could not have
  // matched it in the states that mix them.
  const icons = useMemo(() => {
    const map = new Map<string, ReturnType<typeof resolveNodeIcon>>()
    for (const node of graphData.nodes) {
      const allowed =
        node.kind === 'folder'
          ? rowDetails.showFolderIcons
          : node.managed
            ? rowDetails.showServiceFileIcons
            : rowDetails.showFileIcons
      if (!allowed) continue
      map.set(
        node.id, // Passed explicitly rather than left to the defaults: this memo has to
        // recompute when someone recolours a file, and a dependency the callback
        // does not mention is one the compiler cannot see.
        resolveNodeIcon(node, iconOverrides, iconColorOverrides, engineProvider)
      )
    }
    return map
  }, [graphData.nodes, rowDetails, iconOverrides, iconColorOverrides, engineProvider])

  // Character for character what the tree row says, including the full-path
  // form it uses for a revealed hidden file.
  const labels = useMemo(() => {
    const map = new Map<string, string>()
    for (const node of graphData.nodes) map.set(node.id, graphNodeLabel(node, hidden))
    return map
  }, [graphData.nodes, hidden])

  // Who is adjacent to whom, for the hover highlight. Rebuilt only when the
  // edges change — not on every hover, which would be once per mouse move.
  const adjacency = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const l of graphData.links) {
      const a = map.get(l.source) ?? new Set<string>()
      a.add(l.target)
      map.set(l.source, a)
      const b = map.get(l.target) ?? new Set<string>()
      b.add(l.source)
      map.set(l.target, b)
    }
    return map
  }, [graphData.links])

  const hovered = pointerHover ?? treeHover
  const isLit = (id: string): boolean => {
    if (hovered === null) return true
    return id === hovered || (adjacency.get(hovered)?.has(id) ?? false)
  }

  return (
    <div
      ref={wrapRef}
      className={cn(
        'mindex-graph-surface h-full w-full transition-opacity duration-500 ease-out',
        revealed ? 'opacity-100' : 'opacity-0',
        panning && 'is-panning'
      )}
      onPointerDown={() => {
        pressedRef.current = true
      }}
      onPointerMove={() => {
        if (pressedRef.current && !panning) setPanning(true)
      }}
    >
      {measured ? (
        <ForceGraph2D
          ref={fgRef}
          graphData={graphData}
          width={size.width}
          height={size.height}
          backgroundColor="transparent"
          // Ids are absolute paths; the library defaults to `id` but says so
          // explicitly here because the link objects carry raw strings.
          nodeId="id"
          linkColor={(link) => {
            const base = link.kind === 'contains' ? palette.contains : palette.link
            if (hovered === null) return base
            const s = endpointId(link.source)
            const t = endpointId(link.target)
            return s === hovered || t === hovered ? palette.linkActive : base
          }}
          linkWidth={(link) => {
            if (hovered === null) return 1
            const s = endpointId(link.source)
            const t = endpointId(link.target)
            return s === hovered || t === hovered ? 1.6 : 1
          }}
          enableNodeDrag
          // Dropping a node pins it. Without this the simulation reclaims it
          // the instant you let go, so "moving" a node is something you can do
          // but not something that lasts — which is worse than not being able
          // to do it at all. `fx`/`fy` are d3-force's own fixed-position
          // fields, and they survive a rebuild because `reconcile` reuses the
          // same node object.
          onNodeDragEnd={(node) => {
            const n = node as PositionedNode
            n.fx = n.x
            n.fy = n.y
          }}
          onNodeHover={(node) =>
            setPointerHover(node ? ((node as PositionedNode).id ?? null) : null)
          }
          // The whole node goes back, not just its id: a folder has no
          // document behind it and opens a different kind of tab, and only the
          // caller knows how to build that path.
          onNodeClick={(node) => onOpen(node as PositionedNode)}
          // Painting the label with the node keeps them in one pass, so a
          // label can never lag a frame behind the dot it belongs to.
          nodeCanvasObject={(node, ctx, globalScale) => {
            const n = node as PositionedNode
            if (n.x === undefined || n.y === undefined) return
            const lit = isLit(n.id)
            const r = nodeRadius(n)
            // The tree renders a revealed hidden row at reduced opacity; the
            // graph says the same thing the same way. save/restore rather than
            // resetting at the end: the label has several early returns, and
            // any one of them would otherwise leak the dimming onto every node
            // drawn after it.
            ctx.save()
            ctx.globalAlpha = hidden.has(n.id) ? 0.6 : 1

            // Fill and border share one path, and the stroke is centred on it
            // — half inside the fill, half outside. That is what leaves no gap:
            // stroking a larger circle would ring the node with background
            // showing through between the two.
            const border = n.id === hovered ? cssVarColor('--accent-1') : palette.border
            ctx.beginPath()
            ctx.arc(n.x, n.y, r, 0, 2 * Math.PI)
            ctx.fillStyle = lit ? palette.node : palette.dim
            ctx.fill()
            ctx.lineWidth = BORDER_WIDTH
            ctx.strokeStyle = border
            ctx.stroke()

            const icon = fontReady ? icons.get(n.id) : undefined
            if (icon) {
              // Sized to the node, so a hub's bigger circle gets a bigger
              // glyph and the two never look pasted together.
              const iconSize = r * 1.15
              ctx.fillStyle = lit ? icon.color : palette.dimIcon
              if (icon.geminiStar) {
                drawGeminiStar(ctx, n.x, n.y, iconSize)
              } else if (icon.glyph) {
                ctx.font = `${iconSize}px codicon`
                ctx.textAlign = 'center'
                ctx.textBaseline = 'middle'
                ctx.fillText(icon.glyph, n.x, n.y)
              }
            }

            if (!lit) {
              ctx.restore()
              return
            }
            // Everything still lit gets named, not just the node under the
            // pointer: the highlight already picks out its immediate
            // neighbours, and a ring of anonymous dots answers "what is this
            // connected to" with a count instead of an answer. Unlit nodes
            // have returned above, so while something is hovered this reaches
            // only that node and the ones one link away.
            const showLabel = globalScale >= LABEL_MIN_SCALE || hovered !== null
            if (!showLabel) {
              ctx.restore()
              return
            }
            const fontSize = Math.max(2.5, 11 / globalScale)
            ctx.font = `${fontSize}px ui-sans-serif, system-ui, sans-serif`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'top'
            ctx.fillStyle = palette.label
            ctx.fillText(labels.get(n.id) ?? n.name, n.x, n.y + r + fontSize * 0.35)
            ctx.restore()
          }}
          // Hit area is the dot only. Without this the library falls back to
          // the painted object's bounding box, which includes the label — so
          // clicking empty space under a note would open it.
          nodePointerAreaPaint={(node, color, ctx) => {
            const n = node as PositionedNode
            if (n.x === undefined || n.y === undefined) return
            ctx.beginPath()
            ctx.arc(n.x, n.y, nodeRadius(n) + 2, 0, 2 * Math.PI)
            ctx.fillStyle = color
            ctx.fill()
          }}
        />
      ) : null}
    </div>
  )
}

/**
 * Gemini's mark, drawn from its path because it is the one provider without a
 * codicon — `fillText` has nothing to print for it.
 *
 * The path is authored on a 24x24 grid, so it is scaled to the requested size
 * and moved so its centre lands on the node's centre.
 */
function drawGeminiStar(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const scale = size / 24
  ctx.save()
  ctx.translate(x - size / 2, y - size / 2)
  ctx.scale(scale, scale)
  ctx.fill(new Path2D(GEMINI_STAR))
  ctx.restore()
}

/**
 * A link endpoint is a raw id string before the simulation runs and the node
 * object itself afterwards — the library swaps them in place on first tick.
 */
function endpointId(end: unknown): string | null {
  if (typeof end === 'string') return end
  if (end && typeof end === 'object' && 'id' in end) {
    const id = (end as { id: unknown }).id
    return typeof id === 'string' ? id : null
  }
  return null
}
