import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useVaultStore } from '@/platform/workspace'
import { useEditorStore } from '@/features/editor/store'
import {
  SKILLS_HOME_PATH,
  TYPES_HOME_PATH,
  folderViewPath,
  openDocument,
  useActiveDocumentPath
} from '@/platform/documents'
import { useUiStore } from '@/platform/app-settings'
import { openIconPicker } from '@/platform/icon-picker'
import { useTreeSortStore } from '@/features/tree/store-treeSort'
import { useHiddenFilesStore } from '@/features/tree/store-hiddenFiles'
import { useHoverStore } from '@/features/tree/store-hover'
import { computeEffectiveHidden } from '@/platform/presentation/hiddenFiles'
import { cn } from '@/ui/cn'
import { useSlidingIndicator } from '@/ui/sliding-indicator'
import { Icon } from '@/ui/icon'
import { ChromeButton } from '@/ui/chrome-button'
import type { SelectOption } from '@/ui/select'
import { ConfirmDialog } from '@/ui/ConfirmDialog'
import { EmptyState } from '@/ui/EmptyState'
import { api } from '@/platform/api'
import { useContentMatches } from '@/platform/search'
import { pushToast, showError } from '@/platform/notifications'
import { requestTreeInlineRename } from '@/platform/presentation/tree-events'
import { FolderStatusDot } from './FolderStatusDot'
import { useHasProvider } from '@/platform/engines'
import { SkillsPane } from './SkillsPane'
import { TypesPane } from './TypesPane'
import { GitStatusBadge } from './GitStatusBadge'
import { ProviderGlyph } from '@/ui/provider-glyph'
import { folderLookFrom, noteLookFrom } from '@/platform/presentation'
import {
  treeDisplayName,
  managedFileIcon,
  managedFileIconColor,
  defaultFileIcon
} from '@/platform/presentation/tree-display'
import {
  type TreeNode,
  type TreeSort,
  type TreeGroup,
  buildTree
} from '@/platform/presentation/tree'
import {
  type FileDisplaySettings,
  useFileDisplaySettings,
  formatFileDate
} from '@/platform/presentation/useFileDisplaySettings'

const SORT_OPTIONS: SelectOption<TreeSort>[] = [
  { value: 'name-asc', label: 'Name A→Z' },
  { value: 'name-desc', label: 'Name Z→A' },
  { value: 'mtime-desc', label: 'Recently modified' },
  { value: 'mtime-asc', label: 'Oldest modified' }
]

const EMPTY_COLLAPSED = new Set<string>()

const GROUP_OPTIONS: SelectOption<TreeGroup>[] = [
  { value: 'folders-first', label: 'Folders first' },
  { value: 'files-first', label: 'Files first' }
]

/**
 * The three screens the left sidebar can show.
 *
 * No icon. There were three, and a mark only earns its place when it says
 * something the word does not — for "Explorer", "Skills" and "Types" it says
 * the same thing less clearly, and a picture of a robot for Skills was a guess
 * anybody would have to learn. The words are short enough to sit side by side,
 * so all three read at once instead of two being marks and one being a label.
 */
const SIDEBAR_TABS = [
  ['explorer', 'Explorer'],
  ['skills', 'Skills'],
  ['types', 'Types']
] as const

export function TreePane(): JSX.Element {
  const notes = useVaultStore((s) => s.notes)
  const dirs = useVaultStore((s) => s.dirs)
  const iconOverrides = useUiStore((s) => s.iconOverrides)
  const setIconOverride = useUiStore((s) => s.setIconOverride)
  const iconColorOverrides = useUiStore((s) => s.iconColorOverrides)
  const activePath = useActiveDocumentPath()
  // Opening from the tree adds a tab rather than taking over the current
  // one — see the note in SkillsPane.
  const openFile = openDocument
  const open = (path: string): void => {
    void openFile(path)
  }
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const sortBy = useTreeSortStore((s) => s.sortBy)
  const group = useTreeSortStore((s) => s.group)
  // Shared with the graph and the centre-pane grid — see `useFileDisplaySettings`.
  const rowDetails = useFileDisplaySettings()
  const [search, setSearch] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const sidebarTab = useUiStore((s) => s.sidebarTab)
  const { refFor: tabRef, indicator: tabIndicator } = useSlidingIndicator(
    sidebarTab,
    SIDEBAR_TABS.length
  )
  const setSidebarTab = useUiStore((s) => s.setSidebarTab)
  const userHidden = useHiddenFilesStore((s) => s.userHidden)
  const userUnhidden = useHiddenFilesStore((s) => s.userUnhidden)
  const [aiSyncExcluded, setAiSyncExcluded] = useState<string[]>([])
  const [confirmDisableSync, setConfirmDisableSync] = useState<{
    folderRel: string
    folderName: string
  } | null>(null)
  const revealedAll = useHiddenFilesStore((s) => s.revealedAll)
  const setRevealedAll = useHiddenFilesStore((s) => s.setRevealedAll)
  const [groupMenu, setGroupMenu] = useState<{
    x: number
    y: number
    basename: string
  } | null>(null)
  const vaultRoot = useVaultStore((s) => s.vault?.root)

  useEffect(() => {
    if (!vaultRoot) {
      setCollapsed(new Set())
      useTreeSortStore.getState().reset()
      useHiddenFilesStore.getState().reset()
      setAiSyncExcluded([])
      return
    }
    void (async () => {
      const r = await api().settings.getVault()
      if (r.ok && r.data) {
        setCollapsed(new Set(r.data.treeCollapsedFolders ?? []))
        useTreeSortStore.setState({
          sortBy: r.data.treeSort ?? 'name-asc',
          group: r.data.treeGroup ?? 'folders-first'
        })
        useHiddenFilesStore
          .getState()
          .setAll(new Set(r.data.treeHiddenPaths ?? []), new Set(r.data.treeUnhiddenPaths ?? []))
        setAiSyncExcluded(r.data.folderContext?.excludedPaths ?? [])
      } else {
        setCollapsed(new Set())
        useTreeSortStore.getState().reset()
        useHiddenFilesStore.getState().reset()
        setAiSyncExcluded([])
      }
      setRevealedAll(false)
    })()
  }, [vaultRoot])

  function persistCollapsed(next: Set<string>): void {
    if (!vaultRoot) return
    void api().settings.setVault({ treeCollapsedFolders: [...next] })
  }

  function changeSort(next: TreeSort): void {
    useTreeSortStore.getState().setSortBy(next)
  }

  function changeGroup(next: TreeGroup): void {
    useTreeSortStore.getState().setGroup(next)
  }

  function isAiSyncDisabled(folderRel: string): boolean {
    if (!folderRel) return false
    const target = folderRel.replace(/\/+$/, '')
    for (const raw of aiSyncExcluded) {
      const entry = raw.replace(/\/+$/, '')
      if (!entry) continue
      if (target === entry) return true
      if (target.startsWith(`${entry}/`)) return true
    }
    return false
  }

  async function refreshAiSyncExclusions(): Promise<void> {
    const r = await api().settings.getVault()
    if (r.ok && r.data) {
      setAiSyncExcluded(r.data.folderContext?.excludedPaths ?? [])
    }
  }

  /**
   * A first note, from an empty tree.
   *
   * The empty state used to say "create a note from the command palette",
   * which names a thing it does not show you how to open and offers no button
   * of its own — on the screen where somebody has just arrived and has nothing
   * to right-click.
   */
  async function createNote(): Promise<void> {
    const r = await api().notes.create({ type: 'untyped', title: 'Untitled' })
    if (r.ok && r.data) {
      await openDocument(r.data.path)
      requestTreeInlineRename(r.data)
    } else {
      pushToast(`That note could not be created. ${r.error ?? ''}`.trim())
    }
  }

  async function performDisableAiSync(folderRel: string): Promise<void> {
    const r = await api().folderContext.disableAiSync(folderRel)
    if (!r.ok) {
      // Said out loud rather than logged. The row's switch does not move when
      // this fails, so silence looks exactly like a control that is broken.
      pushToast(`Could not stop the assistant reading "${folderRel}". ${r.error ?? ''}`.trim())
      return
    }
    await refreshAiSyncExclusions()
  }

  async function performEnableAiSync(folderRel: string): Promise<void> {
    const r = await api().folderContext.enableAiSync(folderRel)
    if (!r.ok) {
      pushToast(`Could not let the assistant read "${folderRel}". ${r.error ?? ''}`.trim())
      return
    }
    await refreshAiSyncExclusions()
  }

  const effectiveHidden = useMemo(
    () => computeEffectiveHidden(notes, userHidden, userUnhidden),
    [notes, userHidden, userUnhidden]
  )

  function toggleRevealAll(): void {
    setRevealedAll(!revealedAll)
  }

  const dirRelPaths = useMemo(() => {
    const root = useVaultStore.getState().vault?.root
    if (!root) return []
    const prefix = `${root}/`
    return dirs.filter((d) => d.startsWith(prefix)).map((d) => d.slice(prefix.length))
  }, [dirs])
  const searchQuery = search.trim().toLowerCase()
  const searchActive = searchQuery.length > 0
  // The text of a note counts too, not only its name. The index has always
  // covered note bodies; this filter could only see filenames, so a search for
  // a phrase you had written found nothing.
  const contentMatches = useContentMatches(search)
  const filteredNotes = useMemo(() => {
    if (!searchActive) return notes
    return notes.filter(
      (n) =>
        n.title.toLowerCase().includes(searchQuery) ||
        n.relPath.toLowerCase().includes(searchQuery) ||
        contentMatches.set.has(n.path)
    )
  }, [notes, searchActive, searchQuery, contentMatches])
  const tree = useMemo(
    () => buildTree(filteredNotes, sortBy, group, searchActive ? [] : dirRelPaths),
    [filteredNotes, sortBy, group, searchActive, dirRelPaths]
  )
  const allHidden = useMemo(() => collectHidden(tree, effectiveHidden), [tree, effectiveHidden])

  const [menu, setMenu] = useState<TreeContextMenuState | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<{
    path: string
    name: string
    kind: 'note' | 'folder'
  } | null>(null)
  // Inline, row-level rename — used both for the context menu's "Rename" and
  // to drop a freshly created file straight into name-editing, the way
  // Finder/VS Code do. skipNextBlurRef exists because Enter/Escape unmount
  // the input while it's still focused: Enter blurs it deliberately (that's
  // how it commits), but Escape's unmount fires a blur too, and without the
  // guard that blur would re-commit a rename we just asked to cancel.
  const [editing, setEditing] = useState<{ path: string; original: string; value: string } | null>(
    null
  )
  const skipNextBlurRef = useRef(false)

  function commitEdit(): void {
    const t = editing
    setEditing(null)
    if (!t) return
    const v = t.value.trim()
    if (!v || v === t.original) return
    void useEditorStore
      .getState()
      .renameTab(t.path, v)
      .catch((e: unknown) =>
        window.alert(`Rename failed: ${e instanceof Error ? e.message : String(e)}`)
      )
  }

  function cancelEdit(): void {
    skipNextBlurRef.current = true
    setEditing(null)
  }

  function onEditingChange(value: string): void {
    setEditing((prev) => (prev ? { ...prev, value } : prev))
  }

  function onEditingKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.currentTarget.blur()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelEdit()
    }
  }

  function onEditingBlur(): void {
    if (skipNextBlurRef.current) {
      skipNextBlurRef.current = false
      return
    }
    commitEdit()
  }

  useEffect(() => {
    function onStartRename(e: Event): void {
      const detail = (e as CustomEvent<{ path: string; relPath: string; name: string }>).detail
      if (!detail?.path) return
      const parts = detail.relPath.split('/')
      if (parts.length > 1) {
        setCollapsed((prev) => {
          let next = prev
          let acc = ''
          for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i] ?? ''
            acc = acc ? `${acc}/${part}` : part
            if (next.has(acc)) {
              if (next === prev) next = new Set(prev)
              next.delete(acc)
            }
          }
          if (next !== prev) persistCollapsed(next)
          return next
        })
      }
      skipNextBlurRef.current = false
      setEditing({ path: detail.path, original: detail.name, value: detail.name })
    }
    window.addEventListener('mindex:tree-start-rename', onStartRename)
    return () => {
      window.removeEventListener('mindex:tree-start-rename', onStartRename)
    }
  }, [])

  const folderPaths = useMemo(() => {
    const set = new Set<string>()
    for (const n of notes) {
      const parts = n.relPath.split('/')
      for (let i = 1; i < parts.length; i++) {
        set.add(parts.slice(0, i).join('/'))
      }
    }
    return set
  }, [notes])

  const allCollapsed = folderPaths.size > 0 && [...folderPaths].every((p) => collapsed.has(p))

  function toggleAllFolders(): void {
    const next = allCollapsed ? new Set<string>() : new Set(folderPaths)
    setCollapsed(next)
    persistCollapsed(next)
  }

  function toggleFolder(path: string): void {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      persistCollapsed(next)
      return next
    })
  }

  function openPicker(key: string, label: string): void {
    openIconPicker(key, label)
  }

  useEffect(() => {
    function onTabContextMenu(e: Event): void {
      const detail = (e as CustomEvent<{ path: string; x: number; y: number }>).detail
      if (!detail?.path) return
      const notes = useVaultStore.getState().notes
      const meta = notes.find((n) => n.path === detail.path)
      if (!meta) return
      const basename = detail.path.split('/').pop() ?? detail.path
      const root = useVaultStore.getState().vault?.root ?? null
      setMenu({
        x: detail.x,
        y: detail.y,
        node: {
          name: basename,
          type: 'note',
          path: detail.path,
          meta
        },
        vaultRoot: root
      })
    }
    window.addEventListener('mindex:open-file-context-menu', onTabContextMenu)
    return () => {
      window.removeEventListener('mindex:open-file-context-menu', onTabContextMenu)
    }
  }, [])

  // Folder cards/badges in the center-panel folder view raise this to get
  // the exact same context menu a folder row in the tree gets — same event
  // idiom as the file one above, just for the 'folder' node shape.
  useEffect(() => {
    function onFolderContextMenu(e: Event): void {
      const detail = (e as CustomEvent<{ folderRel: string; x: number; y: number }>).detail
      if (detail?.folderRel === undefined) return
      const root = useVaultStore.getState().vault?.root ?? null
      const name = detail.folderRel
        ? (detail.folderRel.split('/').pop() ?? detail.folderRel)
        : root
          ? (root.split('/').pop() ?? '')
          : ''
      setMenu({
        x: detail.x,
        y: detail.y,
        node: {
          name,
          type: 'folder',
          path: detail.folderRel
        },
        vaultRoot: root
      })
    }
    window.addEventListener('mindex:open-folder-context-menu', onFolderContextMenu)
    return () => {
      window.removeEventListener('mindex:open-folder-context-menu', onFolderContextMenu)
    }
  }, [])

  async function onDropNote(noteRel: string, targetFolderRel: string): Promise<void> {
    if (!vaultRoot) return
    const currentFolder = noteRel.includes('/') ? noteRel.slice(0, noteRel.lastIndexOf('/')) : ''
    if (currentFolder === targetFolderRel) return
    const absPath = `${vaultRoot}/${noteRel}`
    await api().notes.move(absPath, targetFolderRel)
  }

  async function onDropFolder(folderRel: string, targetFolderRel: string): Promise<void> {
    if (!vaultRoot) return
    if (folderRel === targetFolderRel) return
    if (targetFolderRel === folderRel || targetFolderRel.startsWith(`${folderRel}/`)) return
    const currentParent = folderRel.includes('/')
      ? folderRel.slice(0, folderRel.lastIndexOf('/'))
      : ''
    if (currentParent === targetFolderRel) return
    const absPath = `${vaultRoot}/${folderRel}`
    await api().notes.moveFolder(absPath, targetFolderRel)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="px-2 pb-0">
        <div className="relative inline-flex items-center gap-1">
          {tabIndicator ? (
            <div
              aria-hidden="true"
              // A plain step up the grey ladder, and no edge on anything.
              // The outlined mark Settings uses names one option out of a set
              // laid out as boxes; this is a row of words in a sidebar, where
              // a box around one of them is the only frame in sight.
              className="absolute inset-y-0 left-0 rounded-r3 bg-bg-3 transition-[transform,width] duration-200 ease-out"
              style={{ transform: `translateX(${tabIndicator.left}px)`, width: tabIndicator.width }}
            />
          ) : null}
          {SIDEBAR_TABS.map(([id, label]) => {
            const active = id === sidebarTab
            return (
              <button
                key={id}
                type="button"
                ref={tabRef(id)}
                // No `aria-label`: the label is on screen, and naming the
                // button twice makes a screen reader say it twice.
                aria-current={active}
                onClick={() => {
                  setSidebarTab(id)
                  // Each tab lands on its own screen, the way Explorer lands
                  // on the vault root. `open` focuses an already-open one
                  // rather than duplicating it, so switching back and forth
                  // does not pile up tabs.
                  if (id === 'skills') void openFile(SKILLS_HOME_PATH)
                  if (id === 'types') void openFile(TYPES_HOME_PATH)
                  if (id === 'explorer') void openFile(folderViewPath(''))
                }}
                // `relative z-pane` keeps the label above the sliding mark;
                // without it the mark paints over the text it sits behind.
                className={cn(
                  // Padding rather than a fixed height, so the fill behind the
                  // chosen one grows with it. It cannot be given to that one
                  // alone: the mark spans the row's full height, and a taller
                  // button would move every other word each time the choice
                  // changed.
                  'relative z-pane inline-flex items-center rounded-r3 px-2.5 py-1.5 text-xs font-medium',
                  'cursor-pointer select-none transition-colors',
                  active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex items-center gap-1.5 p-2">
        <div className="relative min-w-0 flex-1">
          <Icon
            name="search"
            size={12}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground/70"
          />
          <input
            ref={searchInputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                setSearch('')
                searchInputRef.current?.blur()
              }
            }}
            placeholder="Search"
            className="h-7 w-full rounded-[8px] border border-bd-1 bg-transparent pl-6 pr-6 text-[12px] text-foreground transition-colors placeholder:text-muted-foreground/70 focus:border-accent-1/60 focus:outline-none"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch('')}
              title="Clear search"
              aria-label="Clear search"
              className="absolute right-1 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <Icon name="close" size={11} className="codicon-inherit" />
            </button>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <SortGroupMenu
            sort={sortBy}
            onSortChange={changeSort}
            group={group}
            onGroupChange={changeGroup}
          />
          <ChromeButton
            box={28}
            icon={allCollapsed ? 'expand-all' : 'collapse-all'}
            iconSize={14}
            iconClassName="codicon-inherit"
            onClick={toggleAllFolders}
            title={allCollapsed ? 'Expand all folders' : 'Collapse all folders'}
            aria-label={allCollapsed ? 'Expand all folders' : 'Collapse all folders'}
            className="text-c-2 focus:outline-none"
          />
        </div>
      </div>

      {sidebarTab === 'skills' ? (
        <SkillsPane />
      ) : sidebarTab === 'types' ? (
        <TypesPane />
      ) : (
        <div
          // Twice the inset on the left as on the right: the tree's rows carry
          // their own indent per depth, so a symmetric gutter put the top level
          // hard against the window edge while every nested row had room.
          className="tree-scroll flex-1 overflow-auto pl-3 pr-1"
          onContextMenu={(e) => {
            if (e.target !== e.currentTarget) return
            e.preventDefault()
            setMenu({
              x: e.clientX,
              y: e.clientY,
              node: {
                name: vaultRoot ? (vaultRoot.split('/').pop() ?? '') : '',
                type: 'folder',
                path: ''
              },
              vaultRoot: vaultRoot ?? null
            })
          }}
        >
          {searchActive && (tree.children?.length ?? 0) === 0 ? (
            <EmptyState
              icon="search"
              title="No matches."
              hint={`Nothing in this vault matches "${search.trim()}".`}
            />
          ) : (
            <FileTreeView
              node={tree}
              depth={0}
              collapsed={searchActive ? EMPTY_COLLAPSED : collapsed}
              onToggleFolder={toggleFolder}
              activePath={activePath}
              onOpen={open}
              onContext={(e, n) => {
                e.preventDefault()
                setMenu({
                  x: e.clientX,
                  y: e.clientY,
                  node: n,
                  vaultRoot: vaultRoot ?? null
                })
              }}
              onDropNote={onDropNote}
              onDropFolder={onDropFolder}
              iconOverrides={iconOverrides}
              iconColorOverrides={iconColorOverrides}
              onIconDblClick={openPicker}
              hidden={effectiveHidden}
              revealedAll={revealedAll}
              onToggleRevealAll={toggleRevealAll}
              onUnhide={(p) => useHiddenFilesStore.getState().unhide(p)}
              onGroupContext={(e, basename) =>
                setGroupMenu({ x: e.clientX, y: e.clientY, basename })
              }
              onCreateNote={createNote}
              rowDetails={rowDetails}
              editing={editing}
              onEditingChange={onEditingChange}
              onEditingKeyDown={onEditingKeyDown}
              onEditingBlur={onEditingBlur}
            />
          )}
          {/* Below the last real row, in the tree's own scroll flow — not
            pinned to the bottom of the panel, which used to separate it from
            the content it belongs to and give it a second, independent
            scroll region. */}
          {!searchActive && allHidden.length > 0 ? (
            <div className="px-2 pt-2 pb-1">
              <HiddenToggleRow
                depth={0}
                count={allHidden.length}
                open={revealedAll}
                onClick={toggleRevealAll}
              />
              {revealedAll ? (
                <HiddenBasenameGroups
                  items={allHidden}
                  shared={{
                    collapsed,
                    onToggleFolder: toggleFolder,
                    activePath,
                    onOpen: open,
                    onContext: (e, n) => {
                      e.preventDefault()
                      setMenu({
                        x: e.clientX,
                        y: e.clientY,
                        node: n,
                        vaultRoot: vaultRoot ?? null
                      })
                    },
                    onDropNote,
                    onDropFolder,
                    iconOverrides,
                    iconColorOverrides,
                    onIconDblClick: openPicker,
                    hidden: effectiveHidden,
                    revealedAll,
                    onToggleRevealAll: toggleRevealAll,
                    onUnhide: (p: string) => useHiddenFilesStore.getState().unhide(p),
                    onGroupContext: (e, basename) =>
                      setGroupMenu({ x: e.clientX, y: e.clientY, basename }),
                    onCreateNote: createNote,
                    rowDetails,
                    editing,
                    onEditingChange,
                    onEditingKeyDown,
                    onEditingBlur
                  }}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      {menu ? (
        <TreeContextMenu
          state={menu}
          onClose={() => setMenu(null)}
          onAskDelete={(path, name, kind) => {
            setMenu(null)
            setConfirmDelete({ path, name, kind })
          }}
          onRename={(path, name) => {
            setMenu(null)
            skipNextBlurRef.current = false
            setEditing({ path, original: name, value: name })
          }}
          onHide={(p) => {
            useHiddenFilesStore.getState().hide(p)
            setMenu(null)
          }}
          onUnhide={(p) => {
            useHiddenFilesStore.getState().unhide(p)
            setMenu(null)
          }}
          onHideAll={(basename) => {
            useHiddenFilesStore.getState().hideAllByBasename(notes, basename)
            setMenu(null)
          }}
          onUnhideAll={(basename) => {
            useHiddenFilesStore.getState().unhideAllByBasename(notes, basename)
            setMenu(null)
          }}
          isHidden={(p) => effectiveHidden.has(p)}
          onLivingIndexRebuild={() => {
            setMenu(null)
            void api().livingIndex.rebuild()
          }}
          isAiSyncDisabled={isAiSyncDisabled}
          onDisableAiSync={(folderRel, folderName) => {
            setMenu(null)
            setConfirmDisableSync({ folderRel, folderName })
          }}
          onEnableAiSync={(folderRel) => {
            setMenu(null)
            void performEnableAiSync(folderRel)
          }}
          onUpdateContext={(folderRel) => {
            setMenu(null)
            void api().folderContext.rescanFolder(folderRel)
          }}
          iconOverrides={iconOverrides}
          onPickIcon={(key, label) => {
            setMenu(null)
            openPicker(key, label)
          }}
          onClearIcon={(key) => {
            setMenu(null)
            void setIconOverride(key, null)
          }}
        />
      ) : null}
      {groupMenu ? (
        <HiddenGroupMenu
          x={groupMenu.x}
          y={groupMenu.y}
          basename={groupMenu.basename}
          onClose={() => setGroupMenu(null)}
          onShowAll={() => {
            useHiddenFilesStore.getState().unhideAllByBasename(notes, groupMenu.basename)
            setGroupMenu(null)
          }}
        />
      ) : null}
      <ConfirmDialog
        open={confirmDelete !== null}
        title={confirmDelete?.kind === 'folder' ? 'Delete folder?' : 'Delete note?'}
        zIndex={70}
        message={
          confirmDelete ? (
            <p>
              Permanently delete{' '}
              <span className="font-mono text-foreground">{confirmDelete.name}</span>
              {confirmDelete.kind === 'folder' ? ' and everything inside it' : ''}? This can&apos;t
              be undone.
            </p>
          ) : null
        }
        confirmLabel="Delete"
        confirmIcon="trash"
        cancelLabel="Cancel"
        destructive
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) {
            const editor = useEditorStore.getState()
            const target = confirmDelete.path
            const isFolder = confirmDelete.kind === 'folder'
            for (const p of [...editor.openPaths]) {
              if (isFolder) {
                if (p === target || p.startsWith(`${target}/`)) editor.discardTab(p)
              } else if (p === target) {
                editor.discardTab(p)
              }
            }
            const op = isFolder ? api().notes.deleteFolder(target) : api().notes.delete(target)
            void op
              .then((r) => {
                if (!r.ok) {
                  // The app's own window, not the OS alert box this used to
                  // raise — a native dialog over a frameless window reads as a
                  // different program having a problem.
                  showError(
                    isFolder
                      ? 'This folder could not be deleted'
                      : 'This file could not be deleted',
                    `${target.split('/').pop() ?? target} is still there. ${r.error ?? 'Unknown error'}`
                  )
                }
              })
              .finally(() => setConfirmDelete(null))
          }
        }}
      />
      <ConfirmDialog
        open={confirmDisableSync !== null}
        title="Disable AI Sync for this folder?"
        zIndex={70}
        message={
          confirmDisableSync ? (
            <p>
              Mindex will move{' '}
              <span className="font-mono text-foreground">
                {confirmDisableSync.folderName}/AGENTS.md
              </span>{' '}
              to the Trash (if it exists) and exclude this folder from future AI sync. You can
              re-enable it later from the same menu.
            </p>
          ) : null
        }
        confirmLabel="Disable AI Sync"
        confirmIcon="circle-slash"
        cancelLabel="Cancel"
        destructive
        onCancel={() => setConfirmDisableSync(null)}
        onConfirm={() => {
          const pending = confirmDisableSync
          setConfirmDisableSync(null)
          if (pending) void performDisableAiSync(pending.folderRel)
        }}
      />
    </div>
  )
}

interface TreeContextMenuState {
  x: number
  y: number
  node: TreeNode
  vaultRoot: string | null
}

function TreeContextMenu({
  state,
  onClose,
  onAskDelete,
  onRename,
  onHide,
  onUnhide,
  onHideAll,
  onUnhideAll,
  isHidden,
  onLivingIndexRebuild,
  isAiSyncDisabled,
  onDisableAiSync,
  onEnableAiSync,
  onUpdateContext,
  iconOverrides,
  onPickIcon,
  onClearIcon
}: {
  state: TreeContextMenuState
  onClose(): void
  onAskDelete(path: string, name: string, kind: 'note' | 'folder'): void
  onRename(path: string, name: string): void
  onHide(absPath: string): void
  onUnhide(absPath: string): void
  onHideAll(basename: string): void
  onUnhideAll(basename: string): void
  isHidden(absPath: string): boolean
  onLivingIndexRebuild(): void
  isAiSyncDisabled(folderRel: string): boolean
  onUpdateContext(folderRel: string): void
  onDisableAiSync(folderRel: string, folderName: string): void
  onEnableAiSync(folderRel: string): void
  iconOverrides: Record<string, string>
  onPickIcon(key: string, label: string): void
  onClearIcon(key: string): void
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  // Both items below run a real job against whichever assistant Settings
  // names. With none configured, that job would only fail (auth), so the
  // items are left off the menu entirely rather than offered and refused.
  const hasProvider = useHasProvider()

  useEffect(() => {
    function onMouseDown(e: MouseEvent): void {
      if (ref.current && ref.current.contains(e.target as Node)) return
      onClose()
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const isFile = state.node.type === 'note'
  const absPath = isFile
    ? state.node.path
    : state.vaultRoot
      ? `${state.vaultRoot}/${state.node.path}`
      : state.node.path
  const relPath = isFile ? (state.node.meta?.relPath ?? '') : state.node.path
  const displayName = isFile ? (state.node.meta?.title ?? state.node.name) : state.node.name

  type MenuItem = { label: string; destructive?: boolean; onClick(): void }
  const groups: MenuItem[][] = []
  // Creating comes first, and it targets the folder you right-clicked — or the
  // folder the file you right-clicked lives in, which is the same intent.
  // Explorer had these only in the tab row; the other two panes offer them on
  // the rows themselves, and all three should answer a right-click the same way.
  {
    const parentRel = isFile ? relPath.split('/').slice(0, -1).join('/') : relPath
    groups.push([
      {
        label: 'New note',
        onClick: () => {
          void (async () => {
            const r = await api().notes.create({
              type: 'untyped',
              title: 'Untitled',
              folder: parentRel
            })
            if (r.ok && r.data) {
              await openDocument(r.data.path)
              requestTreeInlineRename(r.data)
            }
          })()
        }
      },
      {
        label: 'New folder',
        onClick: () => {
          void api()
            .notes.createFolder({ folder: parentRel, name: 'Untitled folder' })
            .then((r) => {
              if (r.ok && r.data) void openDocument(folderViewPath(r.data.relPath))
            })
        }
      }
    ])
  }
  groups.push([
    {
      label: 'Reveal in Finder',
      onClick: () => {
        void api().files.reveal(absPath)
      }
    }
  ])
  groups.push([
    {
      label: 'Copy Path',
      onClick: () => {
        void navigator.clipboard.writeText(absPath)
      }
    },
    {
      label: 'Copy Relative Path',
      onClick: () => {
        void navigator.clipboard.writeText(relPath)
      }
    }
  ])
  if (isFile) {
    groups.push([
      {
        label: 'File history',
        onClick: () => useUiStore.getState().openFileHistory(absPath)
      }
    ])
  }
  const iconKey = isFile ? absPath : state.node.path
  const hasOverride = !!iconOverrides[iconKey]
  const hasDefault = isFile
    ? state.node.name.startsWith('.') || managedFileIcon(state.node.name) !== null
    : true // folders always have a default folder/folder-opened icon
  const hasVisibleIcon = hasOverride || hasDefault
  if (hasOverride) {
    groups.push([
      {
        label: 'Remove icon',
        onClick: () => onClearIcon(iconKey)
      }
    ])
  } else if (!hasVisibleIcon) {
    groups.push([
      {
        label: 'Add icon',
        onClick: () => onPickIcon(iconKey, displayName)
      }
    ])
  }
  if (isFile) {
    const hidden = isHidden(absPath)
    groups.push([
      {
        label: hidden ? 'Show' : 'Hide',
        onClick: () => {
          if (hidden) onUnhide(absPath)
          else onHide(absPath)
        }
      },
      {
        label: hidden ? 'Show All' : 'Hide All',
        onClick: () => {
          if (hidden) onUnhideAll(state.node.name)
          else onHideAll(state.node.name)
        }
      }
    ])
  }
  if (!isFile && state.node.path === '' && hasProvider) {
    groups.push([
      {
        label: 'Generate Vault Index',
        onClick: () => onLivingIndexRebuild()
      }
    ])
  }
  if (!isFile && state.node.path !== '') {
    const folderRel = state.node.path
    const folderLabel = state.node.name || folderRel
    if (isAiSyncDisabled(folderRel)) {
      groups.push([
        {
          label: 'Enable AI Sync',
          onClick: () => onEnableAiSync(folderRel)
        }
      ])
    } else {
      groups.push([
        // Excluding a folder from AI access is a setting, not a job — it
        // needs no assistant to take effect, so it stays offered even when
        // "Update context" (a real job) does not.
        ...(hasProvider
          ? [{ label: 'Update context', onClick: () => onUpdateContext(folderRel) }]
          : []),
        {
          label: 'Disable AI Sync',
          destructive: true,
          onClick: () => onDisableAiSync(folderRel, folderLabel)
        }
      ])
    }
  }
  const renameGroup: MenuItem[] = []
  if (isFile) {
    renameGroup.push({
      label: 'Rename',
      onClick: () => onRename(absPath, state.node.name)
    })
  }
  groups.push([
    ...renameGroup,
    {
      label: 'Delete',
      destructive: true,
      onClick: () => onAskDelete(absPath, displayName, isFile ? 'note' : 'folder')
    }
  ])

  return (
    <div
      ref={ref}
      role="menu"
      style={{ position: 'fixed', top: state.y, left: state.x, zIndex: 50 }}
      className="w-[160px] rounded-[10px] border border-bd-2 bg-bg-2 shadow-s2 px-1 py-1 text-[12px]"
    >
      {groups.map((group, gi) => (
        <div key={gi}>
          {gi > 0 ? <div className="mx-1 my-1 border-t border-bd-1" /> : null}
          {group.map((item, i) => (
            <button
              key={i}
              type="button"
              role="menuitem"
              title={item.label}
              onClick={() => {
                onClose()
                item.onClick()
              }}
              className={cn(
                'block w-full text-left px-3 py-1 rounded-md leading-snug truncate transition-colors',
                item.destructive
                  ? 'text-red-400 hover:text-red-300 hover:bg-red-500/15'
                  : 'text-foreground hover:bg-accent'
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

function setFitDragImage(
  e: React.DragEvent,
  label: string,
  icon?: string,
  iconColor?: string | null
): void {
  const ghost = document.createElement('div')
  ghost.style.position = 'fixed'
  ghost.style.top = '-1000px'
  ghost.style.left = '-1000px'
  ghost.style.display = 'inline-flex'
  ghost.style.alignItems = 'center'
  ghost.style.gap = '5px'
  ghost.style.padding = '2px 8px'
  ghost.style.borderRadius = '9999px'
  ghost.style.fontSize = '11px'
  ghost.style.lineHeight = '14px'
  ghost.style.width = 'fit-content'
  ghost.style.maxWidth = '320px'
  ghost.style.whiteSpace = 'nowrap'
  ghost.style.overflow = 'hidden'
  ghost.style.textOverflow = 'ellipsis'
  ghost.style.boxShadow = '0 4px 8px rgba(0,0,0,0.2)'
  ghost.style.pointerEvents = 'none'
  ghost.style.backgroundColor = 'rgb(30, 58, 138)'
  ghost.style.border = '1px solid rgb(59, 130, 246)'
  ghost.style.color = 'rgb(255, 255, 255)'
  if (icon) {
    const iconEl = document.createElement('span')
    const colorIsHelper = !!iconColor && /^codicon-[a-z]+$/.test(iconColor)
    iconEl.className = `codicon codicon-${icon}${colorIsHelper ? ` ${iconColor}` : ''}`
    iconEl.style.fontSize = '12px'
    iconEl.style.lineHeight = '1'
    iconEl.style.display = 'inline-grid'
    iconEl.style.placeItems = 'center'
    iconEl.style.verticalAlign = 'middle'
    iconEl.style.flexShrink = '0'
    if (iconColor && !colorIsHelper) {
      iconEl.style.setProperty('color', iconColor, 'important')
    }
    ghost.appendChild(iconEl)
  }
  const labelEl = document.createElement('span')
  labelEl.textContent = label
  ghost.appendChild(labelEl)
  document.body.appendChild(ghost)
  e.dataTransfer.setDragImage(ghost, 12, 12)
  setTimeout(() => ghost.remove(), 0)
}

interface TreeRenderShared {
  collapsed: Set<string>
  onToggleFolder: (path: string) => void
  activePath: string | null
  onOpen: (path: string) => void
  onContext: (e: React.MouseEvent, node: TreeNode) => void
  onDropNote: (noteRel: string, targetFolderRel: string) => Promise<void>
  onDropFolder: (folderRel: string, targetFolderRel: string) => Promise<void>
  iconOverrides: Record<string, string>
  iconColorOverrides: Record<string, string>
  onIconDblClick: (key: string, label: string) => void
  hidden: Set<string>
  revealedAll: boolean
  onToggleRevealAll: () => void
  onUnhide: (absPath: string) => void
  onGroupContext: (e: React.MouseEvent, basename: string) => void
  /** The one thing worth offering from an empty tree. */
  onCreateNote: () => void
  rowDetails: FileDisplaySettings
  editing: { path: string; value: string } | null
  onEditingChange: (value: string) => void
  onEditingKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onEditingBlur: () => void
}

function FileTreeView({
  node,
  depth,
  ...shared
}: { node: TreeNode; depth: number } & TreeRenderShared): JSX.Element {
  if (!node.children || node.children.length === 0) {
    return depth === 0 ? (
      <EmptyState
        icon="files"
        title="No notes yet"
        hint="Notes are plain Markdown files in this folder."
        action={{
          label: 'New note',
          icon: 'new-file',
          onClick: () => void shared.onCreateNote()
        }}
      />
    ) : (
      <></>
    )
  }
  const visible = node.children.filter((c) => !(c.type === 'note' && shared.hidden.has(c.path)))
  const guideX = depth > 0 ? (depth - 1) * 18 + 16 : null
  return (
    <div className="relative">
      {guideX !== null ? (
        <div
          aria-hidden="true"
          className="absolute top-1 bottom-1 w-px bg-accent/60 pointer-events-none"
          style={{ left: `${guideX}px` }}
        />
      ) : null}
      {visible.map((child) => (
        <FileTreeNode key={child.path + child.name} node={child} depth={depth} {...shared} />
      ))}
    </div>
  )
}

function collectHidden(node: TreeNode, hidden: Set<string>): TreeNode[] {
  const out: TreeNode[] = []
  function walk(n: TreeNode): void {
    for (const c of n.children ?? []) {
      if (c.type === 'note' && hidden.has(c.path)) out.push(c)
      else if (c.type === 'folder') walk(c)
    }
  }
  walk(node)
  out.sort((a, b) => (a.meta?.relPath ?? a.name).localeCompare(b.meta?.relPath ?? b.name))
  return out
}

function HiddenToggleRow({
  depth,
  count,
  open,
  onClick
}: {
  depth: number
  count: number
  open: boolean
  onClick(): void
}): JSX.Element {
  return (
    <div
      onClick={onClick}
      className="tree-row text-c-2 italic"
      style={{ paddingLeft: `${10 + depth * 18}px` }}
      title={open ? 'Hide service files' : 'Show hidden service files'}
    >
      <Icon name={open ? 'eye' : 'eye-closed'} size={12} className="text-c-2 shrink-0" />
      <span className="text-[11px]">{open ? 'Hide hidden' : `Show hidden (${count})`}</span>
    </div>
  )
}

function HiddenBasenameGroups({
  items,
  shared
}: {
  items: TreeNode[]
  shared: TreeRenderShared
}): JSX.Element {
  const groups = useMemo(() => {
    const map = new Map<string, TreeNode[]>()
    for (const n of items) {
      const arr = map.get(n.name)
      if (arr) arr.push(n)
      else map.set(n.name, [n])
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [items])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // Managed context files (CLAUDE.md/AGENTS.md/GEMINI.md) show the active
  // provider's own mark everywhere else in the tree — this group row is no
  // different, so it shouldn't fall back to the generic lightbulb icon.
  const engineProvider = useUiStore((s) => s.settings?.engine?.provider) ?? 'claude'
  function toggle(basename: string): void {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(basename)) next.delete(basename)
      else next.add(basename)
      return next
    })
  }
  return (
    <>
      {groups.map(([basename, nodes]) => {
        const open = expanded.has(basename)
        const isManagedContext = managedFileIcon(basename) !== null
        const groupIcon = isManagedContext
          ? null
          : basename.startsWith('.')
            ? defaultHiddenFileIcon(basename)
            : null
        const groupIconTint = managedFileIconColor(basename) ?? 'text-muted-foreground'
        return (
          <div key={basename}>
            <div
              onClick={() => toggle(basename)}
              onContextMenu={(e) => {
                e.preventDefault()
                shared.onGroupContext(e, basename)
              }}
              className="tree-row text-muted-foreground/80"
              style={{ paddingLeft: '10px' }}
              title={`${basename} — ${nodes.length} hidden — right-click for group actions`}
            >
              <Icon
                name={open ? 'chevron-down' : 'chevron-right'}
                size={12}
                className="text-muted-foreground shrink-0"
              />
              {isManagedContext ? (
                shared.rowDetails.showServiceFileIcons ? (
                  <ProviderGlyph id={engineProvider} size={14} />
                ) : null
              ) : groupIcon ? (
                <Icon name={groupIcon} size={14} className={cn('shrink-0', groupIconTint)} />
              ) : null}
              <span className="truncate flex-1">{basename}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground/70">{nodes.length}</span>
            </div>
            {open
              ? nodes.map((child) => (
                  <FileTreeNode
                    key={child.path + child.name}
                    node={child}
                    depth={1}
                    isHiddenItem
                    {...shared}
                  />
                ))
              : null}
          </div>
        )
      })}
    </>
  )
}

function HiddenGroupMenu({
  x,
  y,
  basename,
  onClose,
  onShowAll
}: {
  x: number
  y: number
  basename: string
  onClose(): void
  onShowAll(): void
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function onDown(e: MouseEvent): void {
      if (ref.current && ref.current.contains(e.target as Node)) return
      onClose()
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  type Item = { label: string; onClick(): void }
  const items: Item[] = [{ label: 'Show in tree', onClick: onShowAll }]

  return createPortal(
    <div
      ref={ref}
      role="menu"
      data-mindex-floating="true"
      style={{ position: 'fixed', top: y, left: x, zIndex: 50 }}
      className="w-[180px] rounded-[10px] border border-bd-2 bg-bg-2 shadow-s2 px-1 py-1 text-[12px]"
    >
      <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-muted-foreground/60 truncate">
        {basename}
      </div>
      {items.map((item, i) => (
        <button
          key={i}
          type="button"
          role="menuitem"
          onClick={() => {
            onClose()
            item.onClick()
          }}
          className="block w-full text-left px-3 py-1 rounded-md leading-snug truncate transition-colors text-foreground hover:bg-accent"
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body
  )
}

function FileTreeNode({
  node,
  depth,
  isHiddenItem = false,
  ...shared
}: {
  node: TreeNode
  depth: number
  isHiddenItem?: boolean
} & TreeRenderShared): JSX.Element {
  const {
    collapsed,
    onToggleFolder,
    activePath,
    onOpen,
    onContext,
    onDropNote,
    onDropFolder,
    iconOverrides,
    iconColorOverrides,
    onIconDblClick,
    rowDetails,
    editing,
    onEditingChange,
    onEditingKeyDown,
    onEditingBlur
  } = shared
  // AGENTS.md is written for, and read by, whichever CLI is selected — so the
  // row carries that provider's mark rather than a generic one. Read here
  // rather than passed down: it is one subscription per row to a value that
  // changes about as often as never.
  const engineProvider = useUiStore((s) => s.settings?.engine?.provider) ?? 'claude'
  // Hovering a row lights up the same thing on the graph — see stores/hover.
  const setHovered = useHoverStore((s) => s.setHovered)
  const vaultRoot = useVaultStore((s) => s.vault?.root ?? '')
  const indent = { paddingLeft: `${10 + depth * 18}px` }
  const isEditingThis = editing?.path === node.path
  const editInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!isEditingThis) return
    const el = editInputRef.current
    if (!el) return
    el.scrollIntoView({ block: 'nearest' })
    el.focus()
    if (node.type === 'note') {
      const dot = node.name.lastIndexOf('.')
      el.setSelectionRange(0, dot > 0 ? dot : node.name.length)
    } else {
      el.select()
    }
    // Only re-run when this row starts/stops being the edit target — not on
    // every keystroke, or the selection would keep resetting as you type.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditingThis])
  const editInput = isEditingThis ? (
    <input
      ref={editInputRef}
      value={editing?.value ?? ''}
      onChange={(e) => onEditingChange(e.target.value)}
      onKeyDown={onEditingKeyDown}
      onBlur={onEditingBlur}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      className="min-w-0 flex-1 rounded-[4px] border border-primary/60 bg-background px-1 -my-px text-[inherit] leading-[inherit] outline-none"
    />
  ) : null
  if (node.type === 'folder') {
    const isCollapsed = collapsed.has(node.path)
    // Through the facade, like everywhere else that draws a file or a folder.
    // This used to call the low-level resolver and build the override key by
    // hand — the one thing the facade exists to stop, since a note's key is
    // its absolute path and a folder's its relative one, and getting that
    // wrong looks exactly like nobody ever chose an icon. The settings are
    // taken as an argument because a row is drawn in a loop, where the hook
    // form cannot be called.
    const resolved = folderLookFrom(
      { iconOverrides, iconColorOverrides, provider: engineProvider },
      node.path,
      node.name,
      !isCollapsed
    )
    const defaultFolderIcon = isCollapsed ? 'folder' : 'folder-opened'
    return (
      <>
        <div
          className="tree-row"
          style={indent}
          // A folder row is keyed relatively but a graph node absolutely, so
          // the path is normalised here — at the one place that publishes it —
          // rather than leaving the graph to guess which kind it got.
          onMouseEnter={() => setHovered(vaultRoot ? `${vaultRoot}/${node.path}` : null)}
          onMouseLeave={() => setHovered(null)}
          draggable={!isEditingThis}
          onClick={() => {
            if (isEditingThis) return
            onToggleFolder(node.path)
            onOpen(folderViewPath(node.path))
          }}
          onContextMenu={(e) => onContext(e, node)}
          onDragStart={(e) => {
            e.dataTransfer.setData('application/x-mindex-move-folder', node.path)
            e.dataTransfer.effectAllowed = 'move'
            setFitDragImage(
              e,
              node.name,
              resolved.icon ?? defaultFolderIcon,
              resolved.colorClass ?? undefined
            )
          }}
          onDragOver={(e) => {
            const types = e.dataTransfer.types
            const hasNote = types.includes('application/x-mindex-note')
            const hasFolder = types.includes('application/x-mindex-move-folder')
            if (hasNote || hasFolder) {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              ;(e.currentTarget as HTMLElement).dataset.dropTarget = 'true'
            }
          }}
          onDragLeave={(e) => {
            delete (e.currentTarget as HTMLElement).dataset.dropTarget
          }}
          onDrop={(e) => {
            delete (e.currentTarget as HTMLElement).dataset.dropTarget
            const noteRel = e.dataTransfer.getData('application/x-mindex-note')
            const folderRel = e.dataTransfer.getData('application/x-mindex-move-folder')
            if (noteRel) {
              e.preventDefault()
              void onDropNote(noteRel, node.path)
            } else if (folderRel) {
              e.preventDefault()
              void onDropFolder(folderRel, node.path)
            }
          }}
        >
          <Icon
            name={isCollapsed ? 'chevron-right' : 'chevron-down'}
            size={12}
            className="text-c-2 shrink-0"
          />
          {rowDetails.showFolderIcons ? (
            <span
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => {
                e.stopPropagation()
                onIconDblClick(node.path, node.name)
              }}
              title="Double-click to change icon"
              // `flex`, not a bare span — same as the folder view's cards. An
              // inline box is as tall as the taller of the icon and the
              // invisible strut its line-height creates; the strut wins, the
              // icon sits on its baseline, and the leftover descender space
              // lifts it off the middle of the row.
              className="flex shrink-0 cursor-pointer"
            >
              <Icon
                name={resolved.icon ?? defaultFolderIcon}
                size={14}
                className={resolved.colorClass ?? undefined}
              />
            </span>
          ) : null}
          {editInput ?? <span className="truncate">{node.name}</span>}
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            <FolderStatusDot folderRel={node.path} collapsed={isCollapsed} />
            <GitStatusBadge relPath={node.path} isFolder />
          </span>
        </div>
        {!isCollapsed ? (
          <div className="mb-2">
            <FileTreeView node={node} depth={depth + 1} {...shared} />
          </div>
        ) : null}
      </>
    )
  }
  const meta = node.meta!
  const isManaged = managedFileIcon(node.name) !== null
  const fileDefault = defaultFileIcon(node.name)
  // Same facade the folder branch and the graph use.
  const resolvedFile = noteLookFrom(
    { iconOverrides, iconColorOverrides, provider: engineProvider },
    node.path,
    node.name,
    meta.title
  )
  const iconToShow = resolvedFile.icon ?? fileDefault.name
  const displayLabel = isHiddenItem ? meta.relPath : treeDisplayName(node.name, meta.title)
  const showModified = rowDetails.modified && !isManaged
  const showPreview = rowDetails.preview && !!meta.preview && !isManaged
  const dateBelow = showModified && (rowDetails.datePosition ?? 'inline') === 'below'
  const dateInline = showModified && !dateBelow
  const dateText = showModified
    ? formatFileDate(
        rowDetails.dateField === 'created' ? (meta.createdAt ?? meta.mtime) : meta.mtime
      )
    : ''
  const stacked = showPreview || dateBelow
  return (
    <div
      className={cn(
        'tree-row',
        isHiddenItem && 'opacity-60',
        stacked && 'flex-col items-stretch gap-0'
      )}
      style={indent}
      onMouseEnter={() => setHovered(node.path)}
      onMouseLeave={() => setHovered(null)}
      data-active={activePath === node.path}
      draggable={!isEditingThis}
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-mindex-note', meta.relPath)
        e.dataTransfer.setData('text/plain', meta.relPath)
        e.dataTransfer.effectAllowed = 'copyMove'
        setFitDragImage(e, displayLabel, iconToShow ?? undefined, resolvedFile.colorClass)
      }}
      onClick={() => {
        if (isEditingThis) return
        onOpen(node.path)
      }}
      onContextMenu={(e) => onContext(e, node)}
    >
      <div
        className={cn(
          'flex flex-1 gap-1.5 min-w-0',
          rowDetails.wrapTitle ? 'items-start' : 'items-center'
        )}
      >
        {(isManaged ? rowDetails.showServiceFileIcons : rowDetails.showFileIcons) && iconToShow ? (
          <span
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => {
              e.stopPropagation()
              onIconDblClick(node.path, displayLabel)
            }}
            title="Double-click to change icon"
            className={cn(
              'shrink-0 cursor-pointer flex items-center justify-center',
              rowDetails.wrapTitle && 'mt-[2px]'
            )}
          >
            {/* A managed file with no explicit override shows the selected
                provider's mark in its brand colour; anything the user has
                picked for the row wins over that, as it does everywhere else. */}
            {resolvedFile.provider ? (
              <ProviderGlyph id={resolvedFile.provider} size={14} />
            ) : (
              <Icon
                name={iconToShow}
                size={14}
                className={resolvedFile.colorClass || 'text-muted-foreground'}
              />
            )}
          </span>
        ) : null}
        {editInput ?? (
          <span
            className={cn(
              'min-w-0 text-c-1',
              rowDetails.wrapTitle ? 'whitespace-normal break-words' : 'truncate'
            )}
          >
            {displayLabel}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">
          <GitStatusBadge relPath={meta.relPath} />
          {dateInline ? (
            <span className="text-[10px] text-muted-foreground/70 tabular-nums">{dateText}</span>
          ) : null}
        </span>
      </div>
      {dateBelow ? (
        <span className="mt-0.5 truncate text-[10px] text-muted-foreground/70 tabular-nums">
          {dateText}
        </span>
      ) : null}
      {showPreview ? (
        <span className="mt-1 truncate text-[12px] text-muted-foreground/70">{meta.preview}</span>
      ) : null}
    </div>
  )
}

function defaultHiddenFileIcon(_basename: string): string {
  return 'circle-large-outline'
}

function SortGroupMenu({
  sort,
  onSortChange,
  group,
  onGroupChange
}: {
  sort: TreeSort
  onSortChange(next: TreeSort): void
  group: TreeGroup
  onGroupChange(next: TreeGroup): void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open) return
    function update(): void {
      const t = triggerRef.current
      if (!t) return
      const r = t.getBoundingClientRect()
      setAnchor({ top: r.bottom + 4, left: r.right - 180 })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent): void {
      const t = e.target as Node | null
      if (!t) return
      if (triggerRef.current?.contains(t)) return
      if (popoverRef.current?.contains(t)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <>
      <ChromeButton
        ref={triggerRef}
        box={28}
        icon="sort-precedence"
        iconSize={14}
        iconClassName="codicon-inherit"
        title="Sort & group"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="text-c-2 focus-visible:outline-none focus-visible:ring-0"
      />
      {open && anchor
        ? createPortal(
            <div
              ref={popoverRef}
              role="menu"
              data-mindex-floating="true"
              style={{
                position: 'fixed',
                top: anchor.top,
                left: anchor.left,
                minWidth: 180,
                zIndex: 100,
                pointerEvents: 'auto'
              }}
              className="rounded-[10px] border border-bd-2 bg-bg-2 shadow-s2 px-1 py-1 text-[12px]"
            >
              <SortGroupSection options={SORT_OPTIONS} value={sort} onPick={onSortChange} />
              <div className="my-1 border-t border-bd-1" />
              <SortGroupSection options={GROUP_OPTIONS} value={group} onPick={onGroupChange} />
            </div>,
            document.body
          )
        : null}
    </>
  )
}

function SortGroupSection<T extends string>({
  options,
  value,
  onPick
}: {
  options: SelectOption<T>[]
  value: T
  onPick(next: T): void
}): JSX.Element {
  return (
    <div className="space-y-px">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="menuitemradio"
          aria-checked={o.value === value}
          onClick={() => onPick(o.value)}
          className={cn(
            'block w-full text-left px-3 py-1 rounded-[6px] leading-snug truncate transition-colors',
            o.value === value ? 'bg-accent text-foreground' : 'text-foreground hover:bg-accent'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
