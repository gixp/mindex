import { Suspense, lazy, useMemo } from 'react'
import { HISTORY_TAB_ID, tabMatchesView, useTabsStore } from '@/features/terminal/store-tabs'
import { useChatStore } from '@/features/chat/store-chat'
import { useHasProvider } from '@/platform/engines'
import { useUiStore } from '@/platform/app-settings'
import { defaultTabLabel } from '@/platform/tab-naming'
import { filterLayout, findGroup, firstLeaf } from '@/platform/tab-layout'
import { ChromeButton } from '@/ui/chrome-button'
import { type TabItem } from '@/ui/tab-bar'
import { ProviderRequiredNotice } from '@/ui/ProviderRequiredNotice'
import { SplitTabsView } from '@/features/layout/components/SplitTabsView'
const TerminalView = lazy(() => import('./TerminalView').then((m) => ({ default: m.TerminalView })))
import { RecentChatsList } from './RecentChatsList'
import { ChatTabBody } from '@/features/chat/components/ChatTabBody'

const CHAT_BASE = 'New chat'
const CLI_BASE = 'CLI'
const TAB_DRAG_MIME = 'application/x-mindex-tab'

export function AgentTabsPanel(): JSX.Element {
  const hasProvider = useHasProvider()
  const tabs = useTabsStore((s) => s.tabs)
  const layout = useTabsStore((s) => s.layout)
  const activeGroupId = useTabsStore((s) => s.activeGroupId)
  const bootstrapped = useTabsStore((s) => s.bootstrapped)
  const reloadKey = useTabsStore((s) => s.reloadKey)
  const setActive = useTabsStore((s) => s.setActive)
  const setActiveGroup = useTabsStore((s) => s.setActiveGroup)
  const closeTab = useTabsStore((s) => s.closeTab)
  const reorderTabs = useTabsStore((s) => s.reorderTabs)
  const reloadTab = useTabsStore((s) => s.reloadTab)
  const setCustomTitle = useTabsStore((s) => s.setCustomTitle)
  const addChatTab = useTabsStore((s) => s.addChatTab)
  const addCliTab = useTabsStore((s) => s.addCliTab)
  const openHistoryTab = useTabsStore((s) => s.openHistoryTab)
  const dropTabOnGroup = useTabsStore((s) => s.dropTabOnGroup)
  const defaultView = useTabsStore((s) => s.defaultView)

  const byId = useMemo(() => new Map(tabs.map((t) => [t.id, t])), [tabs])

  /**
   * Kills whatever was actually running before the tab itself is torn down.
   *
   * A terminal tab's own `TerminalView` already does this on unmount (its
   * cleanup effect calls `terminal.close`), since it stays mounted for as
   * long as its tab exists in `layout` and only unmounts once `closeTab`
   * removes it — closing the tab already kills that one for free. A chat
   * tab has no such effect: `ChatTabBody` mounting/unmounting has never been
   * tied to the agent process behind it, only to which tab is on screen, so
   * an in-flight turn kept running in the background with nothing left
   * showing it. Not in the store itself: `stores/tabs.ts` and `stores/chat.ts`
   * already import from each other in the other direction (`chat.ts` reads
   * `useTabsStore`), so cancelling here, where both are already in scope,
   * avoids turning that into an import cycle.
   */
  function handleClose(id: string): void {
    const tab = byId.get(id)
    if (tab?.mode === 'chat') void useChatStore.getState().cancel(id)
    closeTab(id)
  }

  // A render-time projection, never written back to `layout`: tabs of the
  // mode not currently on screen stay exactly where they are in the real
  // tree, just filtered out of this one view of it. Switching `defaultView`
  // back re-derives them from the same untouched layout — see
  // `applyDefaultView` in the tabs store for the one thing that *does*
  // happen at the moment of switching (closing empty tabs of the mode being
  // left, and guaranteeing a landing tab for the new one).
  const visibleLayout = useMemo(() => {
    const keep = (id: string): boolean => {
      if (id === HISTORY_TAB_ID) return true
      const t = byId.get(id)
      return !!t && tabMatchesView(t, defaultView)
    }
    return filterLayout(layout, keep) ?? layout
  }, [layout, byId, defaultView])

  const visibleActiveGroupId = useMemo(
    () => (findGroup(visibleLayout, activeGroupId) ? activeGroupId : firstLeaf(visibleLayout).id),
    [visibleLayout, activeGroupId]
  )

  if (!bootstrapped) return <div className="flex h-full flex-col" />

  // Every tab this panel could show — chat or CLI — needs a working
  // assistant behind it. Checked here, once, rather than inside each tab:
  // existing tabs stay in `layout` untouched (closing the last provider you
  // signed out of should not lose the conversation), they simply are not
  // what's on screen while nothing can answer.
  if (!hasProvider) {
    return (
      <ProviderRequiredNotice
        message="Connect an assistant to start chatting or using its CLI."
        actionLabel="Open Settings"
        onAction={() => useUiStore.getState().setSettingsOpen(true)}
        className="h-full"
      />
    )
  }

  return (
    <SplitTabsView
      layout={visibleLayout}
      activeGroupId={visibleActiveGroupId}
      dragMime={TAB_DRAG_MIME}
      addSpacing
      onSelect={setActive}
      onClose={handleClose}
      addLabel={defaultView === 'chat' ? 'New chat' : 'New CLI tab'}
      tabRowClassName="p-1.5"
      surfaceClassName="bg-transparent"
      activeTabClassName="bg-bg-4"
      inactiveTabClassName="bg-bg-3"
      onAdd={(groupId) => {
        // `groupId` comes from the visible (filtered) tree, but every id in
        // it is still a real leaf in the full one, so this reaches the real
        // group. + always matches the view you are looking at — there is no
        // separate remembered mode to disagree with what is on screen.
        setActiveGroup(groupId)
        if (defaultView === 'chat') addChatTab()
        else addCliTab()
      }}
      onRename={(id, next) => setCustomTitle(id, next)}
      onReorder={(from, to) => reorderTabs(from, to)}
      onDrop={(tabId, groupId, edge) => dropTabOnGroup(tabId, groupId, edge)}
      onFocusGroup={setActiveGroup}
      contextMenu={(id) => [{ label: 'Reload tab', icon: 'refresh', onClick: () => reloadTab(id) }]}
      rightSlot={(groupId) => (
        <ChromeButton
          box={28}
          icon="history"
          iconSize={14}
          title="Open chat history"
          aria-label="Open chat history"
          onClick={() => {
            setActiveGroup(groupId)
            openHistoryTab()
          }}
        />
      )}
      renderTabItem={(id): TabItem => {
        const t = byId.get(id)
        if (!t || id === HISTORY_TAB_ID) return { id, title: 'History' }
        const base = t.mode === 'chat' ? CHAT_BASE : CLI_BASE
        return {
          id,
          title: t.customTitle ?? t.title ?? defaultTabLabel(base, t.ordinal)
        }
      }}
      renderBody={(id) => {
        const t = byId.get(id)
        if (id === HISTORY_TAB_ID) return <RecentChatsList />
        if (t?.mode === 'chat') return <ChatTabBody sessionId={id} />
        return (
          <Suspense fallback={null}>
            <TerminalView
              key={`${id}-${reloadKey[id] ?? 0}`}
              provider={t?.provider ?? 'claude'}
              model={t?.model}
              headerless
              sessionId={id}
            />
          </Suspense>
        )
      }}
    />
  )
}
