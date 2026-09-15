import { create } from 'zustand'
import { useEditorStore } from '@/features/editor/store'
import { allTabIds } from '@/platform/tab-layout'

const HISTORY_CAP = 50

interface TabHistory {
  back: string[]
  forward: string[]
}

interface NavigationState {
  // Mirrors the *active tab's own* stacks — see historyByTab below. Kept as
  // plain fields (rather than a lookup HeaderNavButtons would have to do
  // itself) so reading "can I go back" stays a one-line selector, the same
  // shape it always was.
  back: string[]
  forward: string[]
  clear(): void
  goBack(): void
  goForward(): void
}

// Every tab gets its own back/forward stack, keyed by its stable tab id —
// not by path, because open() now always replaces the active tab's path in
// place instead of opening a new one. Path-keyed history would reset itself
// on every single navigation; id-keyed history survives it, the same way
// the tab itself does.
const historyByTab: Record<string, TabHistory> = {}

function historyFor(tabId: string | null): TabHistory {
  if (!tabId) return { back: [], forward: [] }
  return (historyByTab[tabId] ??= { back: [], forward: [] })
}

function syncPublicStacks(): void {
  const h = historyFor(useEditorStore.getState().activeTabId)
  useNavigationStore.setState({ back: h.back, forward: h.forward })
}

// Suppresses the recording logic below while goBack/goForward are themselves
// driving a path change, so retracing history doesn't also get recorded as
// new history.
let navigating = false
let lastTabId: string | null = useEditorStore.getState().activeTabId
let lastPath: string | null = useEditorStore.getState().activePath

export const useNavigationStore = create<NavigationState>(() => ({
  back: [],
  forward: [],

  clear() {
    // A full reset (vault switch) — every tab's history goes, not just the
    // active one's.
    for (const id of Object.keys(historyByTab)) delete historyByTab[id]
    syncPublicStacks()
  },

  goBack() {
    const tabId = useEditorStore.getState().activeTabId
    const h = historyFor(tabId)
    const target = h.back[h.back.length - 1]
    if (!tabId || target === undefined) return
    const current = useEditorStore.getState().activePath
    h.back = h.back.slice(0, -1)
    h.forward = current ? [...h.forward, current].slice(-HISTORY_CAP) : h.forward
    navigating = true
    void useEditorStore.getState().replaceActiveTabPath(target)
    syncPublicStacks()
  },

  goForward() {
    const tabId = useEditorStore.getState().activeTabId
    const h = historyFor(tabId)
    const target = h.forward[h.forward.length - 1]
    if (!tabId || target === undefined) return
    const current = useEditorStore.getState().activePath
    h.forward = h.forward.slice(0, -1)
    h.back = current ? [...h.back, current].slice(-HISTORY_CAP) : h.back
    navigating = true
    void useEditorStore.getState().replaceActiveTabPath(target)
    syncPublicStacks()
  }
}))

// Records every path change as that tab's own history, but only when it
// happens *within* the same tab — switching to a different tab must never
// touch any stack, only change which tab's stacks are on screen.
useEditorStore.subscribe((state) => {
  const tabId = state.activeTabId
  const path = state.activePath
  if (tabId === lastTabId && path === lastPath) return
  const prevTabId = lastTabId
  const prevPath = lastPath
  lastTabId = tabId
  lastPath = path

  // Tabs that no longer exist (closed) don't need their history kept around.
  const live = new Set(allTabIds(state.layout))
  for (const id of Object.keys(historyByTab)) {
    if (!live.has(id)) delete historyByTab[id]
  }

  if (navigating) {
    navigating = false
    syncPublicStacks()
    return
  }

  if (tabId !== prevTabId) {
    // A different tab is active now (switched tabs, or the previous one was
    // closed) — just show its own already-existing history.
    syncPublicStacks()
    return
  }

  // Same tab, new path: a real navigation within it.
  if (!prevPath || !tabId) return
  const h = historyFor(tabId)
  if (h.back[h.back.length - 1] !== prevPath) {
    h.back = [...h.back, prevPath].slice(-HISTORY_CAP)
    h.forward = []
  }
  syncPublicStacks()
})
