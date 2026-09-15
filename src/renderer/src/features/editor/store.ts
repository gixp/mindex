import { create } from 'zustand'
import type { NoteMeta } from '@shared/types'
import { api } from '@/platform/api'
import { showError } from '@/platform/notifications'
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
import { folderViewPath, isVirtualPath, setDocumentHost } from '@/platform/documents'

// Sessions saved before the vault-root folder view replaced the old blank
// "new tab" placeholder may still have `mindex://new/…` paths sitting in
// persisted tab state. They're never produced anymore, so bootstrap just
// drops them rather than resurrecting a tab type that no longer renders.
const STALE_NEW_TAB_PREFIX = 'mindex://new/'

export interface DocState {
  meta: NoteMeta | null
  body: string
  dirty: boolean
  loading: boolean
  error: string | null
  reloadNonce: number
  /**
   * The file changed on disk while this tab had unsaved edits, so the save
   * was refused instead of overwriting it. Autosave stays paused — and the
   * body stays dirty — until the user picks a side.
   */
  conflict: boolean
}

const EMPTY_DOC: DocState = {
  meta: null,
  body: '',
  dirty: false,
  loading: false,
  error: null,
  reloadNonce: 0,
  conflict: false
}

interface EditorState {
  activePath: string | null
  /** The active tab's own stable id — see the note above `tabPaths`. */
  activeTabId: string | null
  /**
   * A tab's identity and the path it currently shows are two different
   * things: `open()` always replaces the active tab's path in place rather
   * than opening a new one, so a tab's id has to survive that swap for
   * per-tab state (right now, its own back/forward history) to stay bound to
   * the right tab rather than resetting every time its content changes.
   * `layout`'s tabIds are these opaque ids; this is where each one's current
   * path lives.
   */
  tabPaths: Record<string, string>
  openPaths: string[]
  layout: LayoutNode
  activeGroupId: string
  docs: Record<string, DocState>
  recentPaths: string[]

  open(path: string): Promise<void>
  openRoot(groupId?: string): void
  /** Sets the active tab's path directly, bypassing open()'s "focus it if
   *  already open elsewhere" — for back/forward, where retracing history
   *  must stay in the tab you're retracing it in. */
  replaceActiveTabPath(path: string): Promise<void>
  setActiveTab(tabId: string): void
  setActiveGroup(groupId: string): void
  dropTabOnGroup(tabId: string, targetGroupId: string, edge: DropEdge): void
  /** Closes one tab by its own id. Other tabs showing the same file stay open. */
  closeTab(tabId: string): Promise<void>
  discardTab(path: string): void
  renameTab(path: string, newName: string): Promise<void>
  reorderTabs(fromTabId: string, toTabId: string): void
  setBody(path: string, body: string): void
  save(path: string): Promise<void>
  /** Resolve a write conflict by overwriting whatever is on disk. */
  resolveConflictOverwrite(path: string): Promise<void>
  /** Resolve a write conflict by discarding this tab's edits. */
  resolveConflictReload(path: string): Promise<void>
  onExternalChange(path: string): void
  setRecentPaths(paths: string[]): void
  bootstrap(): Promise<void>
  close(): void
}

const RECENT_CAP = 30

export function docOf(s: EditorState, path: string | null): DocState {
  if (!path) return EMPTY_DOC
  return s.docs[path] ?? EMPTY_DOC
}

/**
 * Whether a doc still needs its content fetched from disk.
 *
 * NOT `!s.docs[path]` — a restored tab's `bootstrap()` placeholder, and a
 * doc whose last read failed, both already have a real (truthy) entry in
 * `docs`, just with `meta: null`. Keying "needs load" on key-presence instead
 * of `meta` meant every tab except the one active at last shutdown loaded
 * once, on focus, and then never again — a blank editor and blank preview
 * that looked exactly like an empty file, since `loading` was `false` too.
 * `meta` is only ever set inside `loadPath`'s success branch, so its absence
 * means "never successfully loaded", covering both cases in one check.
 *
 * `dirty` excludes a doc that has unsaved local edits: `setBody` doesn't
 * check `meta` either, so it's possible to type into a still-unloaded
 * placeholder tab. Reloading a dirty doc here would silently overwrite that
 * typing with whatever is on disk — the same danger `resolveConflictReload`
 * exists to avoid deliberately elsewhere in this file, not by accident here.
 */
function needsLoad(doc: DocState | undefined): boolean {
  return !doc?.meta && !doc?.dirty
}

const saveTimers: Record<string, ReturnType<typeof setTimeout>> = {}

const lastWriteAt: Record<string, number> = {}
const SELF_WRITE_IGNORE_MS = 1500

/**
 * The last reason a write to each path failed, so it is reported once.
 *
 * A save that fails for any reason other than a conflict used to be dropped on
 * the floor: the note stayed dirty, nothing reached the disk, and nothing on
 * screen said so. With autosave silent and no unsaved marker anywhere, that is
 * an hour of typing into a file nobody is writing.
 *
 * Reported through the dialog rather than a toast — a note that cannot be
 * saved is not a passing notice — and remembered per path, because autosave
 * retries on every keystroke and a failing disk would otherwise stack one
 * dialog per character. A different reason, or a later success, makes the next
 * failure worth saying again.
 */
const lastSaveError: Record<string, string> = {}

function reportSaveFailure(path: string, error: string | undefined): void {
  const reason = error ?? 'Unknown error'
  if (lastSaveError[path] === reason) return
  lastSaveError[path] = reason
  showError(
    'This note could not be saved',
    `${basenameOf(path)} is still open with your changes, but writing it to disk failed: ${reason}`
  )
}

function basenameOf(p: string): string {
  return p.split('/').pop() ?? p
}

/**
 * Guards `loadPath` against a slower, earlier call for the same path landing
 * after a faster, later one — e.g. a file-watcher `onExternalChange` racing a
 * manual reload. Bumped at the start of every `loadPath` call for a path;
 * the async read's result is only committed if it's still the latest one
 * requested. Same shape as the monotonic-counter pattern already used in
 * `PublishToGitHubDialog.tsx` for the same reason, kept as a plain
 * path-keyed record here (like `saveTimers`/`lastWriteAt` above) since this
 * is a module-level function, not a component with a ref.
 */
const loadRequestId: Record<string, number> = {}

function emptyLayout(): { layout: LeafGroup; activeGroupId: string } {
  const leaf = makeLeaf([], '')
  return { layout: leaf, activeGroupId: leaf.id }
}

function genTabId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `tab-${Math.random().toString(36).slice(2)}`
}

/**
 * The bookkeeping shared by every "this tab now shows a different path"
 * transition (a fresh `open()` onto the active tab, or `replaceActiveTabPath`
 * retracing history): point the tab at its new path, drop the old path from
 * `openPaths` unless some other tab still shows it, and drop its doc state
 * along with it for the same reason.
 */
function repointTab(
  s: EditorState,
  tabId: string,
  newPath: string
): Pick<EditorState, 'tabPaths' | 'openPaths' | 'docs'> {
  const oldPath = s.tabPaths[tabId]
  const tabPaths = { ...s.tabPaths, [tabId]: newPath }
  const openPaths = oldPath ? s.openPaths.filter((p) => p !== oldPath) : s.openPaths.slice()
  const docs = { ...s.docs }
  const stillNeeded = oldPath ? Object.values(tabPaths).includes(oldPath) : false
  if (oldPath && !stillNeeded) delete docs[oldPath]
  return { tabPaths, openPaths: [...openPaths, newPath], docs }
}

function setDoc(
  set: (fn: (s: EditorState) => Partial<EditorState>) => void,
  path: string,
  patch: Partial<DocState>
): void {
  set((s) => ({
    docs: { ...s.docs, [path]: { ...(s.docs[path] ?? EMPTY_DOC), ...patch } }
  }))
}

async function loadPath(
  set: (fn: (s: EditorState) => Partial<EditorState>) => void,
  path: string,
  external = false
): Promise<void> {
  // Whichever call for this path is the last one issued "wins" — not
  // whichever IPC round-trip happens to resolve last. Without this, a
  // slower, earlier read (e.g. a file-watcher `onExternalChange` racing a
  // manual reload) could land after a faster, later one and overwrite it
  // with stale content.
  const id = (loadRequestId[path] ?? 0) + 1
  loadRequestId[path] = id
  const stale = (): boolean => loadRequestId[path] !== id

  setDoc(set, path, { loading: true, error: null })
  try {
    const r = await api().notes.read(path)
    if (stale()) return
    if (!r.ok || !r.data) {
      setDoc(set, path, { error: r.error ?? 'read failed', loading: false })
      return
    }
    const data = r.data
    set((s) => {
      const prev = s.docs[path] ?? EMPTY_DOC
      return {
        docs: {
          ...s.docs,
          [path]: {
            ...prev,
            meta: data.meta,
            body: data.body,
            dirty: false,
            loading: false,
            reloadNonce: external ? prev.reloadNonce + 1 : prev.reloadNonce
          }
        }
      }
    })
  } catch (e) {
    if (stale()) return
    setDoc(set, path, {
      error: e instanceof Error ? e.message : 'read failed',
      loading: false
    })
  }
}

let tabsPersistTimer: ReturnType<typeof setTimeout> | null = null
function scheduleTabsPersist(get: () => EditorState): void {
  if (tabsPersistTimer) clearTimeout(tabsPersistTimer)
  tabsPersistTimer = setTimeout(() => {
    tabsPersistTimer = null
    const s = get()
    const openPaths = s.openPaths.filter((p) => !isVirtualPath(p))
    const activePath = s.activePath && !isVirtualPath(s.activePath) ? s.activePath : null
    void api().settings.setVault({ editorTabs: { openPaths, activePath } })
  }, 250)
}

let recentsPersistTimer: ReturnType<typeof setTimeout> | null = null

function bumpRecent(
  get: () => EditorState,
  set: (partial: Partial<EditorState>) => void,
  path: string
): void {
  if (!path || isVirtualPath(path)) return
  const cur = get().recentPaths
  const next = [path, ...cur.filter((p) => p !== path)].slice(0, RECENT_CAP)
  if (next.length === cur.length && next.every((p, i) => p === cur[i])) return
  set({ recentPaths: next })
  if (recentsPersistTimer) clearTimeout(recentsPersistTimer)
  recentsPersistTimer = setTimeout(() => {
    void api().settings.setVault({ recentFiles: get().recentPaths })
  }, 400)
}

const initialLayout = emptyLayout()

export const useEditorStore = create<EditorState>((set, get) => ({
  activePath: null,
  activeTabId: null,
  tabPaths: {},
  openPaths: [],
  layout: initialLayout.layout,
  activeGroupId: initialLayout.activeGroupId,
  docs: {},
  recentPaths: [],

  // The one way anything — a file, a wikilink target, a home screen, a
  // freshly created skill or type — lands on screen: it replaces whatever
  // the active tab is showing, rather than piling up a new one. Already open
  // somewhere just focuses that tab instead of duplicating it. The tab bar's
  // "+" (openRoot) is the sole deliberate way to get a genuinely new tab.
  async open(path: string) {
    const s = get()
    if (s.activePath === path) return
    const existingId = Object.keys(s.tabPaths).find((id) => s.tabPaths[id] === path)
    if (existingId) {
      const grp = findLeafByTab(s.layout, existingId)
      if (grp) {
        set({
          layout: setActiveInTree(s.layout, grp.id, existingId),
          activePath: path,
          activeTabId: existingId,
          activeGroupId: grp.id
        })
      }
      if (!isVirtualPath(path) && needsLoad(s.docs[path])) await loadPath(set, path)
      bumpRecent(get, set, path)
      scheduleTabsPersist(get)
      return
    }
    const grp = findGroup(s.layout, s.activeGroupId) ?? firstLeaf(s.layout)
    const oldTabId = grp.activeId || null
    const oldPath = oldTabId ? get().tabPaths[oldTabId] : undefined
    if (oldPath && saveTimers[oldPath]) {
      clearTimeout(saveTimers[oldPath])
      delete saveTimers[oldPath]
      if (get().docs[oldPath]?.dirty) await get().save(oldPath)
    }
    if (oldTabId) {
      // Same tab, new path — its own id (and the history bound to it)
      // carries over untouched.
      set({ ...repointTab(get(), oldTabId, path), activePath: path, activeTabId: oldTabId })
    } else {
      const tabId = genTabId()
      set({
        layout: insertTabInTree(get().layout, grp.id, tabId),
        tabPaths: { ...get().tabPaths, [tabId]: path },
        openPaths: [...get().openPaths, path],
        activePath: path,
        activeTabId: tabId,
        activeGroupId: grp.id
      })
    }
    if (!isVirtualPath(path)) await loadPath(set, path)
    bumpRecent(get, set, path)
    scheduleTabsPersist(get)
  },

  // The tab bar's "+" opens the vault's root folder view rather than a blank
  // placeholder — but it is the one deliberate "give me a new tab" action in
  // the app, so unlike open() it never dedupes: it always makes a fresh tab,
  // even with the root view already open elsewhere. (The vault-open/empty
  // -pane fallbacks that also land here don't have that redundancy problem,
  // since they only ever fire with no tabs open yet.)
  openRoot(groupId) {
    const s = get()
    const rootPath = folderViewPath('')
    const target =
      (groupId && findGroup(s.layout, groupId)?.id) ??
      findGroup(s.layout, s.activeGroupId)?.id ??
      firstLeaf(s.layout).id
    const tabId = genTabId()
    set({
      tabPaths: { ...s.tabPaths, [tabId]: rootPath },
      openPaths: [...s.openPaths, rootPath],
      layout: insertTabInTree(s.layout, target, tabId),
      activePath: rootPath,
      activeTabId: tabId,
      activeGroupId: target
    })
    scheduleTabsPersist(get)
  },

  async replaceActiveTabPath(path: string) {
    const tabId = get().activeTabId
    if (!tabId) return
    const oldPath = get().tabPaths[tabId]
    if (oldPath === path) return
    if (oldPath && saveTimers[oldPath]) {
      clearTimeout(saveTimers[oldPath])
      delete saveTimers[oldPath]
      if (get().docs[oldPath]?.dirty) await get().save(oldPath)
    }
    set({ ...repointTab(get(), tabId, path), activePath: path })
    if (!isVirtualPath(path)) await loadPath(set, path)
    bumpRecent(get, set, path)
    scheduleTabsPersist(get)
  },

  setActiveTab(tabId: string) {
    const s = get()
    const grp = findLeafByTab(s.layout, tabId)
    if (!grp) return
    const path = s.tabPaths[tabId] ?? null
    set({
      layout: setActiveInTree(s.layout, grp.id, tabId),
      activePath: path,
      activeTabId: tabId,
      activeGroupId: grp.id
    })
    if (path && !isVirtualPath(path) && needsLoad(s.docs[path])) void loadPath(set, path)
    scheduleTabsPersist(get)
  },

  setActiveGroup(groupId) {
    set((s) => {
      const grp = findGroup(s.layout, groupId)
      if (!grp || s.activeGroupId === groupId) return s
      const tabId = grp.activeId || null
      return {
        activeGroupId: groupId,
        activeTabId: tabId || s.activeTabId,
        activePath: (tabId ? s.tabPaths[tabId] : undefined) ?? s.activePath
      }
    })
  },

  dropTabOnGroup(tabId, targetGroupId, edge) {
    set((s) => {
      const { tree, groupId } = dropTabInTree(s.layout, tabId, targetGroupId, edge)
      if (tree === s.layout) return s
      return {
        layout: tree,
        activeGroupId: groupId,
        activeTabId: tabId,
        activePath: s.tabPaths[tabId] ?? s.activePath
      }
    })
    scheduleTabsPersist(get)
  },

  async closeTab(tabId: string) {
    const path = get().tabPaths[tabId]
    if (path === undefined) return
    // Closes exactly this tab, not every tab showing the file. Two tabs can
    // legitimately converge on one path — a split view of the same note, or
    // back/forward walking two tabs onto it — and closing one of those used
    // to take the other with it. `discardTab` is the opposite case and still
    // closes them all: there the file itself is gone.
    const views = Object.values(get().tabPaths).filter((p) => p === path).length
    // The pending autosave belongs to the file, not the tab, so it is only
    // flushed and dropped when the last view of it goes. Cancelling it while
    // another tab is still editing would discard that tab's unsaved keystrokes.
    if (views === 1 && saveTimers[path]) {
      clearTimeout(saveTimers[path])
      delete saveTimers[path]
      if (get().docs[path]?.dirty) await get().save(path)
    }
    finishClose(set, get, tabId)
    scheduleTabsPersist(get)
  },

  discardTab(path: string) {
    if (saveTimers[path]) {
      clearTimeout(saveTimers[path])
      delete saveTimers[path]
    }
    for (const id of Object.keys(get().tabPaths).filter((id) => get().tabPaths[id] === path)) {
      finishClose(set, get, id)
    }
    scheduleTabsPersist(get)
  },

  async renameTab(path: string, newName: string) {
    if (isVirtualPath(path)) return
    if (saveTimers[path]) {
      clearTimeout(saveTimers[path])
      delete saveTimers[path]
      if (get().docs[path]?.dirty) await get().save(path)
    }
    const r = await api().notes.rename(path, newName)
    if (!r.ok || !r.data) return
    const newPath = r.data.path
    if (newPath === path) return
    const s = get()
    const docs = { ...s.docs }
    docs[newPath] = { ...(docs[path] ?? EMPTY_DOC), meta: r.data }
    delete docs[path]
    // A rename only ever changes what path a tab points at, never which tab
    // it is — unlike open()'s replace, there's no `layout` to touch here.
    const tabPaths = { ...s.tabPaths }
    for (const id of Object.keys(tabPaths)) {
      if (tabPaths[id] === path) tabPaths[id] = newPath
    }
    set({
      tabPaths,
      openPaths: s.openPaths.map((p) => (p === path ? newPath : p)),
      docs,
      activePath: s.activePath === path ? newPath : s.activePath
    })
    scheduleTabsPersist(get)
  },

  reorderTabs(fromTabId, toTabId) {
    set((s) => {
      const grp = findLeafByTab(s.layout, fromTabId)
      if (!grp || !grp.tabIds.includes(toTabId) || fromTabId === toTabId) return s
      return { layout: reorderInGroup(s.layout, grp.id, fromTabId, toTabId) }
    })
    scheduleTabsPersist(get)
  },

  setBody(path: string, body: string) {
    setDoc(set, path, { body, dirty: true })
    if (saveTimers[path]) clearTimeout(saveTimers[path])
    saveTimers[path] = setTimeout(() => {
      void get().save(path)
    }, 800)
  },

  async save(path: string) {
    const doc = get().docs[path]
    if (!path || isVirtualPath(path) || !doc || !doc.meta) return
    // An unresolved conflict would just be re-detected on every keystroke.
    // Wait for the user's answer instead of retrying in a loop.
    if (doc.conflict) return
    lastWriteAt[path] = Date.now()
    // Passing the mtime we last saw turns a silent overwrite of someone
    // else's edit into a refusal we can ask the user about.
    const r = await api().notes.write(path, doc.body, doc.meta.frontmatter, doc.meta.mtime)
    if (r.ok && r.data) {
      lastWriteAt[path] = Date.now()
      delete lastSaveError[path]
      setDoc(set, path, { meta: r.data, dirty: false })
      return
    }
    if (r.code === 'WRITE_CONFLICT') {
      // Deliberately keep `dirty` and the in-memory body: neither side of the
      // collision gets thrown away before the user has seen it.
      setDoc(set, path, { conflict: true })
      return
    }
    reportSaveFailure(path, r.error)
  },

  async resolveConflictOverwrite(path: string) {
    const doc = get().docs[path]
    if (!doc || !doc.meta) return
    setDoc(set, path, { conflict: false })
    lastWriteAt[path] = Date.now()
    // No `expectedMtime` — that is what "overwrite" means here.
    const r = await api().notes.write(path, doc.body, doc.meta.frontmatter)
    if (r.ok && r.data) {
      lastWriteAt[path] = Date.now()
      delete lastSaveError[path]
      setDoc(set, path, { meta: r.data, dirty: false })
      return
    }
    reportSaveFailure(path, r.error)
  },

  async resolveConflictReload(path: string) {
    setDoc(set, path, { conflict: false, dirty: false })
    await loadPath(set, path, true)
  },

  onExternalChange(path: string) {
    const s = get()
    if (!s.openPaths.includes(path) || isVirtualPath(path)) return
    const wrote = lastWriteAt[path]
    if (wrote && Date.now() - wrote < SELF_WRITE_IGNORE_MS) return
    const doc = s.docs[path]
    if (doc?.dirty) return
    void loadPath(set, path, true)
  },

  setRecentPaths(paths: string[]) {
    set({ recentPaths: paths.slice(0, RECENT_CAP) })
  },

  async bootstrap() {
    const root = useVaultStore.getState().vault?.root
    const r = await api().settings.getVault()
    if (useVaultStore.getState().vault?.root !== root) return
    const paths = (r.ok && r.data?.editorTabs?.openPaths ? r.data.editorTabs.openPaths : []).filter(
      (p) => !p.startsWith(STALE_NEW_TAB_PREFIX)
    )
    if (paths.length === 0) return // nothing persisted — App opens the root folder view
    const persistedActive = r.ok ? (r.data?.editorTabs?.activePath ?? null) : null
    const activeIndex = persistedActive ? paths.indexOf(persistedActive) : -1
    // Fresh ids every launch — history doesn't persist across restarts
    // either, so there's nothing that needs these to be stable.
    const tabIds = paths.map(() => genTabId())
    const activeTabId = activeIndex >= 0 ? tabIds[activeIndex]! : tabIds[0]!
    const activePath = activeIndex >= 0 ? persistedActive! : paths[0]!
    const tabPaths: Record<string, string> = {}
    const docs: Record<string, DocState> = {}
    paths.forEach((p, i) => {
      tabPaths[tabIds[i]!] = p
      docs[p] = { ...EMPTY_DOC }
    })
    const leaf = makeLeaf(tabIds, activeTabId)
    set({
      openPaths: paths,
      tabPaths,
      layout: leaf,
      activeGroupId: leaf.id,
      activeTabId,
      activePath,
      docs
    })
    void loadPath(set, activePath)
  },

  close() {
    if (recentsPersistTimer) {
      clearTimeout(recentsPersistTimer)
      recentsPersistTimer = null
    }
    if (tabsPersistTimer) {
      clearTimeout(tabsPersistTimer)
      tabsPersistTimer = null
    }
    for (const k of Object.keys(saveTimers)) {
      clearTimeout(saveTimers[k]!)
      delete saveTimers[k]
    }
    const empty = emptyLayout()
    set({
      activePath: null,
      activeTabId: null,
      tabPaths: {},
      openPaths: [],
      layout: empty.layout,
      activeGroupId: empty.activeGroupId,
      docs: {},
      recentPaths: []
    })
  }
}))

function finishClose(
  set: (partial: Partial<EditorState>) => void,
  get: () => EditorState,
  tabId: string
): void {
  const s = get()
  const path = s.tabPaths[tabId]
  if (path === undefined) return
  const tabPaths = { ...s.tabPaths }
  delete tabPaths[tabId]
  // Another tab can legitimately still be showing this same path (see
  // closeTab/discardTab) — only drop it from openPaths/docs once nothing
  // points at it any more.
  const stillNeeded = Object.values(tabPaths).includes(path)
  const openPaths = stillNeeded ? s.openPaths : s.openPaths.filter((p) => p !== path)
  const docs = { ...s.docs }
  if (!stillNeeded) delete docs[path]
  const layout = removeTabFromTree(s.layout, tabId)
  if (!layout) {
    // Closing the last tab in the pane always falls back to the vault root
    // folder view instead of leaving it empty.
    const rootPath = folderViewPath('')
    const newTabId = genTabId()
    const leaf = makeLeaf([newTabId], newTabId)
    set({
      tabPaths: { ...tabPaths, [newTabId]: rootPath },
      openPaths: [...openPaths.filter((p) => p !== rootPath), rootPath],
      docs,
      layout: leaf,
      activeGroupId: leaf.id,
      activeTabId: newTabId,
      activePath: rootPath
    })
    return
  }
  let activeTabId = s.activeTabId
  let activePath = s.activePath
  let activeGroupId = s.activeGroupId
  const activeGrp = findGroup(layout, activeGroupId)
  if (!activeGrp) {
    const fl = firstLeaf(layout)
    activeGroupId = fl.id
    activeTabId = fl.activeId || null
    activePath = activeTabId ? (tabPaths[activeTabId] ?? null) : null
  } else if (tabId === s.activeTabId) {
    activeTabId = activeGrp.activeId || null
    activePath = activeTabId ? (tabPaths[activeTabId] ?? null) : null
  }
  set({ tabPaths, openPaths, docs, layout, activePath, activeTabId, activeGroupId })
}

/**
 * Tell the rest of the app how to open a document.
 *
 * Called once at startup. The editor owns opening — the tab rules, the
 * replace-rather-than-pile-up behaviour, the focus-what-is-already-open
 * shortcut — and everything else asks for it through `openDocument`, which
 * means nothing outside this feature has to import this store to put
 * something on screen.
 */
export function registerEditorAsDocumentHost(): void {
  setDocumentHost({
    open: (path) => useEditorStore.getState().open(path),
    activePath: () => useEditorStore.getState().activePath,
    subscribe: (listener) => useEditorStore.subscribe(listener)
  })
}
