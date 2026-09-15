import { create } from 'zustand'
import { api } from '@/platform/api'
import { defaultTabLabel, pickFreeOrdinal } from '@/platform/tab-naming'
import { useUiStore } from '@/platform/app-settings'
import { useVaultStore } from '@/platform/workspace'
import {
  type DropEdge,
  type LayoutNode,
  type LeafGroup,
  dropTab as dropTabInTree,
  findGroup,
  findLeafByTab,
  firstLeaf,
  insertTab as insertTabInTree,
  makeLeaf,
  removeTab as removeTabFromTree,
  reorderInGroup,
  setActive as setActiveInTree
} from '@/platform/tab-layout'

const BASE = 'Terminal'

export interface TerminalTab {
  id: string
  ordinal: number
  customTitle?: string
  cwd?: string
}

function newId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function takenLabels(tabs: TerminalTab[]): string[] {
  return tabs.map((t) => t.customTitle ?? defaultTabLabel(BASE, t.ordinal))
}

function newTab(tabs: TerminalTab[]): TerminalTab {
  return { id: newId(), ordinal: pickFreeOrdinal(takenLabels(tabs), BASE) }
}

function singleGroupLayout(
  tabIds: string[],
  activeId: string
): { layout: LeafGroup; activeGroupId: string } {
  const leaf = makeLeaf(tabIds, activeId)
  return { layout: leaf, activeGroupId: leaf.id }
}

const seed: TerminalTab = { id: newId(), ordinal: 0 }
const seedLayout = singleGroupLayout([seed.id], seed.id)

let persistTimer: ReturnType<typeof setTimeout> | null = null
function schedulePersist(state: TerminalTabsState): void {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    void api().settings.setVault({
      terminalTabs: {
        tabs: state.tabs.map((t) => {
          const out: { id: string; customTitle?: string; cwd?: string } = { id: t.id }
          if (t.customTitle) out.customTitle = t.customTitle
          if (t.cwd) out.cwd = t.cwd
          return out
        }),
        activeId: state.activeId
      }
    })
  }, 250)
}

interface TerminalTabsState {
  tabs: TerminalTab[]
  activeId: string
  layout: LayoutNode
  activeGroupId: string
  reloadKey: Record<string, number>

  addTab(groupId?: string): void
  closeTab(id: string): void
  setActive(id: string): void
  setActiveGroup(groupId: string): void
  dropTabOnGroup(tabId: string, targetGroupId: string, edge: DropEdge): void
  setCustomTitle(id: string, customTitle: string): void
  reloadTab(id: string): void
  reorderTabs(fromId: string, toId: string): void
  bootstrap(): Promise<void>
  reset(): void
}

export const useTerminalTabsStore = create<TerminalTabsState>((set) => ({
  tabs: [seed],
  activeId: seed.id,
  layout: seedLayout.layout,
  activeGroupId: seedLayout.activeGroupId,
  reloadKey: {},

  addTab(groupId) {
    set((s) => {
      const t = newTab(s.tabs)
      const targetGroupId =
        (groupId && findGroup(s.layout, groupId)?.id) ??
        findGroup(s.layout, s.activeGroupId)?.id ??
        firstLeaf(s.layout).id
      const next = {
        tabs: [...s.tabs, t],
        layout: insertTabInTree(s.layout, targetGroupId, t.id),
        activeId: t.id,
        activeGroupId: targetGroupId
      }
      schedulePersist({ ...s, ...next })
      return next
    })
  },

  closeTab(id) {
    set((s) => {
      if (!s.tabs.some((t) => t.id === id)) return s
      const tabs = s.tabs.filter((t) => t.id !== id)
      const layout = removeTabFromTree(s.layout, id)
      let activeId = s.activeId
      let activeGroupId = s.activeGroupId
      if (!layout) {
        const fresh: TerminalTab = { id: newId(), ordinal: 0 }
        const sg = singleGroupLayout([fresh.id], fresh.id)
        useUiStore.getState().setBottomPanelOpen(false)
        const reseeded = {
          tabs: [fresh],
          layout: sg.layout,
          activeGroupId: sg.activeGroupId,
          activeId: fresh.id
        }
        schedulePersist({ ...s, ...reseeded })
        return reseeded
      }
      const activeGrp = findGroup(layout, activeGroupId)
      if (!activeGrp) {
        const fl = firstLeaf(layout)
        activeGroupId = fl.id
        activeId = fl.activeId
      } else if (id === s.activeId) {
        activeId = activeGrp.activeId || activeId
      }
      const next = { tabs, layout, activeId, activeGroupId }
      schedulePersist({ ...s, ...next })
      return next
    })
  },

  setActive(id) {
    set((s) => {
      const grp = findLeafByTab(s.layout, id)
      if (!grp) return s
      if (s.activeId === id && s.activeGroupId === grp.id && grp.activeId === id) {
        return s
      }
      const next = {
        layout: setActiveInTree(s.layout, grp.id, id),
        activeId: id,
        activeGroupId: grp.id
      }
      schedulePersist({ ...s, ...next })
      return next
    })
  },

  setActiveGroup(groupId) {
    set((s) => {
      const grp = findGroup(s.layout, groupId)
      if (!grp || s.activeGroupId === groupId) return s
      const next = { activeGroupId: groupId, activeId: grp.activeId || s.activeId }
      schedulePersist({ ...s, ...next })
      return next
    })
  },

  dropTabOnGroup(tabId, targetGroupId, edge) {
    set((s) => {
      const { tree, groupId } = dropTabInTree(s.layout, tabId, targetGroupId, edge)
      if (tree === s.layout) return s
      const next = { layout: tree, activeGroupId: groupId, activeId: tabId }
      schedulePersist({ ...s, ...next })
      return next
    })
  },

  setCustomTitle(id, customTitle) {
    const trimmed = customTitle.trim()
    set((s) => {
      const next = {
        tabs: s.tabs.map((t) =>
          t.id === id ? { ...t, customTitle: trimmed.length > 0 ? trimmed : undefined } : t
        )
      }
      schedulePersist({ ...s, ...next })
      return next
    })
  },

  reloadTab(id) {
    set((s) => ({ reloadKey: { ...s.reloadKey, [id]: (s.reloadKey[id] ?? 0) + 1 } }))
  },

  reorderTabs(fromId, toId) {
    set((s) => {
      const grp = findLeafByTab(s.layout, fromId)
      if (!grp || !grp.tabIds.includes(toId) || fromId === toId) return s
      const next = { layout: reorderInGroup(s.layout, grp.id, fromId, toId) }
      schedulePersist({ ...s, ...next })
      return next
    })
  },

  async bootstrap() {
    const root = useVaultStore.getState().vault?.root
    const r = await api().settings.getVault()
    if (useVaultStore.getState().vault?.root !== root) return
    const persisted = r.ok && r.data ? r.data.terminalTabs : undefined
    if (!persisted || persisted.tabs.length === 0) {
      const fresh: TerminalTab = { id: newId(), ordinal: 0 }
      const sg = singleGroupLayout([fresh.id], fresh.id)
      set({ tabs: [fresh], activeId: fresh.id, layout: sg.layout, activeGroupId: sg.activeGroupId })
      return
    }
    const rebuilt: TerminalTab[] = []
    for (const t of persisted.tabs) {
      const base: TerminalTab = { id: t.id, ordinal: 0 }
      if (t.customTitle) base.customTitle = t.customTitle
      if (t.cwd) base.cwd = t.cwd
      if (!base.customTitle) base.ordinal = pickFreeOrdinal(takenLabels(rebuilt), BASE)
      rebuilt.push(base)
    }
    const activeId = rebuilt.some((t) => t.id === persisted.activeId)
      ? persisted.activeId
      : rebuilt[0]!.id
    const sg = singleGroupLayout(
      rebuilt.map((t) => t.id),
      activeId
    )
    set({ tabs: rebuilt, activeId, layout: sg.layout, activeGroupId: sg.activeGroupId })
    // Deliberately does NOT touch `bottomPanelOpen`. Whether the drawer is open
    // is one fact with one home — `AppSettings.bottomPanelOpen`, written every
    // time it is toggled. This used to force it open from a second copy kept in
    // vault settings, so opening a vault reopened the terminal however the user
    // had left the app. Two stores for one boolean means whichever loads last
    // wins, which is not a rule anyone can predict.
  },

  reset() {
    if (persistTimer) {
      clearTimeout(persistTimer)
      persistTimer = null
    }
    const fresh: TerminalTab = { id: newId(), ordinal: 0 }
    const sg = singleGroupLayout([fresh.id], fresh.id)
    set({
      tabs: [fresh],
      activeId: fresh.id,
      layout: sg.layout,
      activeGroupId: sg.activeGroupId,
      reloadKey: {}
    })
  }
}))
