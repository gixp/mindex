import { Overlays } from '@/platform/registry/overlays'
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties
} from 'react'
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelHandle
} from 'react-resizable-panels'
import { useVaultStore } from '@/platform/workspace'
import { useUiStore } from '@/platform/app-settings'
import { useTabsStore } from '@/features/terminal/store-tabs'
import { useTerminalTabsStore } from '@/features/terminal/store-terminalTabs'
import { useEditorStore } from '@/features/editor/store'
import { folderViewPath } from '@/platform/documents'
import { useNavigationStore } from '@/features/layout/store'
import { useJobsStore } from '@/features/engine/store'
import { useFolderStatusStore } from '@/features/folder-context/store'
import { useContextStore } from '@/features/context/store'
import { useNoteTypesStore } from '@/platform/note-types'
import { useProvidersStore } from '@/platform/engines'
import { useGitStatusStore } from '@/features/git/store'
import { useChatStore } from '@/features/chat/store-chat'
import { api } from '@/platform/api'
import { cn } from '@/ui/cn'
import { GlobalHeader } from '@/features/layout/components/GlobalHeader'
import { SidebarFooter } from '@/features/layout/components/SidebarFooter'
import { TreePane } from '@/features/tree/components/TreePane'
import { EditorPanel } from '@/features/editor/components/EditorPanel'
import { AgentTabsPanel } from '@/features/terminal/components/AgentTabsPanel'
import { TerminalTabsPanel } from '@/features/terminal/components/TerminalTabsPanel'
import { WelcomeView } from '@/features/welcome/components/WelcomeView'
import { installMenuCommandListener } from './menu-commands'
import { installCodeCopy } from './codeCopy'
import { installTableActions } from '@/ui/tableActions'
import { installScrollbarAutoHide } from './scrollbarAutoHide'
import { installThemeSync } from '@/platform/theme'
import { useElementSize } from '@/ui/element-size'

/**
 * The four heavy panel bodies, and the overlay host, behind a memo.
 *
 * None of them take props — they read what they need from their own stores —
 * so the comparison always says "equal" and they never re-render because this
 * component did. Without that, they did so constantly: dragging a separator
 * makes the layout library report a new layout on every frame, the resize
 * observers below report new element sizes on every frame, and each of those
 * is a state update on this component. Every one of them rebuilt the tree,
 * the editor, the agent panel and the terminal from scratch, which is what
 * made a drag feel like it was fighting back.
 *
 * The header is deliberately not in here. It is small, and it does need the
 * live sidebar width on every frame to keep the breadcrumb aligned.
 */
const OverlaysMemo = memo(Overlays)
const TreePaneMemo = memo(TreePane)
const SidebarFooterMemo = memo(SidebarFooter)
const EditorPanelMemo = memo(EditorPanel)
const AgentTabsPanelMemo = memo(AgentTabsPanel)
const TerminalTabsPanelMemo = memo(TerminalTabsPanel)
const WelcomeViewMemo = memo(WelcomeView)

const CENTER_BLOCK = 'h-full overflow-hidden'

/** Total width of a panel separator: a 3px rule with 2px of clearance on
 *  each side. The separator element is the whole gap between two panels —
 *  neither panel adds a margin of its own against it — so anything that
 *  needs to line up with the centre column's left edge has to add this to
 *  the left sidebar's width. See `.sash` in globals.css. */
const SASH_PX = 7

/** How far a panel card holds off the window's own edge — the `mb-2`/`mr-2`
 *  below. A separator stops the same distance short at its far end, so its
 *  end lines up with the bottom (or right) edge of the card beside it rather
 *  than carrying on past it into the window's margin. */
const PANEL_EDGE_PX = 8
export const DEFAULT_PANEL_SIZES = { left: 18, center: 44, right: 38 }
const CENTER_MIN_SIZE = 40
// Panel sizes are percentages of the panel group's width, but a sidebar
// minimum is more meaningful as an absolute width — 220px stays 220px
// whether the window is 1000px or 2000px wide, unlike a fixed percentage.
const LEFT_MIN_PX = 220
// The floor this panel may be dragged to. It holds a conversation with code
// blocks and tool output in it, so it is not a comfortable width — it is the
// point below which the panel stops being usable at all.
//
// It read as far too narrow for a long time and the number was raised twice
// for it, to no effect — the measurement it depends on was never taken (see
// `useElementSize`), so the pixel floor was not in play at all and a hardcoded
// 20% was. Every value here before this one was chosen against that, blind.
//
// The percentage it becomes is capped at half the workspace, so on a narrow
// window it asks for what there is rather than squeezing the note out of view.
const RIGHT_MIN_PX = 300
// Floor for the docked terminal panel's height, and its default share of the
// workspace's vertical space when first opened.
const TERMINAL_MIN_PX = 160
const TERMINAL_DEFAULT_SIZE = 30

export type PanelSizes = { left: number; center: number; right: number }

// Exported for App.test.ts: the panel collapse/expand rework earlier this
// session left this as the one piece of that logic that's actually pure
// (everything else syncs store state onto react-resizable-panels' imperative
// refs, which needs a real mount to observe) — and it's exactly the kind of
// thing that regresses silently, since a wrong result only ever shows up as
// "the sidebar came back a strange width after upgrading", not a crash.
export function normalizePanelSizes(sizes: PanelSizes | undefined): PanelSizes {
  const source = sizes ?? DEFAULT_PANEL_SIZES
  const left = Number.isFinite(source.left) ? source.left : DEFAULT_PANEL_SIZES.left
  const center = Number.isFinite(source.center) ? source.center : DEFAULT_PANEL_SIZES.center
  const right = Number.isFinite(source.right) ? source.right : DEFAULT_PANEL_SIZES.right
  const total = left + center + right

  // Older builds mixed coordinate systems: `left` was a percentage of the
  // window while `center` and `right` were percentages of the remaining
  // region. Convert that persisted shape before restoring it into the single
  // three-panel group below.
  if (Math.abs(total - 100) > 1 && center + right > 0) {
    const boundedLeft = Math.min(40, Math.max(10, left))
    const remaining = 100 - boundedLeft
    return {
      left: boundedLeft,
      center: remaining * (center / (center + right)),
      right: remaining * (right / (center + right))
    }
  }

  if (total <= 0) return DEFAULT_PANEL_SIZES
  return {
    left: (left / total) * 100,
    center: (center / total) * 100,
    right: (right / total) * 100
  }
}

// The grip and the blue rule shared by both handles below. Everything
// visual about them lives in `.sash*` in globals.css, keyed off the
// `data-resize-handle-state` attribute the panel library sets — see the
// comment there for why that attribute rather than CSS :hover.
function SashBody(): JSX.Element {
  return (
    <>
      <span className="sash-dots" aria-hidden>
        <span className="sash-dot" />
        <span className="sash-dot" />
        <span className="sash-dot" />
      </span>
      <span className="sash-bar" aria-hidden />
    </>
  )
}

function VertHandle({
  hidden = false,
  endInsetPx = 0,
  onDragging,
  onResizeEnd
}: {
  hidden?: boolean
  /** How far short of the bottom to stop — see PANEL_EDGE_PX. */
  endInsetPx?: number
  onDragging?: (isDragging: boolean) => void
  onResizeEnd?: () => void
} = {}): JSX.Element {
  return (
    <PanelResizeHandle
      onDragging={onDragging}
      onKeyUp={onResizeEnd}
      // The pointer counts as on the separator from several px away, so a
      // SASH_PX-wide target never has to be hit exactly.
      hitAreaMargins={{ coarse: 10, fine: 6 }}
      className={`sash sash-v ${hidden ? 'hidden' : ''}`}
      style={{ '--sash-end': `${endInsetPx}px` } as CSSProperties}
    >
      <SashBody />
    </PanelResizeHandle>
  )
}

// Same as VertHandle but for a vertical (row) split, between the
// centre/right area and the docked terminal panel below it.
function HorizHandle({
  hidden = false,
  endInsetPx = 0,
  onDragging,
  onResizeEnd
}: {
  hidden?: boolean
  /** How far short of the right edge to stop — see PANEL_EDGE_PX. */
  endInsetPx?: number
  onDragging?: (isDragging: boolean) => void
  onResizeEnd?: () => void
} = {}): JSX.Element {
  return (
    <PanelResizeHandle
      onDragging={onDragging}
      onKeyUp={onResizeEnd}
      hitAreaMargins={{ coarse: 10, fine: 6 }}
      className={`sash sash-h ${hidden ? 'hidden' : ''}`}
      style={{ '--sash-end': `${endInsetPx}px` } as CSSProperties}
    >
      <SashBody />
    </PanelResizeHandle>
  )
}

function RightSidebarBody(): JSX.Element {
  return <AgentTabsPanelMemo />
}

export default function App(): JSX.Element {
  const vault = useVaultStore((s) => s.vault)
  const leftPanelHidden = useUiStore((s) => s.leftPanelHidden)
  const rightPanelHidden = useUiStore((s) => s.rightPanelHidden)
  const bottomPanelOpen = useUiStore((s) => s.bottomPanelOpen)
  const panelSizes = useUiStore((s) => s.settings?.panelSizes)

  const leftRef = useRef<ImperativePanelHandle>(null)
  const rightRef = useRef<ImperativePanelHandle>(null)
  const terminalRef = useRef<ImperativePanelHandle>(null)
  // All three are measured through a ref callback rather than an effect: this
  // tree does not mount until the saved layout arrives from disk, and an
  // effect with an empty dependency list runs once, before that, finds
  // nothing, and never runs again. See `useElementSize`.
  const [groupWrapperRef, groupSize] = useElementSize()
  const groupWidthPx = groupSize.width
  // Centre and right nest inside a "workspace" panel (paired vertically with
  // the docked terminal below it), so RIGHT_MIN_PX needs the workspace's own
  // width, not the full window's — this measures it.
  const [innerGroupWrapperRef, innerGroupSize] = useElementSize()
  const innerGroupWidthPx = innerGroupSize.width
  // The workspace's own height, for converting TERMINAL_MIN_PX into a
  // percentage of the vertical split it shares with the terminal panel.
  const [workspaceWrapperRef, workspaceSize] = useElementSize()
  const workspaceHeightPx = workspaceSize.height

  useEffect(() => {
    void useVaultStore.getState().init()
    const off = installMenuCommandListener()
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey
      const tag = (e.target as HTMLElement | null)?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA'
      if (typing) return
      if (mod && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'v') {
        e.preventDefault()
        const chat = useTabsStore.getState().tabs.find((t) => t.mode === 'chat')
        if (chat) useTabsStore.getState().setActive(chat.id)
      }
    }
    window.addEventListener('keydown', onKey)
    const offTitles = api().on.claudeSessionTitle(({ sessionId, title }) => {
      useTabsStore.getState().setTitle(sessionId, title)
    })
    const offFileChange = api().on.fileChange((e) => {
      if (e.kind === 'change') useEditorStore.getState().onExternalChange(e.path)
    })
    let offEngine = (): void => undefined
    let offFolderStatus = (): void => undefined
    let offContext = (): void => undefined
    let offTypes = (): void => undefined
    let offGitStatus = (): void => undefined
    void useJobsStore
      .getState()
      .init()
      .then((u) => {
        offEngine = u
      })
    void useFolderStatusStore
      .getState()
      .init()
      .then((u) => {
        offFolderStatus = u
      })
    void useContextStore
      .getState()
      .init()
      .then((u) => {
        offContext = u
      })
    // Initialised here rather than in the Types pane: the pane unmounts every
    // time the sidebar switches back to Explorer, and its cleanup would tear
    // down the subscription for good — the store only ever initialises once.
    void useNoteTypesStore
      .getState()
      .init()
      .then((u) => {
        offTypes = u
      })
    void useGitStatusStore
      .getState()
      .init()
      .then((u) => {
        offGitStatus = u
      })
    const offChat = useChatStore.getState().init()
    const offProviders = useProvidersStore.getState().init()
    const offCodeCopy = installCodeCopy()
    const offTableActions = installTableActions()
    const offScrollbarAutoHide = installScrollbarAutoHide()
    const offThemeSync = installThemeSync()
    return () => {
      off()
      window.removeEventListener('keydown', onKey)
      offTitles()
      offFileChange()
      offEngine()
      offFolderStatus()
      offContext()
      offTypes()
      offGitStatus()
      offChat()
      offProviders()
      offCodeCopy()
      offTableActions()
      offScrollbarAutoHide()
      offThemeSync()
    }
  }, [])

  useEffect(() => {
    useEditorStore.getState().close()
    useNavigationStore.getState().clear()
    useTabsStore.getState().reset()
    useTerminalTabsStore.getState().reset()
    // Chat/CLI doesn't need a vault — it only reads the app-level
    // provider/model/defaultView settings, not anything vault-scoped — so it
    // bootstraps unconditionally. Its own `watchProject()` call already
    // no-ops with no vault open (see main/ipc/handlers.ts), so this doesn't
    // race the `unwatchProject()` call below.
    void useTabsStore.getState().bootstrap()
    void useTerminalTabsStore.getState().bootstrap()

    if (!vault) {
      useEditorStore.getState().setRecentPaths([])
      void api().claude.unwatchProject()
      return
    }

    void (async () => {
      await useEditorStore.getState().bootstrap()
      if (useEditorStore.getState().openPaths.length === 0) {
        void useEditorStore.getState().open(folderViewPath(''))
      }
    })()
    void (async () => {
      const r = await api().settings.getVault()
      if (!r.ok || !r.data) return
      const stored = r.data.recentFiles ?? []
      const inMemory = useEditorStore.getState().recentPaths
      const seen = new Set<string>()
      const merged: string[] = []
      for (const p of [...inMemory, ...stored]) {
        if (!seen.has(p)) {
          seen.add(p)
          merged.push(p)
        }
      }
      useEditorStore.getState().setRecentPaths(merged)
    })()
  }, [vault?.root])

  const restoredPanelSizes = normalizePanelSizes(panelSizes)
  const leftDefault = restoredPanelSizes.left
  const centerDefault = restoredPanelSizes.center
  const rightDefault = restoredPanelSizes.right

  // The left panel's own live width, as a percentage of the outer group —
  // GlobalHeader's PathBreadcrumb uses this (converted to px below) to
  // start exactly where the centre column starts. Set inside the same
  // onLayout callback that moves the panel itself, not measured off its
  // rendered width after the fact: that would only update once the browser
  // has already painted the new size, one frame behind the drag — a
  // visible lag the breadcrumb doesn't otherwise have. Sourcing it from the
  // same event in the same render keeps it exactly in step, every frame.
  const [leftFracPercent, setLeftFracPercent] = useState(leftDefault)
  const leftPanelWidthPx = groupWidthPx > 0 ? (leftFracPercent / 100) * groupWidthPx : 0

  // Panel sizes are percentages of the group's width, so a fixed-pixel
  // minimum has to be converted freshly whenever the window is resized.
  // Falls back to a reasonable percentage before the group's width has
  // been measured at least once.
  const leftMinSize = groupWidthPx > 0 ? Math.min(40, (LEFT_MIN_PX / groupWidthPx) * 100) : 10

  // "Workspace" is the centre+right combined panel in the OUTER group —
  // these two floors are expressed as a percentage of the full window
  // (matching leftMinSize's coordinate system) purely so the workspace
  // panel itself can't be squeezed smaller than centre and right need
  // combined. The nested group below has its own, independently-scaled
  // versions of the same floors for the two panels inside it.
  const centerMinSizeOfFull = Math.min(80, CENTER_MIN_SIZE)
  const rightMinSizeOfFull =
    groupWidthPx > 0 ? Math.min(50, (RIGHT_MIN_PX / groupWidthPx) * 100) : 20
  const workspaceMinSize = centerMinSizeOfFull + rightMinSizeOfFull
  const workspaceDefault = centerDefault + rightDefault

  // The sidebar opposite the active handle must remain fixed. This dynamic
  // limit stops react-resizable-panels from cascading through the workspace
  // once it reaches its minimum size. The workspace panel itself gets no
  // maxSize (like the old centre panel didn't) so it can freely grow to
  // fill the space left frees up when it collapses to 0.
  const leftMaxSize = Math.min(40, Math.max(leftMinSize, 100 - workspaceMinSize))

  // Centre and right live in their own nested PanelGroup inside the
  // workspace panel, so their sizes/floors are percentages of the
  // workspace's own width (innerGroupWidthPx), not the full window.
  const centerMinSize = Math.min(80, CENTER_MIN_SIZE)
  const rightMinSize =
    innerGroupWidthPx > 0 ? Math.min(50, (RIGHT_MIN_PX / innerGroupWidthPx) * 100) : 20
  const rightMaxSize = Math.max(rightMinSize, 100 - centerMinSize)
  const innerCenterDefault = workspaceDefault > 0 ? (centerDefault / workspaceDefault) * 100 : 60
  const innerRightDefault = workspaceDefault > 0 ? (rightDefault / workspaceDefault) * 100 : 40

  // The docked terminal panel and the centre+right area share a vertical
  // split inside the workspace panel — terminalMinSize is a percentage of
  // the workspace's own height (workspaceHeightPx), same conversion
  // approach as the horizontal floors above.
  const terminalMinSize =
    workspaceHeightPx > 0 ? Math.min(60, (TERMINAL_MIN_PX / workspaceHeightPx) * 100) : 20
  // Floor for the centre+right area's own share of the vertical split —
  // no maxSize on that side (mirrors the workspace/left pattern above) so
  // it can grow to fill whatever the terminal frees up when collapsed.
  const workspaceTopMinSize = 30

  // Left and workspace are one flat PanelGroup; centre and right are a
  // second PanelGroup nested inside the workspace panel (itself paired
  // vertically with the docked terminal). Keep the last non-collapsed
  // layout in memory while panels move, but only persist after an explicit
  // pointer or keyboard resize. PanelGroup also fires onLayout for startup
  // restoration, HMR and programmatic expand/collapse; saving those
  // callbacks is what used to overwrite the user's real layout. The two
  // horizontal groups report their own fractions independently (outer:
  // left/workspace, inner: centre/right-of-workspace), so they're combined
  // into the flat {left, center, right} shape everything else
  // (persistence, normalizePanelSizes) expects. The vertical terminal split
  // isn't part of that persisted shape at all.
  const sizesRef = useRef<PanelSizes>(normalizePanelSizes(undefined))
  const outerFracRef = useRef({ left: leftDefault, workspace: workspaceDefault })
  const innerFracRef = useRef({ center: innerCenterDefault, right: innerRightDefault })
  const activeDragRef = useRef(false)

  const recomputeSizes = useCallback((): void => {
    const { left, workspace } = outerFracRef.current
    const { center, right } = innerFracRef.current
    sizesRef.current = {
      left,
      center: (workspace * center) / 100,
      right: (workspace * right) / 100
    }
  }, [])

  const writePanelSizes = useCallback((): void => {
    if (!useUiStore.getState().settings) return
    // Dragging a handle past the collapse threshold is the one way a panel can
    // be hidden or shown that no setter records, because only the library
    // knows it happened. The end of a real resize is where that gets saved.
    useUiStore.getState().persistPanelVisibility()
    const { left, center, right } = sizesRef.current
    if (left <= 0 || center <= 0 || right <= 0) return
    void useUiStore.getState().setPanelSizes({
      left: Math.round(left * 100) / 100,
      center: Math.round(center * 100) / 100,
      right: Math.round(right * 100) / 100
    })
  }, [])

  const handlePanelDragging = useCallback(
    (isDragging: boolean): void => {
      if (isDragging) {
        activeDragRef.current = true
        return
      }
      if (!activeDragRef.current) return
      activeDragRef.current = false
      writePanelSizes()
    },
    [writePanelSizes]
  )

  /**
   * Take a collapse/expand FROM the layout library without saving it.
   *
   * `react-resizable-panels` fires `onExpand` for any collapsible panel that
   * mounts expanded — and one always does, because `defaultSize` is the width
   * to restore to. So on every launch each panel announced "I am open" before
   * the sync effects below could collapse it, and that announcement was
   * written straight into the config: the app saved its own initialisation
   * over the user's stored layout, and everything came back open.
   *
   * The rule is the same one the sizes already follow (see the note above
   * `sizesRef`): the library's callbacks update the store, but only an
   * explicit user action writes to disk. Every deliberate route — the header
   * toggles, the terminal's close button, opening the chat panel — goes
   * through a setter that persists on its own. The one case left is dragging a
   * handle far enough to collapse a panel, which nothing else records, so
   * `writePanelSizes` saves the flags alongside the widths at the end of a
   * real resize.
   */
  const reportPanelState = useCallback(
    (patch: {
      leftPanelHidden?: boolean
      rightPanelHidden?: boolean
      bottomPanelOpen?: boolean
    }): void => {
      useUiStore.getState().syncPanelVisibility(patch)
    },
    []
  )

  // react-resizable-panels' expand(minSizeOverride) does NOT expand to that
  // argument — it restores whatever size the panel was at right before it
  // collapsed, only falling back to the argument as a floor when there's no
  // such remembered size or it was smaller than that floor. Passing
  // leftDefault/rightDefault here was wrong: that's the *persisted* width,
  // which can itself be small, so the "floor" did nothing and reopening
  // could restore to a sliver. The enforced pixel minimum is the correct
  // floor — it still restores to whatever wider size you last had it at.
  useLayoutEffect(() => {
    const r = leftRef.current
    if (!r) return
    if (leftPanelHidden && !r.isCollapsed()) r.collapse()
    else if (!leftPanelHidden && r.isCollapsed()) r.expand(leftMinSize)
  }, [leftPanelHidden, leftMinSize])

  useLayoutEffect(() => {
    const r = rightRef.current
    if (!r) return
    if (rightPanelHidden && !r.isCollapsed()) r.collapse()
    else if (!rightPanelHidden && r.isCollapsed()) r.expand(rightMinSize)
  }, [rightPanelHidden, rightMinSize])

  // Same collapse/expand sync as left/right, but for the docked terminal
  // panel — bottomPanelOpen already existed for the old floating drawer.
  useLayoutEffect(() => {
    const r = terminalRef.current
    if (!r) return
    if (!bottomPanelOpen && !r.isCollapsed()) r.collapse()
    else if (bottomPanelOpen && r.isCollapsed()) r.expand(terminalMinSize)
  }, [bottomPanelOpen, terminalMinSize])

  function renderShell(centerNode: JSX.Element): JSX.Element {
    return (
      <div className="flex h-screen flex-col bg-bg-1 text-foreground">
        {/* Everything that draws over the workspace. Each feature declares
            its own; see platform/registry/overlays and app/overlays. */}
        <OverlaysMemo />

        <GlobalHeader leftOffsetPx={leftPanelWidthPx + SASH_PX} />

        <div ref={groupWrapperRef} className="flex flex-1 min-h-0">
          <div className="min-w-0 flex-1">
            {panelSizes ? (
              <PanelGroup
                direction="horizontal"
                onLayout={([left, workspace]) => {
                  if (left === undefined || workspace === undefined) return
                  outerFracRef.current = { left, workspace }
                  setLeftFracPercent(left)
                  recomputeSizes()
                }}
              >
                <Panel
                  ref={leftRef}
                  id="left"
                  order={1}
                  defaultSize={leftDefault}
                  minSize={leftMinSize}
                  maxSize={leftMaxSize}
                  collapsible
                  collapsedSize={0}
                  onCollapse={() => reportPanelState({ leftPanelHidden: true })}
                  onExpand={() => reportPanelState({ leftPanelHidden: false })}
                >
                  <div className="h-full overflow-hidden flex flex-col">
                    <div className="flex-1 min-h-0">
                      <TreePaneMemo />
                    </div>
                    <SidebarFooterMemo />
                  </div>
                </Panel>
                <VertHandle
                  hidden={leftPanelHidden}
                  // Runs the full height of the window, and whichever card
                  // is bottom-most beside it — the centre column, or the
                  // terminal when that is open — holds off the bottom edge.
                  endInsetPx={PANEL_EDGE_PX}
                  onDragging={handlePanelDragging}
                  onResizeEnd={writePanelSizes}
                />
                <Panel
                  id="workspace"
                  order={2}
                  defaultSize={workspaceDefault}
                  minSize={workspaceMinSize}
                >
                  {/* Centre+right and the docked terminal share this panel
                      as a vertical split — terminal only shifts this panel's
                      own content, never the left sidebar beside it. */}
                  <div ref={workspaceWrapperRef} className="h-full">
                    <PanelGroup direction="vertical">
                      <Panel id="workspace-top" order={1} minSize={workspaceTopMinSize}>
                        <div ref={innerGroupWrapperRef} className="h-full">
                          <PanelGroup
                            direction="horizontal"
                            onLayout={([center, right]) => {
                              if (center === undefined || right === undefined) return
                              innerFracRef.current = { center, right }
                              recomputeSizes()
                            }}
                          >
                            <Panel
                              id="center"
                              order={1}
                              defaultSize={innerCenterDefault}
                              minSize={centerMinSize}
                            >
                              <div className="flex h-full">
                                <div
                                  className={cn(
                                    'min-w-0 flex-1 overflow-hidden rounded-r1 bg-bg-2 flex flex-col',
                                    // Margins only against the window's own
                                    // edges. Where a separator sits instead,
                                    // the separator is the whole gap.
                                    !bottomPanelOpen && 'mb-2',
                                    rightPanelHidden && 'mr-2',
                                    leftPanelHidden && 'ml-2'
                                  )}
                                >
                                  <div className="flex-1 min-h-0">
                                    <div className={`${CENTER_BLOCK} flex h-full w-full flex-col`}>
                                      <div className="flex-1 min-h-0">{centerNode}</div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </Panel>
                            <VertHandle
                              hidden={rightPanelHidden}
                              // Sits above the terminal, so when that is
                              // open the cards either side already run flush
                              // to this separator's own bottom.
                              endInsetPx={bottomPanelOpen ? 0 : PANEL_EDGE_PX}
                              onDragging={handlePanelDragging}
                              onResizeEnd={writePanelSizes}
                            />
                            <Panel
                              ref={rightRef}
                              id="right"
                              order={2}
                              // Opens closed when it was closed.
                              //
                              // `defaultSize` is read once, at mount, and this
                              // group does not mount until the settings arrive
                              // from disk — so by the time it exists, the
                              // effect above that collapses a hidden panel has
                              // already run against a ref that was still null,
                              // and will not run again because nothing it
                              // depends on changed. Without this the sidebar
                              // opened itself on every launch and stayed open.
                              defaultSize={rightPanelHidden ? 0 : innerRightDefault}
                              minSize={rightMinSize}
                              maxSize={rightMaxSize}
                              collapsible
                              collapsedSize={0}
                              onCollapse={() => reportPanelState({ rightPanelHidden: true })}
                              onExpand={() => reportPanelState({ rightPanelHidden: false })}
                            >
                              {/* Same reasoning as the centre column: h-full
                                  lives on this outer div (no margin here, so
                                  no overflow risk), and the actual margin
                                  sits on the inner flex item instead, sized
                                  by stretch rather than an explicit height. */}
                              <div className="flex h-full">
                                <div
                                  className={cn(
                                    'mr-2 min-w-0 flex-1 overflow-hidden rounded-r1 bg-bg-2 flex flex-col',
                                    !bottomPanelOpen && 'mb-2'
                                  )}
                                >
                                  <div className="flex-1 min-h-0">
                                    <RightSidebarBody />
                                  </div>
                                </div>
                              </div>
                            </Panel>
                          </PanelGroup>
                        </div>
                      </Panel>
                      <HorizHandle
                        hidden={!bottomPanelOpen}
                        endInsetPx={PANEL_EDGE_PX}
                        onResizeEnd={writePanelSizes}
                      />
                      <Panel
                        ref={terminalRef}
                        id="terminal"
                        order={2}
                        // Same as the right sidebar above: mounted after the
                        // settings load, so its own state has to be in the
                        // size it mounts at rather than applied afterwards.
                        defaultSize={bottomPanelOpen ? TERMINAL_DEFAULT_SIZE : 0}
                        minSize={terminalMinSize}
                        collapsible
                        collapsedSize={0}
                        onCollapse={() => reportPanelState({ bottomPanelOpen: false })}
                        onExpand={() => reportPanelState({ bottomPanelOpen: true })}
                      >
                        <div className="flex h-full">
                          <div className="mb-2 mr-2 min-w-0 flex-1 overflow-hidden rounded-r1 bg-card flex flex-col">
                            <TerminalTabsPanelMemo />
                          </div>
                        </div>
                      </Panel>
                    </PanelGroup>
                  </div>
                </Panel>
              </PanelGroup>
            ) : null}
          </div>
        </div>
      </div>
    )
  }

  return renderShell(vault ? <EditorPanelMemo /> : <WelcomeViewMemo />)
}
