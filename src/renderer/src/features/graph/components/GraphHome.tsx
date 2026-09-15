import { lazy, Suspense, useMemo } from 'react'
import type { GraphNode } from '@shared/graph'
import { buildGraph } from '@shared/graph'
import { useVaultStore } from '@/platform/workspace'
import { useUiStore } from '@/platform/app-settings'
import { useHiddenFilesStore } from '@/features/tree/store-hiddenFiles'
import { folderViewPath, openDocument } from '@/platform/documents'
import { computeEffectiveHidden } from '@/platform/presentation/hiddenFiles'
import { useFileDisplaySettings } from '@/platform/presentation/useFileDisplaySettings'
import { EmptyState } from '@/ui/EmptyState'
import { GraphSettingsPanel } from './GraphSettingsPanel'

// Canvas rendering, a force simulation and d3 come to a few hundred kilobytes
// that most sessions never open. Split out so they are fetched the first time
// the graph tab is opened rather than on every cold start.
const GraphCanvas = lazy(() => import('./GraphCanvas').then((m) => ({ default: m.GraphCanvas })))

/**
 * The link graph over the whole vault.
 *
 * Built entirely in the renderer from `notes.list()` — no new IPC. Every note
 * already carries its `outgoingLinks`, and `@shared/wikilink` already knows
 * what a link points at, so asking main for a graph would mean a second answer
 * to a question that already has one.
 *
 * Scoped by `folderRel`: empty is the whole vault, otherwise just what lives
 * under that folder. The tab path carries the scope, so a folder's graph is a
 * place you can keep open, come back to, and reopen on the next launch.
 *
 * What is in it is not configurable, because it is not a separate view of the
 * vault — it is the file tree, drawn differently. The hidden set, the row
 * settings, the icon overrides and the reveal state are all read from the
 * tree's own state, so there is nothing here that can drift out of step with
 * what the sidebar is showing.
 */
export function GraphHome({ folderRel = '' }: { folderRel?: string }): JSX.Element {
  const notes = useVaultStore((s) => s.notes)
  const dirs = useVaultStore((s) => s.dirs)
  const vaultRoot = useVaultStore((s) => s.vault?.root ?? '')
  const iconOverrides = useUiStore((s) => s.iconOverrides)
  const iconColorOverrides = useUiStore((s) => s.iconColorOverrides)
  const userHidden = useHiddenFilesStore((s) => s.userHidden)
  const userUnhidden = useHiddenFilesStore((s) => s.userUnhidden)
  const revealedAll = useHiddenFilesStore((s) => s.revealedAll)
  const rowDetails = useFileDisplaySettings()
  const open = openDocument
  // A managed file's row carries the selected CLI's mark rather than a generic
  // icon — the same rule the tree applies, read from the same place.
  const engineProvider = useUiStore((s) => s.settings?.engine?.provider) ?? 'claude'

  // The tree's own answer to "what is hidden", not a second rule that happens
  // to agree today. Covers the default-hidden basenames and anything the user
  // hid or un-hid by hand.
  const hidden = useMemo(
    () => computeEffectiveHidden(notes, userHidden, userUnhidden),
    [notes, userHidden, userUnhidden]
  )

  // With the tree's Hidden section open, those notes are on screen — so they
  // are on the graph too, labelled by full path and dimmed, exactly as the
  // tree renders them. Closed, they are not drawn at all.
  const excluded = useMemo(() => (revealedAll ? new Set<string>() : hidden), [revealedAll, hidden])

  const data = useMemo(
    () => buildGraph(notes, { hidden: excluded, folders: dirs, vaultRoot, scope: folderRel }),
    [notes, excluded, dirs, vaultRoot, folderRel]
  )

  function openNode(node: GraphNode): void {
    if (node.kind === 'folder') {
      // A folder has no document behind it. Its folder view is the nearest
      // thing to "show me this", and it is what clicking a folder does
      // everywhere else in the app. `relPath` is already vault-relative — the
      // same key the folder view and the tree use.
      void open(folderViewPath(node.relPath))
      return
    }
    void open(node.id)
  }

  return (
    // `relative` is the anchor for the settings card, which floats over the
    // canvas rather than sitting in a bar above it — the graph keeps the full
    // height of the pane.
    <div className="relative h-full">
      {data.nodes.length === 0 ? (
        <EmptyState
          icon="type-hierarchy"
          title={folderRel ? 'Nothing in this folder yet' : 'Nothing in this vault yet'}
          hint="Notes appear here as soon as there are some."
        />
      ) : (
        <Suspense fallback={null}>
          <GraphCanvas
            data={data}
            hidden={hidden}
            rowDetails={rowDetails}
            iconOverrides={iconOverrides}
            iconColorOverrides={iconColorOverrides}
            engineProvider={engineProvider}
            onOpen={openNode}
          />
        </Suspense>
      )}

      <GraphSettingsPanel />
    </div>
  )
}
