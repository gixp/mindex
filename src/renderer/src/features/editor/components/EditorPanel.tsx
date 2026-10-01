import { useEditorStore } from '@/features/editor/store'
import {
  isFolderViewPath,
  isTypeViewPath,
  isVirtualPath,
  typeIdFromPath,
  isSkillViewPath,
  skillPathFromView,
  SKILLS_HOME_PATH,
  TYPES_HOME_PATH,
  GRAPH_HOME_PATH,
  isGraphPath,
  graphFolderFromPath,
  folderRelFromPath
} from '@/platform/documents'
import { useVaultStore } from '@/platform/workspace'
import { useUiStore } from '@/platform/app-settings'
import { useNoteTypesStore } from '@/platform/note-types'
import { TypeModeSwitch } from '@/features/types/components/TypeModeSwitch'
import { useCommentsStore } from '@/features/comments/store'
import { api } from '@/platform/api'
import { requestCreateSkill } from '@/features/skills/lib/create'
import { requestCreateType } from '@/features/types/lib/create'
import { treeDisplayName } from '@/platform/presentation/tree-display'
import { folderLook, noteLook } from '@/platform/presentation'
import { openIconPicker } from '@/platform/icon-picker'
import {
  requestTreeInlineRename,
  requestTreeInlineRenameFolder
} from '@/platform/presentation/tree-events'
import { useTreeRowIconSettings } from '@/platform/presentation/useTreeRowIconSettings'
import { findGroup } from '@/platform/tab-layout'
import { type TabItem } from '@/ui/tab-bar'
import { SplitTabsView } from '@/features/layout/components/SplitTabsView'
import { Icon } from '@/ui/icon'
import { ChromeButton } from '@/ui/chrome-button'
import { cn } from '@/ui/cn'
import { ProviderGlyph } from '@/ui/provider-glyph'
import { Editor, ModeSwitch } from './Editor'
import { isExcalidrawPath } from '@shared/excalidraw'
import { isMarkdownNote } from '@/features/editor/lib/editable-note'

const EDITOR_DRAG_MIME = 'application/x-mindex-tab-editor'

function PanelActions({
  actions
}: {
  actions: { label: string; icon: string; onClick(): void }[]
}): JSX.Element {
  return (
    <div className="titlebar-no-drag flex shrink-0 items-center gap-2">
      {actions.map((a, i) => (
        <ChromeButton
          key={a.label}
          icon={a.icon}
          label={a.label}
          iconSize={14}
          onClick={a.onClick}
          title={a.label}
          aria-label={a.label}
          // No horizontal padding — spacing between buttons comes from the
          // container's own gap-2; only the last one gets its own mr-2, for
          // the trailing inset.
          className={cn('px-0', i === actions.length - 1 ? 'mr-2' : undefined)}
        />
      ))}
    </div>
  )
}

function FolderActionButtons({ folderRel }: { folderRel: string }): JSX.Element {
  async function newFile(): Promise<void> {
    const r = await api().notes.create({ type: 'untyped', title: 'Untitled', folder: folderRel })
    if (r.ok && r.data) {
      await useEditorStore.getState().open(r.data.path)
      requestTreeInlineRename(r.data)
    }
  }
  async function newFolder(): Promise<void> {
    const r = await api().notes.createFolder({ folder: folderRel, name: 'Untitled folder' })
    // Named in the sidebar rather than opened here. Opening the new folder
    // shows an empty page and leaves the placeholder name standing; the
    // input is the thing that was actually being asked for.
    if (r.ok && r.data) requestTreeInlineRenameFolder(r.data)
  }
  return (
    <PanelActions
      actions={[
        { label: 'New file', icon: 'new-file', onClick: () => void newFile() },
        { label: 'New folder', icon: 'new-folder', onClick: () => void newFolder() }
      ]}
    />
  )
}

/** From a folder's graph back to the whole vault's. */
function FullGraphAction(): JSX.Element {
  return (
    <PanelActions
      actions={[
        {
          label: 'Full graph',
          icon: 'type-hierarchy',
          onClick: () => void useEditorStore.getState().open(GRAPH_HOME_PATH)
        }
      ]}
    />
  )
}

/**
 * A home screen's create button belongs with the panel's other floating
 * actions rather than inside the page: it is the same kind of action on the
 * same kind of surface, and putting it in the body made it a different
 * control for no reason the reader could see.
 */
function SkillsHomeActions(): JSX.Element {
  return (
    <PanelActions
      actions={[{ label: 'New skill', icon: 'new-file', onClick: () => void requestCreateSkill() }]}
    />
  )
}

function TypesHomeActions(): JSX.Element {
  return (
    <PanelActions
      actions={[{ label: 'New type', icon: 'new-file', onClick: () => void requestCreateType() }]}
    />
  )
}

/**
 * Opens the comments column beside the note. Bare — no padding, no fill —
 * so it reads as part of the same quiet row as the save state next to it.
 * Preview only: Source mode shows raw markdown, where the in-text highlights
 * these threads pair with do not exist.
 */
function CommentsToggle({
  path,
  previewMode
}: {
  path: string
  previewMode: boolean
}): JSX.Element | null {
  const open = useUiStore((s) => s.commentsOpen)
  const setOpen = useUiStore((s) => s.setCommentsOpen)
  // Unresolved only: a resolved thread is finished business, and counting it
  // here would keep advertising work that is already done.
  const count = useCommentsStore((s) =>
    s.path === path ? s.threads.filter((t) => !t.resolved).length : 0
  )
  // Resolved threads included, unlike the count above: this decides whether
  // there is anything to look at, and a note whose only thread is resolved
  // still has one. A control that never has anything behind it is noise on
  // every note that has no comments — which is most of them.
  const total = useCommentsStore((s) => (s.path === path ? s.threads.length : 0))
  if (total === 0) return null

  return (
    <button
      type="button"
      disabled={!previewMode}
      title={
        previewMode ? (open ? 'Hide comments' : 'Show comments') : 'Comments are shown in Preview'
      }
      onClick={() => setOpen(!open)}
      className={cn(
        'inline-flex items-center gap-1 text-11 transition-colors',
        !previewMode
          ? 'text-muted-foreground/40'
          : open
            ? 'text-foreground'
            : 'text-muted-foreground hover:text-foreground'
      )}
    >
      <Icon name="comment" size={15} className={previewMode ? undefined : 'codicon-muted'} />
      {count > 0 ? <span className="tabular-nums">{count}</span> : null}
    </button>
  )
}

/**
 * Every earlier version of this file, on the file this tab is showing.
 *
 * It opened from exactly one place before: the right-click menu on a row in
 * the file tree. Every edit the assistant applies is recorded as a version, by
 * design — so the way back from a rewrite somebody did not want was the
 * hardest screen in the app to find. It belongs beside the note it is about.
 */
function HistoryButton({ path }: { path: string }): JSX.Element {
  return (
    <button
      type="button"
      title="Version history"
      aria-label="Version history"
      onClick={() => useUiStore.getState().openFileHistory(path)}
      className="inline-flex items-center text-11 text-muted-foreground transition-colors hover:text-foreground"
    >
      <Icon name="history" size={15} className="codicon-inherit" />
    </button>
  )
}

export function EditorPanel(): JSX.Element {
  const layout = useEditorStore((s) => s.layout)
  const activeGroupId = useEditorStore((s) => s.activeGroupId)
  const tabPaths = useEditorStore((s) => s.tabPaths)
  const setActiveTab = useEditorStore((s) => s.setActiveTab)
  const setActiveGroup = useEditorStore((s) => s.setActiveGroup)
  const closeTab = useEditorStore((s) => s.closeTab)
  const openRoot = useEditorStore((s) => s.openRoot)
  const renameTab = useEditorStore((s) => s.renameTab)
  const reorderTabs = useEditorStore((s) => s.reorderTabs)
  const dropTabOnGroup = useEditorStore((s) => s.dropTabOnGroup)
  const notes = useVaultStore((s) => s.notes)
  const storedMode = useUiStore((s) => s.settings?.editorViewMode)
  const mode: 'edit' | 'preview' = storedMode === 'edit' ? 'edit' : 'preview'
  const setMode = useUiStore((s) => s.setEditorViewMode)
  const vaultName = useVaultStore((s) => s.vault?.name)
  // Matches TreePane's own row icon: a managed context file (CLAUDE.md/
  // AGENTS.md/GEMINI.md) shows the active provider's mark, not a generic
  // icon — otherwise the open tab and its sidebar row disagree.

  const { showFileIcons, showFolderIcons } = useTreeRowIconSettings()
  // Tab labels for type-editor tabs come from the definitions, so renaming a
  // type renames its open tab rather than leaving the old name sitting there.
  const typeDefs = useNoteTypesStore((s) => s.defs)

  function titleFor(path: string): string {
    if (path === SKILLS_HOME_PATH) return 'Skills'
    if (path === TYPES_HOME_PATH) return 'Types'
    if (isGraphPath(path)) {
      // The folder the graph is scoped to, not the word "Graph" — the tab's
      // own icon (type-hierarchy, in leadingFor below) already says what
      // kind of view this is. Empty means the whole vault.
      const rel = graphFolderFromPath(path)
      return rel ? (rel.split('/').pop() ?? rel) : (vaultName ?? 'Vault')
    }
    if (isSkillViewPath(path)) {
      const abs = skillPathFromView(path)
      return abs.split('/').pop() ?? abs
    }
    if (isTypeViewPath(path)) {
      const id = typeIdFromPath(path)
      return typeDefs.find((d) => d.id === id)?.label ?? id
    }
    if (isFolderViewPath(path)) {
      const folderRel = folderRelFromPath(path)
      return folderRel ? (folderRel.split('/').pop() ?? folderRel) : (vaultName ?? 'Vault')
    }
    const basename = path.split('/').pop() ?? path
    const meta = notes.find((n) => n.path === path)
    return treeDisplayName(basename, meta?.title ?? basename.replace(/\.md$/, ''))
  }

  function leadingFor(path: string): React.ReactNode {
    if (path === SKILLS_HOME_PATH) {
      return <Icon name="robot" size={14} className="text-muted-foreground" />
    }
    if (path === TYPES_HOME_PATH) {
      return <Icon name="symbol-parameter" size={14} className="text-muted-foreground" />
    }
    if (isGraphPath(path)) {
      return <Icon name="type-hierarchy" size={14} className="text-muted-foreground" />
    }
    if (isSkillViewPath(path)) {
      const name = skillPathFromView(path).split('/').pop() ?? ''
      const look = noteLook(skillPathFromView(path), name)
      return (
        <Icon name={look.icon ?? 'file'} size={14} className={look.colorClass ?? 'text-accent-1'} />
      )
    }
    if (isTypeViewPath(path)) {
      const id = typeIdFromPath(path)
      const icon = typeDefs.find((d) => d.id === id)?.icon ?? 'symbol-parameter'
      return <Icon name={icon} size={14} className="text-muted-foreground" />
    }
    if (isFolderViewPath(path)) {
      if (!showFolderIcons) return null
      const folderRel = folderRelFromPath(path)
      const look = folderLook(folderRel, folderRel.split('/').pop() ?? folderRel)
      return (
        <Icon name={look.icon ?? 'folder'} size={14} className={look.colorClass ?? undefined} />
      )
    }
    if (!showFileIcons) return null
    const basename = path.split('/').pop() ?? ''
    const meta = notes.find((n) => n.path === path)
    // Was its own copy of the precedence.
    const look = noteLook(path, basename, meta?.title ?? basename.replace(/\.md$/, ''))
    const name = look.icon ?? 'file'
    const colorClass = look.colorClass ?? 'text-accent-1'
    const label = look.label
    return (
      <button
        type="button"
        title="Change icon"
        aria-label="Change icon"
        onClick={(e) => {
          e.stopPropagation()
          openIconPicker(path, label)
        }}
        onMouseDown={(e) => e.stopPropagation()}
        className="inline-flex items-center justify-center h-4 w-4 cursor-pointer"
      >
        {/* The shared answer sets `provider` only for a managed file with
            nothing chosen for it, so that single flag is the whole condition
            the three-part check used to spell out. */}
        {look.provider ? (
          <ProviderGlyph id={look.provider} size={12} />
        ) : (
          <Icon name={name} size={12} className={colorClass} />
        )}
      </button>
    )
  }

  function rightSlotFor(groupId: string): React.ReactNode {
    const grp = findGroup(layout, groupId)
    const path = grp?.activeId ? tabPaths[grp.activeId] : undefined
    if (!path) return null
    // Folder view (the card feed) gets New file / New folder here instead of
    // the file-only dirty/mode controls — creating something goes straight
    // into whichever folder you're already looking at.
    if (isFolderViewPath(path)) return <FolderActionButtons folderRel={folderRelFromPath(path)} />
    if (isTypeViewPath(path)) return <TypeModeSwitch />
    // The same switch a note gets, driven by the same stored mode — a skill
    // file is markdown too, and how you are looking at something should not
    // depend on which folder it happens to live in.
    // The home screens are lists, not documents — no mode switch, but they do
    // get the create action that belongs to what they are listing.
    if (path === SKILLS_HOME_PATH) return <SkillsHomeActions />
    if (path === TYPES_HOME_PATH) return <TypesHomeActions />
    if (isSkillViewPath(path)) {
      return (
        <>
          <HistoryButton path={skillPathFromView(path)} />
          <CommentsToggle path={skillPathFromView(path)} previewMode={mode === 'preview'} />
          <ModeSwitch mode={mode} onChange={setMode} />
        </>
      )
    }
    // The graph is a canvas, not a document — there is no source to switch to
    // and nothing to comment on. A folder's graph gets one action: the way
    // back out to the whole vault, which is the only place a scoped graph
    // cannot take you by clicking around inside it.
    if (isGraphPath(path)) {
      return graphFolderFromPath(path) ? <FullGraphAction /> : null
    }
    if (isExcalidrawPath(path)) return null
    // Every other file in the vault opens as read-only text — a config, a
    // script, the CSV the notes are about. There is nothing to switch to and
    // nothing to comment on: the two views and the comment thread belong to
    // markdown, which is the only thing this editor owns.
    if (!isMarkdownNote(path)) return null
    // No save indicator: saving is automatic, so a permanent label reporting
    // that it happened is noise on every note, all the time.
    return (
      <>
        <HistoryButton path={path} />
        <CommentsToggle path={path} previewMode={mode === 'preview'} />
        <ModeSwitch mode={mode} onChange={setMode} />
      </>
    )
  }

  return (
    <SplitTabsView
      layout={layout}
      activeGroupId={activeGroupId}
      dragMime={EDITOR_DRAG_MIME}
      addLabel="Open workspace"
      surfaceClassName="bg-transparent"
      addSpacing
      tabRowClassName="p-1.5"
      // Same tab-strip design as the right sidebar's own (AgentTabsPanel) —
      // see plan/color-schema-migration.md. Rendered inline at the top of
      // this panel now, not portaled into the header.
      inactiveTabClassName="bg-bg-3"
      activeTabClassName="bg-bg-4"
      onSelect={setActiveTab}
      onClose={(tabId) => void closeTab(tabId)}
      onAdd={(groupId) => openRoot(groupId)}
      onRename={(tabId, next) => {
        const path = tabPaths[tabId]
        if (path) void renameTab(path, next)
      }}
      onReorder={(from, to) => reorderTabs(from, to)}
      onDrop={(tabId, groupId, edge) => dropTabOnGroup(tabId, groupId, edge)}
      onFocusGroup={setActiveGroup}
      rightSlot={rightSlotFor}
      contextMenu={(tabId, e) => {
        const path = tabPaths[tabId]
        if (!path || isVirtualPath(path)) return []
        if (e) {
          window.dispatchEvent(
            new CustomEvent('mindex:open-file-context-menu', {
              detail: { path, x: e.clientX, y: e.clientY }
            })
          )
        }
        return []
      }}
      renderTabItem={(tabId): TabItem => {
        const path = tabPaths[tabId] ?? ''
        return {
          id: tabId,
          title: titleFor(path),
          tooltip: path,
          leading: leadingFor(path),
          compact: true
        }
      }}
      renderBody={(tabId) => <Editor path={tabPaths[tabId] ?? ''} />}
    />
  )
}
