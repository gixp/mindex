import { useRef, useState, useEffect } from 'react'
import { ChromeButton } from '@/ui/chrome-button'
import { useAiProposalsStore } from '@/features/ai/store'
import { useUiStore } from '@/platform/app-settings'
import { useVaultStore } from '@/platform/workspace'
import { useGitStatusStore } from '@/features/git/store'
import { GRAPH_HOME_PATH, openDocument } from '@/platform/documents'
import { useJobsStore } from '@/features/engine/store'
import { HeaderNavButtons } from './HeaderNavButtons'
import { UpdateButton } from '@/features/update/components/UpdateButton'
import { HelpMenu } from './HelpMenu'
import { PathBreadcrumb } from './PathBreadcrumb'

/**
 * Global header, above everything — the left sidebar and the workspace
 * (centre + right) alike. Always the window's true top-left element, so its
 * traffic-light clearance and the sidebar toggle that lives here never shift
 * for any panel state. The clearance is written out in pixels because it is
 * measured from the window's own controls, which are a fixed size and do not
 * move with any scale on this side of the glass.
 *
 * The editor tab row itself now renders inline at the top of EditorPanel
 * (matching the right sidebar's own tab strip), not portaled in here any
 * more — but `PathBreadcrumb`, which sits where the tab row used to, still
 * needs to start exactly at the centre column's left edge, same as the tab
 * row did. `leftOffsetPx` (the left sidebar's own live width, from the
 * window's left edge) is used the same way it was for the old portaled tab
 * row: given to the toggle+arrows block as its own computed width, so the
 * block's own right edge — not a separate measured spacer — lands at that
 * point. See PathBreadcrumb and this project's color-schema-migration plan
 * for why this is a *computed* width rather than a `ResizeObserver`
 * measurement: the earlier version of this mechanism used one, and it kept
 * landing a few px off because it depended on the observer's callback (and
 * the state update it triggers) running before the next paint, which isn't
 * guaranteed.
 */
export function GlobalHeader({ leftOffsetPx = 0 }: { leftOffsetPx?: number }): JSX.Element {
  const headerRef = useRef<HTMLDivElement>(null)
  // Forces one re-render once the header is mounted (so the two reads below
  // stop reading `null`) and again on resize, since a zoom-level change can
  // move both of these without `leftOffsetPx` itself changing.
  const [, forceRecompute] = useState(0)
  useEffect(() => {
    const tick = (): void => forceRecompute((n) => n + 1)
    tick()
    window.addEventListener('resize', tick)
    return () => window.removeEventListener('resize', tick)
  }, [])
  const headerStyle = headerRef.current ? getComputedStyle(headerRef.current) : null
  const headerPaddingLeftPx = headerStyle ? parseFloat(headerStyle.paddingLeft) || 0 : 0
  const rowGapPx = headerStyle ? parseFloat(headerStyle.columnGap || '0') || 0 : 0
  const leftClusterWidthPx = Math.max(0, leftOffsetPx - headerPaddingLeftPx - rowGapPx)

  const toggleLeftPanel = useUiStore((s) => s.toggleLeftPanel)
  const leftPanelHidden = useUiStore((s) => s.leftPanelHidden)
  const rightPanelHidden = useUiStore((s) => s.rightPanelHidden)
  const setRightPanelHidden = useUiStore((s) => s.setRightPanelHidden)
  const openCapture = useAiProposalsStore((s) => s.openCapture)
  const contextOpen = useUiStore((s) => s.contextEngineOpen)
  const setContextOpen = useUiStore((s) => s.setContextEngineOpen)
  const linkHealthOpen = useUiStore((s) => s.linkHealthOpen)
  const setLinkHealthOpen = useUiStore((s) => s.setLinkHealthOpen)
  const sourceControlOpen = useUiStore((s) => s.sourceControlOpen)
  const setSourceControlOpen = useUiStore((s) => s.setSourceControlOpen)
  const bottomPanelOpen = useUiStore((s) => s.bottomPanelOpen)
  const toggleBottomPanel = useUiStore((s) => s.toggleBottomPanel)
  const openEngineLog = useUiStore((s) => s.setEngineLogOpen)
  const vault = useVaultStore((s) => s.vault)
  const gitSnapshot = useGitStatusStore((s) => s.snapshot)
  const openTab = openDocument
  const activeCount = useJobsStore((s) => s.activeCount)
  const pendingCount = useJobsStore((s) => s.pendingCount)
  const paused = useJobsStore((s) => s.paused)

  const gitIsRepo = gitSnapshot?.isRepo ?? false
  const gitAheadBehind = gitSnapshot?.branch
    ? (gitSnapshot.branch.ahead > 0 ? 1 : 0) + (gitSnapshot.branch.behind > 0 ? 1 : 0)
    : 0

  const engineTitle = paused
    ? 'Engine paused'
    : activeCount > 0
      ? `Engine — ${activeCount} running`
      : pendingCount > 0
        ? `Engine — ${pendingCount} queued`
        : 'Engine idle'

  return (
    <div
      ref={headerRef}
      className="titlebar-drag flex h-9 shrink-0 items-center gap-4 pl-[78px] pr-4"
    >
      {/* Toggle + arrows — a fixed pair, always adjacent to each other,
          given `leftClusterWidthPx` as its own width directly (see the doc
          comment above) so PathBreadcrumb right after it starts exactly at
          the centre column's edge. `minWidth: max-content` is only a
          fallback for a sidebar too narrow for the toggle+arrows to fit in
          that width. */}
      <div
        className="flex shrink-0 items-center gap-4"
        style={{ width: leftClusterWidthPx, minWidth: 'max-content' }}
      >
        <ChromeButton
          icon={leftPanelHidden ? 'layout-sidebar-left-off' : 'layout-sidebar-left'}
          iconClassName="codicon-inherit"
          onClick={() => toggleLeftPanel()}
          title={leftPanelHidden ? 'Open left sidebar' : 'Close left sidebar'}
          aria-label={leftPanelHidden ? 'Open left sidebar' : 'Close left sidebar'}
          className="h-7 shrink-0 px-0 titlebar-no-drag"
        />
        {vault ? <HeaderNavButtons /> : null}
      </div>

      {/* Where the tab row used to portal in — the active tab's own path,
          not the tab strip (that's inline at the top of EditorPanel now). */}
      {vault ? <PathBreadcrumb /> : <div className="flex-1 titlebar-no-drag" />}

      {vault ? (
        <>
          {/* Always the whole vault, wherever you are. A folder's graph is
              reached from that folder's own view — this one is the way back to
              the top from anywhere, so it must not depend on what is open. */}
          <ChromeButton
            icon="type-hierarchy"
            iconClassName="codicon-inherit"
            onClick={() => void openTab(GRAPH_HOME_PATH)}
            title="Graph of the whole vault"
            aria-label="Graph"
            // No active tint. The others here toggle a panel, so lighting up
            // says "this is open". This one just opens a tab, and a tab is
            // already visible in the tab row — a second indicator would be
            // claiming to be a switch it is not.
            className="h-7 px-0 titlebar-no-drag"
          />

          {/* Capture. Opens a field to paste a link or a passage into —
              deliberately not "read whatever was copied last", which acts on
              something nobody can see at the moment it acts. */}
          <ChromeButton
            icon="inbox"
            iconClassName="codicon-inherit"
            onClick={() => openCapture()}
            title="Turn a link or a passage into a note"
            aria-label="Capture"
            className="h-7 px-0 titlebar-no-drag"
          />

          <ChromeButton
            icon="lightbulb-sparkle"
            iconClassName="codicon-inherit"
            onClick={() => setContextOpen(true)}
            title="What the AI knows about this vault"
            aria-label="Context"
            aria-haspopup="dialog"
            aria-expanded={contextOpen}
            active={contextOpen}
            className="h-7 px-0 titlebar-no-drag"
          />

          <ChromeButton
            icon="link"
            iconClassName="codicon-inherit"
            onClick={() => setLinkHealthOpen(true)}
            title="Dead links and orphan notes"
            aria-label="Links"
            aria-haspopup="dialog"
            aria-expanded={linkHealthOpen}
            active={linkHealthOpen}
            className="h-7 px-0 titlebar-no-drag"
          />

          <ChromeButton
            icon="source-control"
            iconClassName="codicon-inherit"
            onClick={() => setSourceControlOpen(true)}
            title="Source Control"
            aria-label="Source Control"
            aria-haspopup="dialog"
            aria-expanded={sourceControlOpen}
            active={sourceControlOpen}
            className="relative h-7 px-0 titlebar-no-drag"
          >
            {gitIsRepo && gitAheadBehind > 0 ? (
              <span className="absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full bg-accent-1" />
            ) : null}
          </ChromeButton>

          <ChromeButton
            icon="vm-running"
            iconClassName="codicon-inherit"
            onClick={() => openEngineLog(true)}
            title={engineTitle}
            aria-label={engineTitle}
            active={activeCount > 0}
            className="h-7 px-0 titlebar-no-drag"
          />

          <ChromeButton
            icon="terminal"
            iconClassName="codicon-inherit"
            onClick={() => toggleBottomPanel()}
            title={bottomPanelOpen ? 'Close terminal' : 'Open terminal'}
            aria-label="Terminal"
            active={bottomPanelOpen}
            className="h-7 px-0 titlebar-no-drag"
          />

          <HelpMenu />
        </>
      ) : null}

      <ChromeButton
        icon={rightPanelHidden ? 'layout-sidebar-right-off' : 'layout-sidebar-right'}
        iconClassName="codicon-inherit"
        onClick={() => setRightPanelHidden(!rightPanelHidden)}
        title={rightPanelHidden ? 'Open right sidebar' : 'Close right sidebar'}
        aria-label={rightPanelHidden ? 'Open right sidebar' : 'Close right sidebar'}
        className="h-7 px-0 titlebar-no-drag"
      />

      {/* Last in the row, and outside the vault gate: an update is about the
          app rather than about what is open, and this is the one control here
          that comes and goes. At the end it can appear and disappear without
          moving anything else — among the icons, every one to its right
          shifted sideways each time. */}
      <UpdateButton />
    </div>
  )
}
