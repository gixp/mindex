import { Suspense, lazy } from 'react'
import { useTerminalTabsStore } from '@/features/terminal/store-terminalTabs'
import { useVaultStore } from '@/platform/workspace'
import { useUiStore } from '@/platform/app-settings'
import { defaultTabLabel } from '@/platform/tab-naming'
import { ChromeButton } from '@/ui/chrome-button'
import { type TabItem } from '@/ui/tab-bar'
import { SplitTabsView } from '@/features/layout/components/SplitTabsView'
const TerminalView = lazy(() => import('./TerminalView').then((m) => ({ default: m.TerminalView })))

const BASE = 'Terminal'
const TERMINAL_DRAG_MIME = 'application/x-mindex-tab-terminal'

export function TerminalTabsPanel(): JSX.Element {
  const tabs = useTerminalTabsStore((s) => s.tabs)
  const layout = useTerminalTabsStore((s) => s.layout)
  const activeGroupId = useTerminalTabsStore((s) => s.activeGroupId)
  const reloadKey = useTerminalTabsStore((s) => s.reloadKey)
  const setActive = useTerminalTabsStore((s) => s.setActive)
  const setActiveGroup = useTerminalTabsStore((s) => s.setActiveGroup)
  const addTab = useTerminalTabsStore((s) => s.addTab)
  const closeTab = useTerminalTabsStore((s) => s.closeTab)
  const reloadTab = useTerminalTabsStore((s) => s.reloadTab)
  const reorderTabs = useTerminalTabsStore((s) => s.reorderTabs)
  const setCustomTitle = useTerminalTabsStore((s) => s.setCustomTitle)
  const dropTabOnGroup = useTerminalTabsStore((s) => s.dropTabOnGroup)
  const vaultRoot = useVaultStore((s) => s.vault?.root)

  const byId = new Map(tabs.map((t) => [t.id, t]))

  return (
    <SplitTabsView
      layout={layout}
      activeGroupId={activeGroupId}
      dragMime={TERMINAL_DRAG_MIME}
      addSpacing
      addLabel="New terminal"
      tabRowClassName="p-1"
      onSelect={setActive}
      onClose={closeTab}
      onAdd={(groupId) => addTab(groupId)}
      onRename={(id, next) => setCustomTitle(id, next)}
      onReorder={(from, to) => reorderTabs(from, to)}
      onDrop={(tabId, groupId, edge) => dropTabOnGroup(tabId, groupId, edge)}
      onFocusGroup={setActiveGroup}
      contextMenu={(id) => [
        { label: 'Restart shell', icon: 'refresh', onClick: () => reloadTab(id) }
      ]}
      renderTabItem={(id): TabItem => {
        const t = byId.get(id)
        return {
          id,
          title: t?.customTitle ?? defaultTabLabel(BASE, t?.ordinal ?? 0)
        }
      }}
      renderBody={(id) => (
        <Suspense fallback={null}>
          <TerminalView
            key={`${id}-${reloadKey[id] ?? 0}`}
            mode="shell"
            headerless
            cwd={byId.get(id)?.cwd ?? vaultRoot}
          />
        </Suspense>
      )}
      rightSlot={() => (
        <ChromeButton
          box={28}
          icon="close"
          iconSize={14}
          title="Close terminal"
          aria-label="Close terminal"
          onClick={() => useUiStore.getState().setBottomPanelOpen(false)}
        />
      )}
    />
  )
}
