import { create } from 'zustand'
import type { ChatEffort, ChatModel, ChatPermissionMode } from '@shared/chat'
import type { ProviderId } from '@shared/types'
import type { ComposerShape } from '@/features/chat/lib/request-shape'

import { api } from '@/platform/api'
import { useVaultStore } from '@/platform/workspace'
import { useUiStore } from '@/platform/app-settings'
import { useProvidersStore } from '@/platform/engines'
import { useAgentOptionsStore } from '@/features/chat/store-agentOptions'
import { activeDocumentPath, isFolderViewPath } from '@/platform/documents'
import { isExcalidrawPath } from '@shared/excalidraw'
import { defaultTabLabel, pickFreeOrdinal } from '@/platform/tab-naming'
import {
  type DropEdge,
  type LayoutNode,
  type LeafGroup,
  dropTab as dropTabInTree,
  filterLayout,
  findGroup,
  findLeafByTab,
  firstLeaf,
  insertTab as insertTabInTree,
  makeLeaf,
  removeTab as removeTabFromTree,
  reorderInGroup,
  setActive as setActiveInTree
} from '@/platform/tab-layout'

const CHAT_BASE = 'New chat'
const CLI_BASE = 'CLI'

export interface ChatTabConfig {
  /** Which CLI answers. Absent on tabs created before providers existed. */
  provider?: ProviderId
  model: ChatModel
  effort: ChatEffort
  permissionMode: ChatPermissionMode
  /**
   * What to ask for beyond the words typed — reach, destination, length.
   *
   * Absent means all three at their ordinary value, which is what every tab
   * saved before this had. Kept on the tab rather than app-wide: it describes
   * the work this conversation is doing, and the next one is usually doing
   * something else.
   */
  request?: ComposerShape
}

export const DEFAULT_CHAT_CONFIG: ChatTabConfig = {
  provider: 'claude',
  model: 'opus',
  effort: 'medium',
  permissionMode: 'acceptEdits'
}

let liveChatDefaults: ChatTabConfig = { ...DEFAULT_CHAT_CONFIG }

/**
 * The engine's assistant, read once at startup, for tabs that remember none.
 *
 * Only ever used to fill a gap left by the old behaviour. Nothing keeps it in
 * step afterwards on purpose: changing the engine's assistant must not reach
 * a conversation any more.
 */
let inheritedProvider: ProviderId | undefined

/** The engine chosen in Settings, mirrored here so tab creation is synchronous. */
let liveEngineProvider: ProviderId = 'claude'
let liveEngineModel = 'opus'

/**
 * Keeps the mirror in step when the engine is changed while the app is open —
 * same reasoning as `setDefaultView` below. Without this, a provider/model
 * switch in Settings never reached tab creation at all: nothing called this
 * before it existed, and `bootstrap()` never read `engine` off disk either,
 * so the mirror stayed on its hardcoded initial value ('claude'/'opus') for
 * the entire life of the app, restart included, for any new tab that had no
 * more specific per-path `chatDefaults` to fall back on first.
 */
export function setLiveEngine(provider: ProviderId, model: string): void {
  liveEngineProvider = provider
  liveEngineModel = model
}

let chatDefaultsTimer: ReturnType<typeof setTimeout> | null = null
function persistChatDefaults(cfg: ChatTabConfig): void {
  liveChatDefaults = { ...cfg }
  if (chatDefaultsTimer) clearTimeout(chatDefaultsTimer)
  chatDefaultsTimer = setTimeout(() => {
    chatDefaultsTimer = null
    void api().settings.setApp({ chatDefaults: cfg })
  }, 250)
}

export const HISTORY_TAB_ID = '__history__'

export const MINDEX_TAB_ID = '__mindex__'

export interface AgentTab {
  id: string
  /** For terminal tabs: which agent CLI runs in it, and on which model. */
  provider?: ProviderId
  model?: string
  title?: string
  customTitle?: string
  ordinal: number
  mode?: 'terminal' | 'chat'
  chat?: ChatTabConfig
  /** The file open in the editor at the moment this chat was created, if
   *  any — seeds the composer's attachment chip once. Deliberately not part
   *  of `chat` (which persists to settings): this is a one-time hint for the
   *  tab's first render, not something that should survive a relaunch. */
  initialAttachment?: string
}

function isChatTab(t: AgentTab): boolean {
  return t.mode === 'chat'
}

/**
 * Whether a tab belongs on screen under the given global view.
 *
 * `mode === undefined` counts as terminal, the same convention the old
 * per-tab switch used (a bare session opened by id, with no mode recorded,
 * always rendered as a terminal — see AgentTabsPanel's `renderBody`).
 */
export function tabMatchesView(t: AgentTab, view: 'chat' | 'cli'): boolean {
  return isChatTab(t) === (view === 'chat')
}

export function chatConfigOf(tab: AgentTab): ChatTabConfig {
  return { ...DEFAULT_CHAT_CONFIG, ...(tab.chat ?? {}) }
}

function tabLabel(t: AgentTab): string {
  const base = isChatTab(t) ? CHAT_BASE : CLI_BASE
  return t.customTitle ?? t.title ?? defaultTabLabel(base, t.ordinal)
}

function newId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}

/** The file open in the editor right now, if it's a real file worth
 *  attaching (not a folder view or an Excalidraw board). */
function activeFileForAttachment(): string | undefined {
  const path = activeDocumentPath()
  if (!path || isFolderViewPath(path) || isExcalidrawPath(path)) return undefined
  return path
}

interface TabsState {
  tabs: AgentTab[]
  activeId: string
  layout: LayoutNode
  activeGroupId: string
  bootstrapped: boolean
  reloadKey: Record<string, number>
  ptyIds: Record<string, string>
  /**
   * Which face the right sidebar shows — mirrors `AppSettings.defaultView`.
   *
   * Reactive (unlike the module-level `liveDefaultView` mirror below, which
   * exists only so tab creation can read it synchronously outside React) so
   * that `AgentTabsPanel` re-renders and re-filters the moment it changes.
   */
  defaultView: 'chat' | 'cli'
  /**
   * Tabs the user has actually put something into.
   *
   * A chat's emptiness is visible from its turns, but a terminal's is not — it
   * prints a banner before anyone touches it, so "has output" would call every
   * CLI tab occupied. What matters is whether *the user* typed, which is the
   * only thing that would be lost by reusing the tab.
   */
  touched: Record<string, boolean>

  setPtyId(tabId: string, ptyId: string | null): void
  markTouched(tabId: string): void
  /**
   * Runs once, at the moment the view changes — not on every render. Tabs of
   * the mode being left are not converted or closed outright: a non-empty one
   * stays exactly as it is, just off screen until the view switches back. An
   * empty one is closed here, since an untouched tab has nothing to come back
   * to and would otherwise just pile up as a duplicate of the next empty tab
   * this mode eventually gets anyway. Then, if nothing of the new mode is
   * left to land on, one is opened fresh.
   */
  applyDefaultView(view: 'chat' | 'cli'): void
  addChatTab(engine?: { provider: ProviderId; model: string }): void
  addCliTab(): void
  setChatConfig(tabId: string, patch: Partial<ChatTabConfig>): void
  setActiveGroup(groupId: string): void
  dropTabOnGroup(tabId: string, targetGroupId: string, edge: DropEdge): void
  openHistoryTab(): void
  openSession(sessionId: string): void
  openChatSession(sessionId: string): void
  closeTab(id: string): void
  reorderTabs(fromId: string, toId: string): void
  setActive(id: string): void
  setTitle(id: string, title: string): void
  setCustomTitle(id: string, customTitle: string): void
  replaceActive(sessionId: string): void
  reloadTab(id: string): void
  bootstrap(): Promise<void>
  reset(): void
}

/** Which face a fresh tab opens as. Mirrored from settings; see AppSettings. */
let liveDefaultView: 'chat' | 'cli' = 'chat'

/**
 * Keeps the mirror in step when the setting is changed while the app is open,
 * and drives the right sidebar's own reaction to it — see
 * `TabsState.applyDefaultView`. Without the mirror update, changing the
 * choice in Settings would only take effect after a restart: the next new
 * tab would still open as whatever the mirror was holding.
 */
export function setDefaultView(view: 'chat' | 'cli'): void {
  liveDefaultView = view
  useTabsStore.getState().applyDefaultView(view)
}

/**
 * A remembered chat config, given an assistant if it names none.
 *
 * Every chat tab used to follow the assistant chosen in Settings, so a tab
 * saved before that changed carries no assistant of its own. Letting those
 * fall to the built-in default would move somebody off the assistant they had
 * been talking to, quietly, on the next launch. They inherit the one they were
 * actually using instead, once, and it is written down.
 */
export function withInheritedProvider(
  stored: Partial<ChatTabConfig>,
  inherited: ProviderId | undefined
): Partial<ChatTabConfig> {
  if (stored.provider || !inherited) return stored
  return { ...stored, provider: inherited }
}

function newChatTab(): AgentTab {
  if (liveDefaultView === 'cli') {
    return {
      id: newId(),
      ordinal: 0,
      mode: 'terminal',
      // `liveChatDefaults` is loaded from settings; the engine mirror is only
      // a fallback for a first run that has neither.
      provider: liveChatDefaults.provider ?? liveEngineProvider,
      model: liveChatDefaults.model || liveEngineModel
    }
  }
  return {
    id: newId(),
    ordinal: 0,
    mode: 'chat',
    chat: { ...liveChatDefaults }
  }
}

function singleGroupLayout(
  tabIds: string[],
  activeId: string
): { layout: LeafGroup; activeGroupId: string } {
  const leaf = makeLeaf(tabIds, activeId)
  return { layout: leaf, activeGroupId: leaf.id }
}

function focusTabPatch(
  s: TabsState,
  id: string
): Pick<TabsState, 'layout' | 'activeId' | 'activeGroupId'> | null {
  const grp = findLeafByTab(s.layout, id)
  if (!grp) return null
  return {
    layout: setActiveInTree(s.layout, grp.id, id),
    activeId: id,
    activeGroupId: grp.id
  }
}

function withTabInActiveGroup(
  s: TabsState,
  tab: AgentTab
): Pick<TabsState, 'tabs' | 'layout' | 'activeId' | 'activeGroupId'> {
  const targetGroupId = findGroup(s.layout, s.activeGroupId)?.id ?? firstLeaf(s.layout).id
  return {
    tabs: [...s.tabs, tab],
    layout: insertTabInTree(s.layout, targetGroupId, tab.id),
    activeId: tab.id,
    activeGroupId: targetGroupId
  }
}

/**
 * Whether a chat session holds any turns.
 *
 * Registered by the chat store rather than imported from it: chat.ts already
 * imports this module, and reaching back the other way would close the cycle.
 * Inverting it keeps the dependency one-way and still gives an honest answer
 * for sessions restored from disk, which a "mark it when the user types"
 * approach would call empty.
 */
let hasChatContent: (sessionId: string) => boolean = () => false

export function registerChatContentProbe(fn: (sessionId: string) => boolean): void {
  hasChatContent = fn
}

/** Would reusing this tab throw away something the user made? */
function isTabOccupied(id: string, tab: AgentTab): boolean {
  if (tab.mode === 'chat') return hasChatContent(id)
  return useTabsStore.getState().touched[id] === true
}

let persistTimer: ReturnType<typeof setTimeout> | null = null

function schedulePersist(state: TabsState): void {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    void api().settings.setVault({
      tabs: {
        tabs: state.tabs.map((t) => {
          const out: {
            id: string
            customTitle?: string
            mode?: 'terminal' | 'chat'
            provider?: ProviderId
            model?: string
            chat?: ChatTabConfig
          } = { id: t.id }
          if (t.customTitle) out.customTitle = t.customTitle
          if (t.provider) out.provider = t.provider
          if (t.model) out.model = t.model
          if (t.mode === 'chat') {
            out.mode = 'chat'
            out.chat = chatConfigOf(t)
          }
          return out
        }),
        activeId: state.activeId
      }
    })
  }, 250)
}

const initialSeed = newChatTab()
const initialLayout = singleGroupLayout([initialSeed.id], initialSeed.id)

/**
 * Whether a launch reopens the chats that were open when the app last closed.
 *
 * Off, deliberately — see `bootstrap`. Named rather than deleted so the
 * behaviour is a decision someone can find and reverse, not an absence.
 */
const RESTORE_TABS_ON_LAUNCH = false

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [initialSeed],
  activeId: initialSeed.id,
  layout: initialLayout.layout,
  activeGroupId: initialLayout.activeGroupId,
  bootstrapped: false,
  reloadKey: {},
  ptyIds: {},
  defaultView: liveDefaultView,
  touched: {},

  markTouched(tabId) {
    if (get().touched[tabId]) return // once is enough; this runs per keystroke
    set((s) => ({ touched: { ...s.touched, [tabId]: true } }))
  },

  applyDefaultView(view) {
    set((s) => {
      if (s.defaultView === view) return s

      // Off screen from here, not gone — closed only if there was nothing in
      // it to lose. HISTORY_TAB_ID is neither a chat nor a CLI tab and stays
      // visible in both views, same as before.
      const keepTab = (t: AgentTab): boolean =>
        t.id === HISTORY_TAB_ID || tabMatchesView(t, view) || isTabOccupied(t.id, t)
      const survivors = s.tabs.filter(keepTab)
      const survivingIds = new Set(survivors.map((t) => t.id))
      const tabs = survivors
      // `filterLayout` only ever drops ids `tabs` also drops, so it cannot
      // legitimately return null while `tabs` is non-empty — the fallback to
      // `s.layout` just keeps this branch total if that were ever wrong.
      let layout = filterLayout(s.layout, (id) => survivingIds.has(id)) ?? s.layout
      let activeId = s.activeId
      let activeGroupId = s.activeGroupId

      const active = tabs.find((t) => t.id === activeId)
      const activeSurvives =
        active && (active.id === HISTORY_TAB_ID || tabMatchesView(active, view))

      if (!activeSurvives) {
        const landing = tabs.find((t) => t.id !== HISTORY_TAB_ID && tabMatchesView(t, view))
        if (landing) {
          // Something of the new view was already open in the background —
          // land on it rather than opening a duplicate.
          const grp = findLeafByTab(layout, landing.id)
          activeId = landing.id
          if (grp) {
            layout = setActiveInTree(layout, grp.id, landing.id)
            activeGroupId = grp.id
          }
        } else {
          // Nothing of the new view survived (or ever existed) — open one.
          const fresh: AgentTab =
            view === 'chat'
              ? {
                  id: newId(),
                  ordinal: pickFreeOrdinal(tabs.map(tabLabel), CHAT_BASE),
                  mode: 'chat',
                  chat: { ...liveChatDefaults }
                }
              : {
                  id: newId(),
                  ordinal: pickFreeOrdinal(tabs.map(tabLabel), CLI_BASE),
                  mode: 'terminal',
                  provider: liveChatDefaults.provider ?? liveEngineProvider,
                  model: liveChatDefaults.model || liveEngineModel
                }
          const targetGroupId = findGroup(layout, activeGroupId)?.id ?? firstLeaf(layout).id
          layout = insertTabInTree(layout, targetGroupId, fresh.id)
          tabs.push(fresh)
          activeId = fresh.id
          activeGroupId = targetGroupId
        }
      }

      const next = { defaultView: view, tabs, layout, activeId, activeGroupId }
      schedulePersist({ ...s, ...next })
      return next
    })
  },

  setPtyId(tabId, ptyId) {
    set((s) => {
      const next = { ...s.ptyIds }
      if (ptyId) next[tabId] = ptyId
      else delete next[tabId]
      return { ptyIds: next }
    })
  },

  reloadTab(id) {
    set((s) => ({ reloadKey: { ...s.reloadKey, [id]: (s.reloadKey[id] ?? 0) + 1 } }))
  },

  addChatTab(engine) {
    set((s) => {
      const ordinal = pickFreeOrdinal(s.tabs.map(tabLabel), CHAT_BASE)
      const t: AgentTab = {
        id: newId(),
        ordinal,
        mode: 'chat',
        chat: { ...liveChatDefaults, ...(engine ?? {}) },
        initialAttachment: activeFileForAttachment()
      }
      const next = withTabInActiveGroup(s, t)
      schedulePersist({ ...s, ...next })
      return next
    })
  },

  addCliTab() {
    set((s) => {
      const ordinal = pickFreeOrdinal(s.tabs.map(tabLabel), CLI_BASE)
      // Inherit from the tab you are standing on. Opening a CLI while looking
      // at a Gemini chat and getting Claude is the kind of surprise that makes
      // people check the setting every time; the app-wide engine is only the
      // fallback when there is nothing to inherit from.
      const from = s.tabs.find((x) => x.id === s.activeId)
      const t: AgentTab = {
        id: newId(),
        ordinal,
        mode: 'terminal',
        provider: from?.chat?.provider ?? from?.provider ?? liveEngineProvider,
        model: from?.chat?.model ?? from?.model ?? liveEngineModel
      }
      const next = withTabInActiveGroup(s, t)
      schedulePersist({ ...s, ...next })
      return next
    })
  },

  setActiveGroup(groupId) {
    set((s) => {
      const grp = findGroup(s.layout, groupId)
      if (!grp || s.activeGroupId === groupId) return s
      return { activeGroupId: groupId, activeId: grp.activeId || s.activeId }
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

  setChatConfig(tabId, patch) {
    set((s) => {
      let changed = false
      let merged: ChatTabConfig | null = null
      const tabs = s.tabs.map((t) => {
        if (t.id !== tabId || t.mode !== 'chat') return t
        changed = true
        merged = { ...chatConfigOf(t), ...patch }
        return { ...t, chat: merged }
      })
      if (!changed) return s
      if (merged) persistChatDefaults(merged)
      const next = { tabs }
      schedulePersist({ ...s, ...next })
      return next
    })
  },

  openHistoryTab() {
    set((s) => {
      const existing = s.tabs.find((t) => t.id === HISTORY_TAB_ID)
      if (existing) {
        const grp = findLeafByTab(s.layout, HISTORY_TAB_ID)
        const next = grp
          ? {
              layout: setActiveInTree(s.layout, grp.id, HISTORY_TAB_ID),
              activeId: HISTORY_TAB_ID,
              activeGroupId: grp.id
            }
          : { activeId: HISTORY_TAB_ID }
        schedulePersist({ ...s, ...next })
        return next
      }
      const t: AgentTab = { id: HISTORY_TAB_ID, customTitle: 'History', ordinal: 0 }
      const next = withTabInActiveGroup(s, t)
      schedulePersist({ ...s, ...next })
      return next
    })
  },

  // Killing whatever was actually running (an in-flight chat turn) happens
  // one layer up, in `AgentTabsPanel`'s `handleClose` — not here, since that
  // needs `useChatStore`, and this file is already imported BY `chat.ts`
  // (for `useTabsStore`/`registerChatContentProbe`); importing it back would
  // make the two stores import each other.
  closeTab(id) {
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id)
      if (idx === -1) return s
      let tabs = s.tabs.filter((t) => t.id !== id)
      let layout = removeTabFromTree(s.layout, id)
      let activeId = s.activeId
      let activeGroupId = s.activeGroupId
      if (!layout) {
        // The very last tab, chat or CLI either way — a fresh one still
        // gets seeded underneath (everything downstream assumes at least
        // one exists), but the sidebar itself closes rather than silently
        // popping open a blank replacement in its place.
        const fresh = newChatTab()
        tabs = [fresh]
        const sg = singleGroupLayout([fresh.id], fresh.id)
        layout = sg.layout
        activeGroupId = sg.activeGroupId
        activeId = fresh.id
        useUiStore.getState().setRightPanelHidden(true)
      } else {
        const activeGrp = findGroup(layout, activeGroupId)
        if (!activeGrp) {
          const fl = firstLeaf(layout)
          activeGroupId = fl.id
          activeId = fl.activeId
        } else if (id === s.activeId) {
          activeId = activeGrp.activeId || activeId
        }
      }
      const updated = { tabs, layout, activeId, activeGroupId }
      schedulePersist({ ...s, ...updated })
      return updated
    })
  },

  reorderTabs(fromId, toId) {
    set((s) => {
      const grp = findLeafByTab(s.layout, fromId)
      if (!grp || !grp.tabIds.includes(toId) || fromId === toId) return s
      const layout = reorderInGroup(s.layout, grp.id, fromId, toId)
      schedulePersist({ ...s, layout })
      return { layout }
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

  setTitle(id, title) {
    set((s) => {
      let changed = false
      const tabs = s.tabs.map((t) => {
        if (t.id !== id) return t
        if (t.title === title) return t
        changed = true
        return { ...t, title }
      })
      if (!changed) return s
      return { tabs }
    })
  },

  setCustomTitle(id, customTitle) {
    set((s) => {
      const trimmed = customTitle.trim()
      const tabs = s.tabs.map((t) =>
        t.id === id ? { ...t, customTitle: trimmed.length > 0 ? trimmed : undefined } : t
      )
      const next = { tabs }
      schedulePersist({ ...s, ...next })
      return next
    })
  },

  openSession(sessionId: string) {
    set((s) => {
      if (s.tabs.some((t) => t.id === sessionId)) {
        const next = focusTabPatch(s, sessionId)
        if (!next) return s
        schedulePersist({ ...s, ...next })
        return next
      }
      const t: AgentTab = { id: sessionId, ordinal: 0 }
      const next = withTabInActiveGroup(s, t)
      schedulePersist({ ...s, ...next })
      return next
    })
    void api()
      .claude.getSessionTitle(sessionId)
      .then((res) => {
        if (res.ok && res.data) get().setTitle(sessionId, res.data)
      })
  },

  openChatSession(sessionId: string) {
    set((s) => {
      if (s.tabs.some((t) => t.id === sessionId)) {
        const next = focusTabPatch(s, sessionId)
        if (!next) return s
        schedulePersist({ ...s, ...next })
        return next
      }
      const t: AgentTab = {
        id: sessionId,
        ordinal: 0,
        mode: 'chat',
        chat: { ...liveChatDefaults }
      }
      const next = withTabInActiveGroup(s, t)
      schedulePersist({ ...s, ...next })
      return next
    })
  },

  replaceActive(sessionId) {
    set((s) => {
      const oldId = s.activeId
      const idx = s.tabs.findIndex((t) => t.id === oldId)
      if (idx === -1) return s
      if (s.tabs.some((t) => t.id === sessionId)) {
        const next = focusTabPatch(s, sessionId)
        if (!next) return s
        schedulePersist({ ...s, ...next })
        return next
      }
      const tabs = s.tabs.slice()
      tabs[idx] = { id: sessionId, ordinal: 0 }
      const grp = findLeafByTab(s.layout, oldId)
      const removed = removeTabFromTree(s.layout, oldId)
      let layout: LayoutNode
      let activeGroupId: string
      if (!removed) {
        const sg = singleGroupLayout([sessionId], sessionId)
        layout = sg.layout
        activeGroupId = sg.activeGroupId
      } else {
        const targetId = (grp && findGroup(removed, grp.id)?.id) ?? firstLeaf(removed).id
        layout = insertTabInTree(removed, targetId, sessionId)
        activeGroupId = targetId
      }
      const updated = { tabs, layout, activeId: sessionId, activeGroupId }
      schedulePersist({ ...s, ...updated })
      return updated
    })
    void api()
      .claude.getSessionTitle(sessionId)
      .then((res) => {
        if (res.ok && res.data) get().setTitle(sessionId, res.data)
      })
  },

  async bootstrap() {
    const a = api()
    const root = useVaultStore.getState().vault?.root
    const stillCurrent = (): boolean => useVaultStore.getState().vault?.root === root
    try {
      const app = await a.settings.getApp()
      // The assistant a chat adopts when it remembers none of its own — see
      // `withInheritedProvider`. Read before anything merges the built-in
      // default over the top of it.
      inheritedProvider = app.ok ? app.data?.engine?.provider : undefined
      if (app.ok && app.data?.chatDefaults) {
        const adopted = withInheritedProvider(app.data.chatDefaults, inheritedProvider)
        liveChatDefaults = { ...DEFAULT_CHAT_CONFIG, ...adopted }
        // Written down rather than re-derived each launch: the engine's
        // assistant is about to stop being the chat's, so next time there
        // would be nothing left to inherit from.
        if (adopted !== app.data.chatDefaults) persistChatDefaults(liveChatDefaults)
      } else if (inheritedProvider) {
        liveChatDefaults = { ...DEFAULT_CHAT_CONFIG, provider: inheritedProvider }
        persistChatDefaults(liveChatDefaults)
      }
      if (app.ok && app.data?.defaultView) liveDefaultView = app.data.defaultView
      if (app.ok && app.data?.engine) setLiveEngine(app.data.engine.provider, app.data.engine.model)
    } catch {}
    const r = await a.settings.getVault()
    if (!stillCurrent()) return
    if (!r.ok || !r.data) {
      const fresh = newChatTab()
      const sg = singleGroupLayout([fresh.id], fresh.id)
      set({
        tabs: [fresh],
        activeId: fresh.id,
        layout: sg.layout,
        activeGroupId: sg.activeGroupId,
        defaultView: liveDefaultView,
        bootstrapped: true
      })
      void a.claude.watchProject()
      return
    }
    /**
     * Every launch starts with one empty chat, whatever was open last time.
     *
     * Restoring the tabs looked like continuity and was not: the transcripts
     * came back, but the assistant behind them did not — a conversation's
     * memory belongs to the assistant's own session, and that session ended
     * with the process. So the window filled with a conversation the
     * assistant could no longer remember a word of, and the first reply after
     * a restart answered as if the screen were blank. Better to be blank.
     *
     * The vault, its tabs on disk, and every past conversation are untouched;
     * this only decides what is on screen at launch.
     */
    const persisted = RESTORE_TABS_ON_LAUNCH ? (r.data.tabs ?? r.data.claudeTabs) : undefined
    let tabs: AgentTab[]
    let activeId: string
    if (persisted && persisted.tabs.length > 0) {
      tabs = persisted.tabs
        .filter((t) => t.id !== MINDEX_TAB_ID)
        .map((t) => {
          const out: AgentTab = { id: t.id, ordinal: 0 }
          if (t.customTitle) out.customTitle = t.customTitle
          if (t.provider) out.provider = t.provider
          if (t.model) out.model = t.model
          if (t.mode === 'chat') {
            out.mode = 'chat'
            out.chat = {
              ...DEFAULT_CHAT_CONFIG,
              ...withInheritedProvider(t.chat ?? {}, inheritedProvider)
            }
          }
          return out
        })
      if (!tabs.some(isChatTab)) tabs = [newChatTab(), ...tabs]
      activeId = tabs.some((t) => t.id === persisted.activeId)
        ? persisted.activeId
        : (tabs.find(isChatTab) ?? tabs[0]!).id
    } else {
      const fresh = newChatTab()
      tabs = [fresh]
      activeId = fresh.id
    }
    void a.claude.watchProject()
    const titled = await Promise.all(
      tabs.map(async (t) => {
        const res = await a.claude.getSessionTitle(t.id)
        return res.ok && res.data ? { ...t, title: res.data } : t
      })
    )
    const withOrdinals: AgentTab[] = []
    for (const t of titled) {
      if (t.customTitle || t.title) {
        withOrdinals.push({ ...t, ordinal: 0 })
      } else {
        const base = isChatTab(t) ? CHAT_BASE : CLI_BASE
        const ordinal = pickFreeOrdinal(withOrdinals.map(tabLabel), base)
        withOrdinals.push({ ...t, ordinal })
      }
    }
    const visibleIds = withOrdinals.map((t) => t.id)
    const landingId = visibleIds.includes(activeId) ? activeId : visibleIds[0]!
    const sg = singleGroupLayout(visibleIds, landingId)
    if (!stillCurrent()) return
    set({
      tabs: withOrdinals,
      activeId: landingId,
      layout: sg.layout,
      activeGroupId: sg.activeGroupId,
      defaultView: liveDefaultView,
      bootstrapped: true
    })
  },

  reset() {
    if (persistTimer) {
      clearTimeout(persistTimer)
      persistTimer = null
    }
    const fresh = newChatTab()
    const sg = singleGroupLayout([fresh.id], fresh.id)
    set({
      tabs: [fresh],
      activeId: fresh.id,
      layout: sg.layout,
      activeGroupId: sg.activeGroupId,
      bootstrapped: false
    })
  }
}))

/**
 * A chat tab's effective config — including its own assistant.
 *
 * This used to overwrite `provider` with the one chosen in Settings, on every
 * render, for every open tab, which made the stored field dead weight. The
 * reasoning was "what you picked in Settings is what answers, everywhere" —
 * but the setting it followed is the one that runs the vault's background
 * work: generating folder context, re-reading the index on a schedule. That
 * work wants the cheapest assistant that can do it. A conversation wants the
 * best one. Tying them together meant choosing an assistant for either
 * purpose silently reached into the other.
 *
 * The same collision was worked around three times already — a separate model
 * for background context, a separate model for inline rewrites, a separate
 * chat default — each time by splitting off another *model* while leaving the
 * assistant shared. The assistant was the part that had to split.
 *
 * `model` still falls back to the assistant's own default the moment the
 * remembered one does not belong to it, so a name left over from another
 * assistant is never sent as a model it has never heard of.
 */
/**
 * The assistant behind the corner button — the chat it would land on.
 *
 * Not the one chosen in Settings. That used to be the same answer for every
 * conversation; now a conversation keeps its own, and a mark showing the
 * background engine's assistant on a button that opens a chat with a different
 * one is a plain lie about where the press leads.
 *
 * Falls to the first chat tab when the active tab is a terminal, because that
 * is the one the sidebar reveals.
 */
export function useActiveChatProvider(): ProviderId {
  return useTabsStore((s) => {
    const active = s.tabs.find((t) => t.id === s.activeId)
    if (active?.mode === 'chat' && active.chat?.provider) return active.chat.provider
    const firstChat = s.tabs.find((t) => t.mode === 'chat' && t.chat?.provider)
    return firstChat?.chat?.provider ?? liveChatDefaults.provider ?? 'claude'
  })
}

export function useChatConfig(sessionId: string): ChatTabConfig {
  const chat = useTabsStore((s) => s.tabs.find((t) => t.id === sessionId)?.chat)
  const items = useProvidersStore((s) => s.items)
  const merged = { ...DEFAULT_CHAT_CONFIG, ...(chat ?? {}) }
  const provider = merged.provider ?? DEFAULT_CHAT_CONFIG.provider
  const advertised = useAgentOptionsStore((s) => (provider ? s.byProvider[provider] : undefined))
  const info = items.find((p) => p.id === provider)

  /**
   * Whether this model is one this assistant answers to.
   *
   * The guard is against a model left over from one assistant being sent to
   * another, which it has no name for. So the question is whether *this*
   * assistant knows it, and both lists count: the one compiled into Mindex,
   * whose entries are aliases the CLI resolves for itself, and the one the
   * assistant advertised, whose entries are the concrete builds behind them.
   * The same model appears in the two under different names — "fable" against
   * "claude-fable-5-1[1m]" — and either is a real thing to send.
   *
   * Checking only the compiled list, as this did, rejected every model an
   * assistant advertises that Mindex has no alias for. Picking one of those
   * silently put the conversation back on the assistant's default instead, so
   * the choice could not be made at all. A model from another assistant is in
   * neither list and is still caught.
   */
  const offered = advertised?.find((o) => o.category === 'model')?.values ?? []
  const modelBelongs = info
    ? info.models.some((m) => m.value === merged.model) ||
      offered.some((v) => v.value === merged.model)
    : true

  return {
    ...merged,
    provider,
    model: modelBelongs ? merged.model : (info?.defaultModel ?? merged.model)
  }
}
