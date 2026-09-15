import { useEffect, useMemo, useState } from 'react'
import type { GitInfo, RecentVault, UpdateStatus, SyncMode, VaultSettings } from '@shared/types'
import { StandardDialog } from '@/ui/StandardDialog'
import { DIALOG_CLOSE_BTN } from '@/ui/dialog-chrome'
import { ConfirmDialog } from '@/ui/ConfirmDialog'
import { PICKER_SELECTED, pickerOption } from '@/ui/picker-option'
import { ChromeButton } from '@/ui/chrome-button'
import { Icon } from '@/ui/icon'
import { api } from '@/platform/api'
import { pushToast } from '@/platform/notifications'
import { cn } from '@/ui/cn'
import {
  CHAT_FONT_SIZE_DEFAULT,
  CHAT_FONT_SIZE_MAX,
  CHAT_FONT_SIZE_MIN,
  CLI_FONT_SIZE_DEFAULT,
  CLI_FONT_SIZE_MAX,
  CLI_FONT_SIZE_MIN,
  EDITOR_FONT_SIZE_DEFAULT,
  EDITOR_FONT_SIZE_MAX,
  EDITOR_FONT_SIZE_MIN,
  useUiStore
} from '@/platform/app-settings'
import { useVaultStore } from '@/platform/workspace'
import { useIconPickerStore } from '@/platform/icon-picker'
import { useFolderLook } from '@/platform/presentation'
import { useGitStatusStore } from '@/features/git/store'
import { useSyncStatus } from '@/features/git/lib/useSyncStatus'
import { PublishToGitHubDialog } from '@/features/git/components/PublishToGitHubDialog'
import { useHiddenFilesStore } from '@/features/tree/store-hiddenFiles'
import { useTreeSortStore } from '@/features/tree/store-treeSort'
import { setDefaultView } from '@/features/terminal/store-tabs'
import {
  DEFAULT_FILE_DISPLAY,
  FILE_DISPLAY_EVENT,
  type FileDisplaySettings
} from '@/platform/presentation/useFileDisplaySettings'
import { ViewPicker, type PanelView } from '@/ui/view-picker'
import { ProviderRequiredNotice } from '@/ui/ProviderRequiredNotice'
import { useHasProvider } from '@/platform/engines'
import { Switch } from '@/ui/switch'
import {
  ActionButton,
  Card,
  Field,
  GroupLabel,
  IconButton,
  NavItem,
  BlockRow,
  Row,
  SectionShell,
  Segmented,
  Stepper,
  ToggleTile,
  type ConfirmSpec
} from './primitives'
import { DeclaredCard, searchEntries, type SettingGroup } from './declare'
import { EngineSection } from './EngineSection'
import { HotkeysSection } from './HotkeysSection'

interface Props {
  open: boolean
  onOpenChange(open: boolean): void
}

type SectionId =
  | 'engine'
  | 'telemetry'
  | 'vaults'
  | 'git'
  | 'appearance'
  | 'sidebar-left'
  | 'center'
  | 'sidebar-right'
  | 'hotkeys'
  | 'about'

interface NavGroup {
  /** Heading above the group. */
  label: string
  items: { id: SectionId; label: string; icon: string }[]
}

/**
 * The sidebar, in three groups.
 *
 * General holds what the app needs to run at all — who you are, what writes
 * your context, where your notes live. Design is one subject asked three
 * times, once per pane, so it keeps a heading or the three window-part names
 * read as three unrelated screens. Other is what is left: it does not answer
 * "where do I change this?" the way the first two do, so it does not pretend
 * to — the label says exactly that little.
 */
const GROUPS: NavGroup[] = [
  {
    label: 'General',
    items: [
      // About first: the version, the update offer and the bug report are what
      // someone opens Settings for when something is wrong, which is most of
      // the time anyone opens it deliberately.
      { id: 'about', label: 'About', icon: 'info' },
      { id: 'engine', label: 'AI', icon: 'sparkle-filled' },
      { id: 'vaults', label: 'Vaults', icon: 'folder-opened' }
    ]
  },
  {
    label: 'Design',
    items: [
      // Appearance governs the whole window, so it leads the group — the
      // three panels after it are named after the parts of the window rather
      // than after the settings, so the list answers "where do I change
      // this?" — which is how anyone arrives at this section.
      { id: 'appearance', label: 'Appearance', icon: 'color-mode' },
      { id: 'sidebar-left', label: 'Left sidebar', icon: 'layout-sidebar-left' },
      { id: 'center', label: 'Center panel', icon: 'layout-centered' },
      { id: 'sidebar-right', label: 'Right sidebar', icon: 'layout-sidebar-right' }
    ]
  },
  {
    // Its own heading rather than a line in General: everything here is
    // Mindex talking to something outside itself, and there is more of it
    // coming than the one that exists today.
    label: 'Integrations',
    items: [{ id: 'git', label: 'Git', icon: 'source-control' }]
  },
  {
    label: 'Other',
    items: [
      { id: 'hotkeys', label: 'Hotkeys', icon: 'keyboard' },
      { id: 'telemetry', label: 'Diagnostics', icon: 'pulse' }
    ]
  }
]

/**
 * Search index for the sidebar's filter box.
 *
 * Hand-written rather than derived from the rendered sections: a control's own
 * label is often not what you'd search for ("Wrap titles" vs "truncate"), and
 * scraping the tree would only ever find the section you already have open.
 * Each entry is one setting; `terms` carries the synonyms.
 *
 * Meant to cover every control in every section, so adding a setting means
 * adding a row here — nothing else keeps the two in step, and a missing row
 * fails silently as "no results" rather than as an error.
 */
const SEARCH_INDEX: Array<{ section: SectionId; label: string; terms: string }> = [
  // Appearance
  {
    section: 'appearance',
    label: 'Theme',
    terms: 'theme appearance dark light system colour color'
  },
  {
    section: 'appearance',
    label: 'Text size',
    terms: 'text size font zoom bigger smaller editor terminal cli chat'
  },

  {
    section: 'telemetry',
    label: 'This build',
    terms: 'build configuration configured analytics crash reports github keys missing integrations'
  },
  {
    section: 'about',
    label: 'Updates',
    terms: 'update updates version check now restart release'
  },

  // Hotkeys
  {
    section: 'hotkeys',
    label: 'Hotkeys',
    terms: 'keyboard shortcuts hotkeys keybindings find replace command palette save zoom'
  },

  // AI
  {
    section: 'engine',
    label: 'AI provider',
    terms: 'engine provider claude gemini codex openai cli connect detect install download recheck'
  },
  {
    section: 'engine',
    label: 'Models',
    // Every name these two choices have had stays searchable — 'auto context',
    // 'rewrites', 'inline editing' — because someone looking for one of them is
    // looking for this card whatever it is called this month.
    terms:
      'model models inline editing rewrite rewrites selection assistant context engine auto background opus sonnet haiku fable gpt luna terra flash lite recommended cheap context model'
  },
  {
    section: 'engine',
    label: 'Automation',
    terms:
      'automation auto manual when it runs schedule folder context living index link health dead links orphans background'
  },

  // Design — left sidebar
  {
    section: 'sidebar-left',
    label: 'Sort by',
    terms: 'display design sort order name date alphabetical newest oldest sorting tree'
  },
  {
    section: 'sidebar-left',
    label: 'Group',
    terms: 'display design group folders first files first sorting tree'
  },
  {
    section: 'sidebar-left',
    label: 'Reset icon overrides',
    terms: 'reset clear custom icons colours colors per file overrides'
  },
  {
    section: 'sidebar-left',
    label: 'Reset hidden files',
    terms: 'reset hidden shown files unhide manual show hide overrides'
  },

  // Design — center panel
  {
    section: 'center',
    label: 'Sort by',
    terms: 'display design sort order name date alphabetical newest oldest sorting cards'
  },
  {
    section: 'center',
    label: 'Group',
    terms: 'display design group folders first files first sorting cards'
  },

  // Design — right sidebar
  {
    section: 'sidebar-right',
    label: 'Chat UI or CLI',
    terms:
      'display design right panel view chat ui cli terminal default new tab surface interface layout'
  },

  // Workspace
  {
    section: 'vaults',
    label: 'Open a vault',
    terms: 'vault workspace open create folder switch recent'
  },
  { section: 'vaults', label: 'Remove from list', terms: 'remove forget recent vault list' },

  // Git
  {
    section: 'git',
    label: 'Repository',
    terms: 'git repository branch remote origin clone push pull commit'
  },
  {
    section: 'git',
    label: 'Identity',
    terms: 'git name email user config identity author credentials'
  },

  // Data
  {
    section: 'telemetry',
    label: 'Usage analytics',
    terms: 'analytics telemetry tracking posthog usage opt out consent'
  },
  {
    section: 'telemetry',
    label: 'Crash reports',
    terms: 'crash error report sentry diagnostics stack trace'
  },
  {
    section: 'telemetry',
    label: 'Never sent',
    terms: 'never sent private notes content privacy what we collect'
  },

  // About
  {
    section: 'about',
    label: 'Version & updates',
    terms: 'version update upgrade release build changelog'
  },
  { section: 'about', label: 'Developer', terms: 'developer author contact mindex.live website' },
  { section: 'about', label: 'Privacy Policy', terms: 'privacy policy data legal collect' },
  {
    section: 'about',
    label: 'Terms & Conditions',
    terms: 'terms conditions legal licence license'
  },
  {
    section: 'about',
    label: 'Report a bug',
    terms: 'bug report feedback issue feature request problem'
  }
]

const SECTION_LABEL = new Map<SectionId, string>(
  GROUPS.flatMap((g) => g.items.map((i) => [i.id, i.label] as [SectionId, string]))
)
const SECTION_ICON = new Map<SectionId, string>(
  GROUPS.flatMap((g) => g.items.map((i) => [i.id, i.icon] as [SectionId, string]))
)

export function SettingsDialog({ open, onOpenChange }: Props): JSX.Element {
  const [section, setSection] = useState<SectionId>('vaults')
  const [query, setQuery] = useState('')

  /**
   * Open on the screen the opener asked for.
   *
   * Help's "Keyboard shortcuts" and the palette's Settings commands name a
   * screen; without this they all landed on Vaults and left the person to go
   * find the one they had just asked for. Cleared on arrival so reopening the
   * window normally comes back where it was.
   */
  useEffect(() => {
    if (!open) return
    const wanted = useUiStore.getState().settingsSection
    if (!wanted) return
    setSection(wanted as SectionId)
    setQuery('')
    useUiStore.getState().setSettingsSection(null)
  }, [open])
  // Matches the AI section's own header — its icon in the sidebar is that
  // provider's mark, not a fixed codicon, so the two agree at a glance.

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return null
    return SEARCH_ENTRIES.filter(
      (e) =>
        e.label.toLowerCase().includes(q) ||
        e.terms.includes(q) ||
        (SECTION_LABEL.get(e.section) ?? '').toLowerCase().includes(q)
    )
  }, [query])

  return (
    <StandardDialog
      open={open}
      onOpenChange={onOpenChange}
      icon="settings-gear"
      title="Settings"
      noHeader
      bleed
      width={846}
      height={612}
    >
      <div className="flex h-full min-h-0">
        {/* Scrolling moved off the nav and onto the list alone. Left on the
            nav, a long list would carry the account block away with it instead
            of leaving it pinned at the bottom. */}
        <nav className="flex w-[232px] shrink-0 flex-col border-r border-bd-3 bg-bg-3 px-2.5 py-3">
          <div className="relative mb-1">
            <Icon
              name="search"
              size={12}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search settings"
              spellCheck={false}
              className="h-8 w-full rounded-[10px] border border-border-strong bg-transparent pl-[26px] pr-6 text-[12px] text-foreground outline-none transition-colors placeholder:text-c-2/60 focus:border-accent-1/60"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 inline-flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-[5px] text-muted-foreground hover:bg-bg-3 hover:text-foreground"
              >
                <Icon name="close" size={10} />
              </button>
            ) : null}
          </div>

          <div className="scroll-plain min-h-0 flex-1 overflow-y-auto">
            {results ? (
              results.length === 0 ? (
                <p className="px-2.5 py-3 text-[11px] text-muted-foreground/70">
                  No settings match “{query.trim()}”.
                </p>
              ) : (
                <div className="space-y-0.5 pt-1">
                  {results.map((r) => (
                    <button
                      key={`${r.section}:${r.label}`}
                      type="button"
                      onClick={() => {
                        setSection(r.section)
                        setQuery('')
                      }}
                      className="flex w-full items-center gap-1.5 rounded-[10px] px-2.5 py-[7px] text-left text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
                    >
                      <Icon name={SECTION_ICON.get(r.section) ?? 'gear'} size={15} />
                      <span className="min-w-0 flex-1 truncate text-[13px]">{r.label}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground/60">
                        {SECTION_LABEL.get(r.section)}
                      </span>
                    </button>
                  ))}
                </div>
              )
            ) : (
              <div className="space-y-0.5">
                {GROUPS.map((g) => (
                  <div key={g.label} className="space-y-0.5">
                    <GroupLabel>{g.label}</GroupLabel>
                    {g.items.map((it) => (
                      <NavItem
                        key={it.id}
                        icon={it.icon}
                        label={it.label}
                        active={section === it.id}
                        onClick={() => setSection(it.id)}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </nav>

        <div className="scroll-plain relative min-h-0 min-w-0 flex-1 overflow-auto">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
            className={cn(DIALOG_CLOSE_BTN, 'absolute right-4 top-4 z-pane')}
          >
            <Icon name="close" size={14} />
          </button>

          {section === 'vaults' ? <VaultsSection /> : null}
          {section === 'git' ? <GitSection /> : null}
          {section === 'engine' ? <EngineSection /> : null}
          {section === 'appearance' ? <AppearanceSection /> : null}
          {section === 'sidebar-left' ? <LeftSidebarSection /> : null}
          {section === 'center' ? <CenterPanelSection /> : null}
          {section === 'sidebar-right' ? <RightSidebarSection /> : null}
          {section === 'hotkeys' ? <HotkeysSection /> : null}
          {section === 'telemetry' ? <TelemetrySection /> : null}
          {section === 'about' ? <AboutSection /> : null}
        </div>
      </div>
    </StandardDialog>
  )
}

function tildifyPath(p: string): string {
  return p.replace(/^\/Users\/([^/]+)/, '~').replace(/^\/home\/([^/]+)/, '~')
}

function VaultsSection(): JSX.Element {
  // No per-vault settings are read here any more — this screen is the list of
  // vaults and nothing else.
  const vault = useVaultStore((s) => s.vault)
  const recent = useVaultStore((s) => s.recent)
  const openVault = useVaultStore((s) => s.openVault)
  const removeRecentVault = useVaultStore((s) => s.removeRecentVault)
  const removeOpenWorkspace = useVaultStore((s) => s.removeOpenWorkspace)
  const closeVault = useVaultStore((s) => s.closeVault)
  const loading = useVaultStore((s) => s.loading)
  const [pendingRemove, setPendingRemove] = useState<RecentVault | null>(null)
  const removingCurrent = !!pendingRemove && vault?.root === pendingRemove.root

  const list = useMemo(() => {
    const items = [...recent]
    if (vault && !items.some((v) => v.root === vault.root)) {
      items.unshift({ root: vault.root, name: vault.name, lastOpened: Date.now() })
    }
    return items
  }, [recent, vault])

  return (
    <SectionShell title="Vaults" icon="folder-opened">
      <Card title="Your vaults">
        {list.length === 0 ? (
          <BlockRow>
            <p className="text-12 text-c-2">No vaults yet. Open a folder to get started.</p>
          </BlockRow>
        ) : (
          // A gap between the boxes, not just between the words in them. Each
          // row's own padding is inside its fill, so the filled rectangles met
          // edge to edge and the list read as one block with lines drawn in it.
          <div className="space-y-1">
            {list.map((v) => (
              <VaultRow
                key={v.root}
                vault={v}
                current={vault?.root === v.root}
                busy={loading}
                onOpen={() => void openVault(v.root)}
                onRemove={() => setPendingRemove(v)}
              />
            ))}
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={pendingRemove !== null}
        title={`Remove “${pendingRemove?.name ?? ''}” from this list?`}
        message={
          <>
            This only removes the vault from Mindex&rsquo;s list.{' '}
            <strong className="text-foreground">Nothing on disk is deleted</strong> — the folder and
            every note in it stay exactly where they are, and you can open it again at any time.
            {removingCurrent ? (
              <> Since it is the vault you have open, Mindex will close it.</>
            ) : null}
          </>
        }
        confirmLabel="Remove from list"
        confirmIcon="trash"
        destructive
        zIndex={80}
        onCancel={() => setPendingRemove(null)}
        onConfirm={() => {
          const target = pendingRemove
          setPendingRemove(null)
          if (!target) return
          void (async () => {
            await removeRecentVault(target.root)
            await removeOpenWorkspace(target.root)
            if (vault?.root === target.root) await closeVault()
          })()
        }}
      />
    </SectionShell>
  )
}

/**
 * Left sidebar — everything that shapes a file-tree row.
 *
 * This was seven stacked Switches and two dropdowns: a wall of prose where
 * every option looked identical. Same settings, chip-sized controls. The date
 * sub-choices stay hidden until Date is on, since they mean nothing otherwise.
 */
/**
 * Reads and writes `fileDisplay`, so the left-sidebar and centre-panel cards
 * below share one copy of it rather than two schemas that could disagree —
 * see `VaultSettings.fileDisplay`'s own comment. This used to be two hooks
 * (`useTreeRowDetails` writing `treeRowDetails`, `useFolderViewSetting`
 * writing `folderView`); merging what they wrote without merging the hooks
 * that write it would have left the duplication exactly where it always was.
 */
function useFileDisplaySetting(): [
  FileDisplaySettings,
  (p: Partial<FileDisplaySettings>) => void,
  () => void
] {
  const [fd, setFd] = useState<FileDisplaySettings>(DEFAULT_FILE_DISPLAY)
  useEffect(() => {
    void (async () => {
      const r = await api().settings.getVault()
      if (r.ok && r.data) setFd({ ...DEFAULT_FILE_DISPLAY, ...(r.data.fileDisplay ?? {}) })
    })()
  }, [])

  function write(next: FileDisplaySettings): void {
    const previous = fd
    setFd(next)
    void (async () => {
      const r = await api().settings.setVault({ fileDisplay: next })
      if (!r.ok) {
        // The write genuinely failed (a corrupted settings file, a disk
        // error, …) — snapping the toggle back is the only honest option;
        // leaving it showing "on" while nothing persisted is exactly the
        // silent-failure bug this used to have.
        pushToast(`That setting could not be saved. ${r.error ?? ''}`.trim())
        setFd(previous)
        return
      }
      window.dispatchEvent(new CustomEvent(FILE_DISPLAY_EVENT))
      useUiStore.getState().setShowFileIcons(next.showFileIcons !== false)
      useUiStore.getState().setShowFolderIcons(next.showFolderIcons !== false)
    })()
  }

  return [fd, (p) => write({ ...fd, ...p }), () => write(DEFAULT_FILE_DISPLAY)]
}

const SIZE_OPTIONS = [
  { value: 'normal' as const, icon: 'list-selection', label: 'Normal' },
  { value: 'compact' as const, icon: 'list-flat', label: 'Compact' }
]

/**
 * Order and grouping, which one setting drives in both panes.
 *
 * Shown on the left-sidebar screen and the centre-panel screen, because it
 * genuinely governs both — hiding it on one would make that pane look as
 * though it could not be sorted. The line under the title says which other
 * screen moves with it, so changing it in one place is not a surprise in the
 * other.
 */
function SortingCard({ other }: { other: string }): JSX.Element {
  /**
   * Written through the store both panes already read, not straight to disk.
   *
   * Writing the file and firing the tree's refresh event did reach the centre
   * pane, but only the long way round — the tree refetched, re-hydrated this
   * store, and the grid followed. That works while the tree is on screen and
   * silently stops when it is not. Through the store, both panes move on the
   * same tick and persistence is the store's business, as it is everywhere
   * else these two values are set.
   */
  const sortBy = useTreeSortStore((s) => s.sortBy)
  const group = useTreeSortStore((s) => s.group)
  const setSortBy = useTreeSortStore((s) => s.setSortBy)
  const setGroup = useTreeSortStore((s) => s.setGroup)

  return (
    <Card
      title="Sorting"
      action={
        <IconButton
          icon="debug-restart"
          label="Reset"
          confirm={{
            title: 'Reset sorting?',
            message: 'Order and grouping go back to A→Z, folders first.'
          }}
          onClick={() => {
            setSortBy('name-asc')
            setGroup('folders-first')
          }}
        />
      }
    >
      <Row
        label="Order"
        hint={`How rows are sorted. One order, shared with the ${other}.`}
        control={
          <Segmented<NonNullable<VaultSettings['treeSort']>>
            value={sortBy}
            onChange={setSortBy}
            options={[
              { value: 'name-asc', icon: 'arrow-down', label: 'A→Z' },
              { value: 'name-desc', icon: 'arrow-up', label: 'Z→A' },
              { value: 'mtime-desc', icon: 'history', label: 'Newest' },
              { value: 'mtime-asc', icon: 'history', label: 'Oldest' }
            ]}
          />
        }
      />
      <Row
        label="Group"
        hint={`Whether folders sit above the files or below them. Also shared with the ${other}.`}
        control={
          <Segmented<NonNullable<VaultSettings['treeGroup']>>
            value={group}
            onChange={setGroup}
            options={[
              { value: 'folders-first', icon: 'folder', label: 'Folders first' },
              { value: 'files-first', icon: 'file', label: 'Files first' }
            ]}
          />
        }
      />
    </Card>
  )
}

// --- Git group ---------------------------------------------------------

/**
 * Read-only. Mindex shells out to the system `git` binary for everything
 * (see src/main/git/) — identity and credentials live entirely in the
 * user's own git config, this screen just shows what it found.
 */
function GitSection(): JSX.Element {
  const vault = useVaultStore((s) => s.vault)
  const isRepo = useGitStatusStore((s) => s.snapshot?.isRepo ?? false)
  const gitAvailable = useGitStatusStore((s) => s.snapshot?.gitAvailable ?? true)
  const branch = useGitStatusStore((s) => s.snapshot?.branch ?? null)
  const [info, setInfo] = useState<GitInfo | null>(null)
  const syncStatus = useSyncStatus()
  const [syncBusy, setSyncBusy] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)

  useEffect(() => {
    setInfo(null)
    if (!vault) return
    void api()
      .git.info()
      .then((r) => {
        if (r.ok && r.data) setInfo(r.data)
      })
  }, [vault?.root])

  const mode: SyncMode = syncStatus?.mode ?? 'off'

  async function setMode(next: SyncMode): Promise<void> {
    setSyncBusy(true)
    try {
      await api().sync.setMode(next)
    } finally {
      setSyncBusy(false)
    }
  }

  return (
    <SectionShell
      title="Git"
      icon="source-control"
      description="Version history for the whole vault, kept by git itself. Mindex drives it; it does not replace it."
    >
      <Card title="Repository">
        {!vault ? (
          <BlockRow hint="No vault open.">
            <span />
          </BlockRow>
        ) : !gitAvailable ? (
          // Said before anything is offered, because nothing here can work:
          // git is not something Mindex ships, it is a program the machine
          // either has or does not. Offering to publish first and failing at
          // the end — after a name and a visibility had been chosen — is what
          // used to happen, because a missing git and an untracked vault gave
          // the same answer.
          <Row
            label="Git isn't installed"
            hint="Version history and GitHub publishing both run the git program, and this machine doesn't have it. Install it and it will be picked up on its own."
            control={
              <ActionButton
                icon="link-external"
                onClick={() => window.open('https://git-scm.com/downloads', '_blank')}
              >
                Get git
              </ActionButton>
            }
          />
        ) : !isRepo ? (
          // A statement of fact with nothing to do about it was the whole of
          // this card when a vault was not tracked. The thing a person wants
          // there is the way in, so the row carries it.
          <Row
            label="Connect to GitHub"
            hint="Creates a repository for this vault and pushes the first commit. No terminal needed."
            control={
              <ActionButton icon="github" onClick={() => setPublishOpen(true)}>
                Set up syncing
              </ActionButton>
            }
          />
        ) : (
          <>
            <GitInfoRow
              label="Branch"
              value={branch?.detached ? '(detached HEAD)' : (branch?.name ?? '—')}
            />
            <GitInfoRow label="Remote" value={info?.remoteUrl ?? '—'} />
          </>
        )}
      </Card>

      {/* Moved here from the Source Control window's header, where it sat
          between Pull and Push looking like a third button. It is a standing
          choice about what happens without anyone asking — which is a
          setting, and settings are read before they are used, not clicked
          past on the way to committing. */}
      {gitAvailable ? (
        <Card title="Automatic sync">
          <Row
            label="What happens on its own"
            hint="Off is the default and stays it for every vault that already exists. Pulling brings other people's changes in; pushing sends yours out without being asked."
            control={
              <Segmented<SyncMode>
                value={mode}
                onChange={(v) => void setMode(v)}
                options={[
                  { value: 'off', icon: 'circle-slash', label: 'Nothing' },
                  { value: 'follow', icon: 'repo-pull', label: 'Pull' },
                  { value: 'full', icon: 'sync', label: 'Pull & push' }
                ]}
              />
            }
            disabled={syncBusy || !isRepo}
          />
        </Card>
      ) : null}

      {gitAvailable ? (
        <Card title="Identity">
          <GitInfoRow label="Name" value={info?.userName ?? 'Not set'} />
          <GitInfoRow label="Email" value={info?.userEmail ?? 'Not set'} />
          <GitInfoRow label="git version" value={info?.version ?? '—'} />
        </Card>
      ) : null}

      {isRepo && gitAvailable ? (
        // Also moved out of the window's header, where a button that deletes
        // every commit stood next to Pull and Push at the same size.
        <Card title="Stop tracking">
          <Row
            label="Remove this vault's repository"
            hint="Deletes the .git folder and every commit in it. Your notes and files are left exactly as they are on disk."
            control={
              <ActionButton icon="trash" tone="danger" onClick={() => setConfirmRemove(true)}>
                Stop tracking
              </ActionButton>
            }
          />
        </Card>
      ) : null}

      <PublishToGitHubDialog open={publishOpen} onOpenChange={setPublishOpen} />

      <ConfirmDialog
        open={confirmRemove}
        title="Stop tracking with Git?"
        message={
          <p>
            This deletes this vault&apos;s <span className="font-mono text-foreground">.git</span>{' '}
            folder and all of its commit history. Your notes and files are left untouched. This
            cannot be undone.
          </p>
        }
        confirmLabel="Stop tracking"
        confirmIcon="trash"
        destructive
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => {
          setConfirmRemove(false)
          void api().git.remove()
        }}
      />
    </SectionShell>
  )
}

/**
 * A fact rather than a setting — the same row shape, with the value where the
 * control would be.
 *
 * These read as settings whether or not they are editable here, so they line
 * up with the ones that are. A screen where half the rows are one shape and
 * half are another reads as two screens.
 */
function GitInfoRow({
  label,
  value,
  hint
}: {
  label: string
  value: string
  hint?: string
}): JSX.Element {
  return (
    <Row
      label={label}
      hint={hint}
      control={
        <span className="max-w-[260px] truncate font-mono text-11.5 text-c-2" title={value}>
          {value}
        </span>
      }
    />
  )
}

/**
 * The one setting that isn't scoped to a single pane — everything else in
 * "Design" answers "where do I change this?" about one part of the window;
 * this answers it for the window itself, which is why it leads the group.
 */
function AppearanceSection(): JSX.Element {
  const theme = useUiStore((s) => s.settings?.theme) ?? 'dark'

  async function choose(next: 'dark' | 'light' | 'system'): Promise<void> {
    if (next === theme) return
    const r = await api().settings.setApp({ theme: next })
    if (r.ok && r.data) useUiStore.setState({ settings: r.data })
  }

  return (
    <SectionShell title="Appearance" icon="color-mode">
      <Card title="Theme">
        <BlockRow
          label="Colours"
          hint="Applies to the whole window, not just this dialog. System follows the one your machine is set to."
        >
          <div className="grid grid-cols-3 gap-2.5">
            {THEME_CHOICES.map((c) => (
              <ThemeTile
                key={c.value}
                choice={c}
                active={theme === c.value}
                onPick={() => void choose(c.value)}
              />
            ))}
          </div>
        </BlockRow>
      </Card>
      <TextSizeCard />
    </SectionShell>
  )
}

/**
 * The three themes, shown rather than named.
 *
 * They were three words in a segmented control, which is the one control shape
 * that cannot say what it is offering: the whole content of the choice is what
 * the window will look like, and a word is the least direct way to tell
 * someone that. Each tile draws a miniature of the app in that theme, so the
 * choice is made by looking at it.
 *
 * The colours below are literal, not tokens, and that is the point: the dark
 * tile has to look dark while the app is in the light theme, so these cannot
 * follow the theme the way everything else does. They are the real values from
 * both palettes, copied — `globals.css` is the source, and if a palette moves
 * far these should be brought along.
 */
const THEME_PALETTE = {
  dark: { page: '#1a1a1b', panel: '#0e0f0f', line: '#3b3d3e', lineSoft: '#2b2d2e' },
  light: { page: '#ffffff', panel: '#f1f3f5', line: '#d5d9dd', lineSoft: '#e7eaed' }
} as const

type ThemeValue = 'dark' | 'light' | 'system'

const THEME_CHOICES: ReadonlyArray<{ value: ThemeValue; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
]

/**
 * A screen, a sun and a moon — drawn here rather than taken from the icon set,
 * which has neither a sun nor a moon. Two filled circles standing in for light
 * and dark said nothing on their own; these are the marks everyone already
 * reads as day and night.
 *
 * Plain SVG stroked in `currentColor`, so it follows the label beside it the
 * way the rest of the app's marks do.
 */
function ThemeGlyph({ value }: { value: ThemeValue }): JSX.Element {
  const common = {
    width: 14,
    height: 14,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    className: 'shrink-0'
  }
  if (value === 'light') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2.6v2.1M12 19.3v2.1M21.4 12h-2.1M4.7 12H2.6M18.6 5.4l-1.5 1.5M6.9 17.1l-1.5 1.5M18.6 18.6l-1.5-1.5M6.9 6.9L5.4 5.4" />
      </svg>
    )
  }
  if (value === 'dark') {
    return (
      <svg {...common}>
        <path d="M20.5 14.4A8.6 8.6 0 1 1 9.6 3.5a6.9 6.9 0 0 0 10.9 10.9Z" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <rect x="2.8" y="4.2" width="18.4" height="12.4" rx="2" />
      <path d="M9 20.2h6M12 16.6v3.6" />
    </svg>
  )
}

/** One miniature window: a side panel of short lines, and a page of long ones. */
function ThemeMock({ palette }: { palette: (typeof THEME_PALETTE)[keyof typeof THEME_PALETTE] }) {
  const bar = (w: string, soft?: boolean): JSX.Element => (
    <div
      className="h-[4px] rounded-full"
      style={{ width: w, background: soft ? palette.lineSoft : palette.line }}
    />
  )
  return (
    <div className="flex h-full w-full gap-2 p-2.5" style={{ background: palette.page }}>
      <div
        className="flex w-[34%] flex-col gap-1.5 rounded-6 p-2"
        style={{ background: palette.panel }}
      >
        {bar('80%')}
        {bar('60%')}
        {bar('70%', true)}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 pt-1">
        {bar('55%')}
        {bar('90%', true)}
        {bar('75%', true)}
        {bar('85%', true)}
      </div>
    </div>
  )
}

function ThemeTile({
  choice,
  active,
  onPick
}: {
  choice: { value: ThemeValue; label: string }
  active: boolean
  onPick(): void
}): JSX.Element {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onPick}
      className={cn(
        'flex flex-col gap-2.5 rounded-12 border p-2 text-left transition-colors',
        pickerOption(active)
      )}
    >
      <div className="relative aspect-[16/11] overflow-hidden rounded-8">
        <div className="absolute inset-0">
          <ThemeMock palette={THEME_PALETTE[choice.value === 'light' ? 'light' : 'dark']} />
        </div>
        {/* System shows both, cut down the middle — the one choice whose
            meaning is "whichever of these two your machine is on". The two
            copies share their geometry, so the seam falls through a single
            continuous drawing rather than butting two different ones. */}
        {choice.value === 'system' ? (
          <div className="absolute inset-0" style={{ clipPath: 'inset(0 0 0 52%)' }}>
            <ThemeMock palette={THEME_PALETTE.light} />
          </div>
        ) : null}
        {active ? (
          <span className="absolute right-2 top-2 inline-flex h-4 w-4 items-center justify-center rounded-full bg-accent-1">
            <Icon name="check" size={9} className="!text-white" />
          </span>
        ) : null}
      </div>
      <span className="flex items-center gap-[5.5px] text-12.5 text-c-1">
        <ThemeGlyph value={choice.value} />
        {choice.label}
      </span>
    </button>
  )
}

/**
 * The three text sizes, in one place.
 *
 * All three were already stored, persisted and applied — the editor even had
 * keyboard shortcuts for its own. What was missing was anywhere to see them:
 * the terminal's and the chat's could only be changed by editing the settings
 * file, which is not a setting so much as a hidden one.
 */
function TextSizeCard(): JSX.Element {
  const editor = useUiStore((s) => s.editorFontSize)
  const cli = useUiStore((s) => s.cliFontSize)
  const chat = useUiStore((s) => s.chatFontSize)
  const setEditor = useUiStore((s) => s.setEditorFontSize)
  const setCli = useUiStore((s) => s.setCliFontSize)
  const setChat = useUiStore((s) => s.setChatFontSize)

  return (
    <Card
      title="Text size"
      action={
        <IconButton
          icon="debug-restart"
          label="Reset text sizes"
          onClick={() => {
            setEditor(EDITOR_FONT_SIZE_DEFAULT)
            setCli(CLI_FONT_SIZE_DEFAULT)
            setChat(CHAT_FONT_SIZE_DEFAULT)
          }}
          confirm={{
            title: 'Reset text sizes?',
            message: 'Editor, terminal and chat all go back to their shipped sizes.'
          }}
        />
      }
    >
      <Row
        label="Editor"
        hint="Notes, in both the written and the rendered view. Also ⌘⇧+ / ⌘⇧− / ⌘⇧0."
        control={
          <Stepper
            label="Editor text size"
            value={editor}
            min={EDITOR_FONT_SIZE_MIN}
            max={EDITOR_FONT_SIZE_MAX}
            unit="px"
            onChange={setEditor}
          />
        }
      />
      <Row
        label="Terminal"
        hint="The command line at the bottom of the window."
        control={
          <Stepper
            label="Terminal text size"
            value={cli}
            min={CLI_FONT_SIZE_MIN}
            max={CLI_FONT_SIZE_MAX}
            unit="px"
            onChange={setCli}
          />
        }
      />
      <Row
        label="Chat"
        hint="Messages in the assistant panel."
        control={
          <Stepper
            label="Chat text size"
            value={chat}
            min={CHAT_FONT_SIZE_MIN}
            max={CHAT_FONT_SIZE_MAX}
            unit="px"
            onChange={setChat}
          />
        }
      />
    </Card>
  )
}

/**
 * The file tree, on its own screen.
 *
 * Display used to be one screen grouped by subject — one Dates card holding
 * both panes' dates, one Icons card holding both panes' icons. It read well but
 * answered the wrong question: nobody arrives wanting "dates", they arrive
 * wanting the sidebar to look different. Split by pane, each screen is one
 * surface you can see while you change it.
 */
/**
 * How a row looks in the tree, declared.
 *
 * Dates, icons and density used to be three cards. They were never three
 * questions — each is "how does a row look" — so one card with a hairline
 * between its topics reads as the single subject it is, and one Reset undoes
 * all three together.
 */
const TREE_ROW_APPEARANCE: SettingGroup<FileDisplaySettings> = {
  title: 'Appearance',
  alsoFoundBy: 'display design sidebar tree row density preview excerpt',
  reset: {
    modified: DEFAULT_FILE_DISPLAY.modified,
    dateField: DEFAULT_FILE_DISPLAY.dateField,
    datePosition: DEFAULT_FILE_DISPLAY.datePosition,
    showFileIcons: DEFAULT_FILE_DISPLAY.showFileIcons,
    showFolderIcons: DEFAULT_FILE_DISPLAY.showFolderIcons,
    showServiceFileIcons: DEFAULT_FILE_DISPLAY.showServiceFileIcons,
    preview: DEFAULT_FILE_DISPLAY.preview,
    wrapTitle: DEFAULT_FILE_DISPLAY.wrapTitle
  },
  resetConfirm: {
    title: 'Reset appearance?',
    message:
      'Dates, icons and row density all go back to their defaults. Per-file icon overrides are kept.'
  },
  rows: [
    {
      kind: 'toggle',
      label: 'Date',
      field: 'modified',
      icon: 'history',
      hint: 'Adds a timestamp to every row in the sidebar.'
    },
    // Only offered once rows actually show a date — otherwise it asks which of
    // two dates to display where none is displayed.
    {
      kind: 'choice',
      label: 'Which date',
      field: 'dateField',
      whenUnset: 'created',
      options: [
        { value: 'created', icon: 'add', label: 'Created' },
        { value: 'modified', icon: 'edit', label: 'Modified' }
      ],
      showIf: (s) => !!s.modified
    },
    {
      kind: 'choice',
      label: 'Position',
      field: 'datePosition',
      whenUnset: 'inline',
      options: [
        { value: 'inline', icon: 'arrow-right', label: 'Same line' },
        { value: 'below', icon: 'arrow-down', label: 'Below' }
      ],
      showIf: (s) => !!s.modified
    },
    {
      kind: 'tiles',
      label: 'Icons',
      items: [
        {
          field: 'showFileIcons',
          icon: 'file',
          label: 'Files',
          hint: 'Show the leading icon on file rows.',
          whenUnset: true
        },
        {
          field: 'showFolderIcons',
          icon: 'folder',
          label: 'Folders',
          hint: 'Show the leading icon on folder rows.',
          whenUnset: true
        },
        {
          field: 'showServiceFileIcons',
          icon: 'gear',
          label: 'Service files',
          hint: 'Show the leading icon on managed files (AGENTS.md, …).',
          whenUnset: true
        }
      ]
    },
    {
      kind: 'tiles',
      label: 'Density',
      items: [
        {
          field: 'preview',
          icon: 'note',
          label: 'Preview',
          hint: 'Shows the first lines of the note under its name.'
        },
        {
          field: 'wrapTitle',
          icon: 'word-wrap',
          label: 'Wrap titles',
          hint: 'Break long file names onto a second line instead of truncating.'
        }
      ]
    }
  ]
}

function LeftSidebarSection(): JSX.Element {
  const [row, patchRow] = useFileDisplaySetting()

  return (
    <SectionShell title="Left sidebar" icon="layout-sidebar-left">
      <SortingCard other="center panel" />
      <DeclaredCard group={TREE_ROW_APPEARANCE} state={row} patch={patchRow} />
      {/* Both overrides are set from the tree's context menu, so the place to
          undo them in bulk is the tree's own screen. */}
      <TreeOverridesCard />
    </SectionShell>
  )
}

/**
 * How a card looks in the middle of the window, declared.
 *
 * Dates and icons are the same switch wherever it is flipped — one store, two
 * screens (see `fileDisplay`'s own comment). Card size is this screen's own,
 * since a card and a tree row are shaped nothing alike.
 */
const CARD_APPEARANCE: SettingGroup<FileDisplaySettings> = {
  title: 'Appearance',
  alsoFoundBy: 'display design center panel card grid compact normal',
  reset: {
    modified: DEFAULT_FILE_DISPLAY.modified,
    dateField: DEFAULT_FILE_DISPLAY.dateField,
    showFileIcons: DEFAULT_FILE_DISPLAY.showFileIcons,
    showFolderIcons: DEFAULT_FILE_DISPLAY.showFolderIcons,
    fileCardSize: DEFAULT_FILE_DISPLAY.fileCardSize,
    folderChipSize: DEFAULT_FILE_DISPLAY.folderChipSize
  },
  resetConfirm: {
    title: 'Reset appearance?',
    message:
      "Dates, icons and card size all go back to their defaults. This also resets the left sidebar's dates and icons, which are the same setting."
  },
  rows: [
    {
      kind: 'toggle',
      label: 'Date',
      field: 'modified',
      icon: 'history',
      hint: 'Adds a date under each card title. Shared with the left sidebar.'
    },
    {
      kind: 'choice',
      label: 'Which date',
      field: 'dateField',
      whenUnset: 'created',
      options: [
        { value: 'created', icon: 'add', label: 'Created' },
        { value: 'modified', icon: 'edit', label: 'Modified' }
      ],
      showIf: (s) => !!s.modified
    },
    {
      kind: 'tiles',
      label: 'Icons',
      items: [
        {
          field: 'showFileIcons',
          icon: 'file',
          label: 'Files',
          hint: 'Show the icon on file cards. Shared with the left sidebar.',
          whenUnset: true
        },
        {
          field: 'showFolderIcons',
          icon: 'folder',
          label: 'Folders',
          hint: 'Show the icon on folder cards. Shared with the left sidebar.',
          whenUnset: true
        }
      ]
    },
    {
      kind: 'choice',
      label: 'File card size',
      field: 'fileCardSize',
      whenUnset: 'normal',
      options: SIZE_OPTIONS
    },
    {
      kind: 'choice',
      label: 'Folder card size',
      field: 'folderChipSize',
      whenUnset: 'normal',
      options: SIZE_OPTIONS
    }
  ]
}

/** The grid of file and folder cards that fills the middle of the window. */
function CenterPanelSection(): JSX.Element {
  const [fd, patchFd] = useFileDisplaySetting()

  return (
    <SectionShell title="Center panel" icon="layout-centered">
      <SortingCard other="left sidebar" />
      <DeclaredCard group={CARD_APPEARANCE} state={fd} patch={patchFd} />
    </SectionShell>
  )
}

function RightSidebarSection(): JSX.Element {
  const settings = useUiStore((s) => s.settings)
  const provider = settings?.engine?.provider ?? 'claude'
  const view = settings?.defaultView ?? 'chat'
  const hasProvider = useHasProvider()

  async function choose(next: PanelView): Promise<void> {
    // No toggle-off here, unlike first-run: a tab has to open as something, so
    // clicking the chosen card is a no-op rather than a way to clear it.
    if (next === view) return
    const r = await api().settings.setApp({ defaultView: next })
    if (r.ok && r.data) useUiStore.setState({ settings: r.data })
    // The tab store keeps its own copy, read once when the vault loads.
    setDefaultView(next)
  }

  return (
    <SectionShell title="Right sidebar" icon="layout-sidebar-right">
      <Card title="View">
        {/* Both previews in `ViewPicker` show what an assistant answers with —
            there is nothing to preview without one. Different content, not a
            dimmed picker: choosing between two things neither of which can
            open yet is not a real choice. No action button — the AI section
            that fixes this is one click away in the same list on the left. */}
        {/* The first-run step's own words, plus the one thing that step did
            not have to say: this changes the next tab, not the open one. */}
        <BlockRow hint="Both run the same CLI — pick the surface you prefer. New tabs open this way.">
          {hasProvider ? (
            <ViewPicker provider={provider} value={view} onSelect={(v) => void choose(v)} />
          ) : (
            <ProviderRequiredNotice
              className="py-3"
              message="Connect an assistant in the AI section first — both views need one."
            />
          )}
        </BlockRow>
      </Card>
    </SectionShell>
  )
}

/**
 * Bulk escape hatch for the two things you can otherwise only change one file
 * at a time from a tree context menu, with no way to see how many you have set
 * or undo them together.
 *
 * Both rows are always shown, at zero too — the card used to vanish entirely
 * when empty, which made "where did my reset go?" a real question. The count
 * is the subject of each row, so it leads.
 */
function TreeOverridesCard(): JSX.Element {
  const iconOverrides = useUiStore((s) => s.iconOverrides)
  const iconColorOverrides = useUiStore((s) => s.iconColorOverrides)
  const userHidden = useHiddenFilesStore((s) => s.userHidden)
  const userUnhidden = useHiddenFilesStore((s) => s.userUnhidden)

  const iconCount = Object.keys(iconOverrides).length + Object.keys(iconColorOverrides).length
  const hiddenCount = userHidden.size + userUnhidden.size

  async function clearIcons(): Promise<void> {
    useUiStore.setState({ iconOverrides: {}, iconColorOverrides: {} })
    await api().settings.setVault({ iconOverrides: {}, iconColorOverrides: {} })
  }

  async function clearHidden(): Promise<void> {
    useHiddenFilesStore.getState().reset()
    await api().settings.setVault({ treeHiddenPaths: [], treeUnhiddenPaths: [] })
  }

  return (
    <Card title="Per-file overrides">
      <OverrideRow
        label="Custom icons & colours"
        count={iconCount}
        confirm={{
          title: 'Clear custom icons & colours?',
          message: `${iconCount} per-file ${iconCount === 1 ? 'override' : 'overrides'} will be removed. This cannot be undone.`
        }}
        onReset={() => void clearIcons()}
      />
      <OverrideRow
        label="Manual show / hide"
        count={hiddenCount}
        confirm={{
          title: 'Clear manual show / hide?',
          message: `${hiddenCount} per-file ${hiddenCount === 1 ? 'override' : 'overrides'} will be removed. This cannot be undone.`
        }}
        onReset={() => void clearHidden()}
      />
    </Card>
  )
}

/**
 * A link that goes somewhere outside the app, in the same row shape.
 *
 * The whole row is the target, so the thing you click is the thing you read
 * rather than a word inside it, and the arrow at the right sits where every
 * other row's control sits — which is what keeps the column of right edges
 * unbroken through a card that has no controls in it at all.
 */
/**
 * One vault, in the same row shape as everything else.
 *
 * It was a two-column grid of bordered cards. Boxes drawn on a page that no
 * longer draws boxes, in a layout that halved the width available to a path —
 * and a path is the one thing here that genuinely needs the width, since it is
 * how you tell two folders with the same name apart. As a row it gets the full
 * line, and the list grows downwards instead of reflowing.
 *
 * The one that is open is marked by its icon and a word, not by a tinted
 * border. A border tint has to be learned; "Current" does not.
 */
function VaultRow({
  vault,
  current,
  busy,
  onOpen,
  onRemove
}: {
  vault: RecentVault
  current: boolean
  busy: boolean
  onOpen(): void
  onRemove(): void
}): JSX.Element {
  const rootLook = useFolderLook('', vault.name)
  const openIconPicker = useIconPickerStore((s) => s.open)
  return (
    // The hover fill belongs to the whole row, not to the part of it that
    // switches vaults. It used to stop short of the trash can, so the button
    // sat outside the very shape that was meant to be pointing at it — the
    // row lit up and the only control in it stayed on the page behind.
    <div
      className={cn(
        // The border is on both states, transparent when this is not the open
        // vault, so the row does not grow by two pixels when it becomes one.
        'group -mx-3 flex items-center justify-between gap-2 rounded-r2 border px-3 py-2 transition-colors',
        current ? PICKER_SELECTED : 'border-transparent hover:bg-bg-2'
      )}
    >
      {/* The open vault's mark is a button of its own: it is the workspace's
          icon everywhere else in the app — breadcrumb, tree, graph — and this
          is where a person comes to change it. A vault that is not open has
          no icons loaded, so there is nothing to change there. */}
      {current ? (
        <button
          type="button"
          onClick={() => openIconPicker({ key: '', label: vault.name })}
          title="Change this workspace's icon"
          aria-label="Change this workspace's icon"
          className="shrink-0 rounded-6 p-0.5 transition-colors hover:bg-bg-3"
        >
          <Icon
            name={rootLook.icon ?? 'folder-library'}
            size={15}
            className={rootLook.colorClass ?? 'codicon-grey'}
          />
        </button>
      ) : null}
      <button
        type="button"
        disabled={current || busy}
        onClick={onOpen}
        title={current ? vault.root : `Switch to ${vault.name}`}
        className={cn(
          'flex min-w-0 items-center gap-2.5 text-left',
          current ? 'cursor-default' : 'cursor-pointer'
        )}
      >
        {current ? null : <Icon name="folder" size={15} className="shrink-0 codicon-muted" />}
        <span className="min-w-0">
          <span className="block truncate text-12.5 text-c-1">{vault.name}</span>
          <span className="mt-0.5 block truncate font-mono text-11 text-c-2">
            {tildifyPath(vault.root)}
          </span>
        </span>
      </button>
      <ChromeButton
        icon="trash"
        iconSize={12}
        tone="subtle"
        disabled={busy}
        onClick={onRemove}
        title="Remove from list"
        aria-label={`Remove ${vault.name} from list`}
        className="ml-auto shrink-0 hover:text-red-400"
      />
    </div>
  )
}

function LinkRow({
  icon,
  label,
  href,
  hint
}: {
  icon: string
  label: string
  href: string
  hint?: string
}): JSX.Element {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      // Emphasis, not elevation: the fill under the pointer has to move away
      // from the page, and on a light ground that is downward. This named a
      // surface a step up, which is white here.
      className="-mx-2 flex items-center justify-between gap-6 rounded-r3 px-2 py-3 transition-colors hover:bg-accent"
    >
      <div className="flex min-w-0 items-center gap-2">
        <Icon name={icon} size={14} className="shrink-0" />
        <div className="min-w-0">
          <div className="text-12.5 text-c-1">{label}</div>
          {hint ? <p className="mt-0.5 text-11 leading-snug text-c-2">{hint}</p> : null}
        </div>
      </div>
      <Icon name="link-external" size={12} className="shrink-0 codicon-muted" />
    </a>
  )
}

function OverrideRow({
  label,
  count,
  confirm,
  onReset
}: {
  label: string
  count: number
  /** Asked before clearing: these are per-file choices with no undo. */
  confirm?: ConfirmSpec
  onReset(): void
}): JSX.Element {
  const empty = count === 0
  return (
    <Row
      label={label}
      // The count is the whole subject of the row, so it is the sentence: how
      // many you have, not what the feature is called. The tinted square that
      // used to lead this row is gone with it — it announced a state ("some"
      // versus "none") that the words already say, in a place where every
      // other row leads with a word.
      hint={empty ? 'None set.' : `${count} set on individual files.`}
      disabled={empty}
      control={
        empty ? (
          <span className="text-11 text-c-2">—</span>
        ) : (
          <ActionButton icon="debug-restart" confirm={confirm} onClick={onReset}>
            Reset
          </ActionButton>
        )
      }
    />
  )
}

function AlwaysOnBadge(): JSX.Element {
  return (
    <span className="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-[8px] bg-bg-3 px-2.5 py-1 text-[11px] font-medium text-foreground">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
      Always On
    </span>
  )
}

/**
 * What leaves the machine.
 *
 * Explicit rather than a single vague "Send usage data" line: this app's
 * whole claim is that notes stay local, so the honest move is to name each
 * stream and say what it carries.
 *
 * The usage switch is a real switch again. It was a badge reading "Always On"
 * during the closed beta, backed by a consent check stubbed to always agree —
 * so a refusal stored on disk did nothing. Both halves are restored together;
 * a control that does not control is worse than no control, because it reads
 * as an answer.
 *
 * Crash reports stay always-on and say so: they carry no usage data, are
 * scrubbed of paths in main, and only fire when something already went wrong.
 */
function TelemetrySection(): JSX.Element {
  const settings = useUiStore((s) => s.settings)
  const analyticsOn = settings?.analytics?.enabled !== false
  const [busy, setBusy] = useState(false)

  async function setAnalytics(next: boolean): Promise<void> {
    setBusy(true)
    try {
      const r = await api().settings.setApp({ analytics: { enabled: next } })
      if (r.ok) await useUiStore.getState().load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <SectionShell title="Diagnostics" icon="pulse">
      <Card title="Usage analytics" plain>
        <p className="text-[12px] leading-snug text-muted-foreground">
          Which features get used — app launched, vault opened, note created. Counts and timings
          only.
        </p>
        <div className="flex items-center gap-2">
          <Switch
            checked={analyticsOn}
            disabled={busy}
            onCheckedChange={(next) => void setAnalytics(next)}
            ariaLabel="Usage analytics"
          />
          <span className="text-12 text-muted-foreground">{analyticsOn ? 'On' : 'Off'}</span>
        </div>
      </Card>

      <Card title="Crash reports" plain>
        <p className="text-[12px] leading-snug text-muted-foreground">
          When Mindex crashes, the error and the stack trace are sent so it can be fixed.
        </p>
        <AlwaysOnBadge />
      </Card>

      <Card title="Never sent" plain>
        <ul className="space-y-1 text-[12px] text-muted-foreground">
          {[
            'Note content, titles, or file names',
            'Folder structure or vault paths',
            'Search queries and prompts sent to your engine',
            'Your name, email, or IP address'
          ].map((line) => (
            <li key={line} className="flex items-start gap-2">
              <Icon name="close" size={11} className="mt-[3px] shrink-0 codicon-red" />
              {line}
            </li>
          ))}
        </ul>
      </Card>
    </SectionShell>
  )
}

// --- About group ------------------------------------------------------------

const LEGAL_LINKS: Array<{ icon: string; label: string; href: string }> = [
  { icon: 'shield', label: 'Privacy Policy', href: 'https://mindex.live/privacy' },
  { icon: 'law', label: 'Terms & Conditions', href: 'https://mindex.live/terms' }
]

const ABOUT_LINKS: Array<{ icon: string; label: string; href: string; site?: boolean }> = [
  // The one link that is the product's own site, not a way to reach the
  // person — blue and underlined so it reads as the site's URL, the way it
  // would set in a browser's address bar, rather than one more contact row.
  { icon: 'globe', label: 'mindex.live', href: 'https://mindex.live', site: true },
  { icon: 'link-external', label: 'LinkedIn', href: 'https://www.linkedin.com/in/dvolynov/' },
  { icon: 'mail', label: 'dvolynov@gmail.com', href: 'mailto:dvolynov@gmail.com' }
]

function AboutSection(): JSX.Element {
  const [version, setVersion] = useState<string | null>(null)
  const [update, setUpdate] = useState<UpdateStatus | null>(null)

  useEffect(() => {
    let alive = true
    const getVersion = api().app.getVersion
    if (typeof getVersion === 'function') {
      void getVersion().then((r) => {
        if (alive && r.ok && r.data) setVersion(r.data)
      })
    }
    void api()
      .update.getStatus()
      .then((r) => {
        if (alive && r.ok && r.data) setUpdate(r.data)
      })
    return () => {
      alive = false
    }
  }, [])

  const offered = update?.phase === 'available' && update.latestVersion
  const staged = update?.phase === 'ready'
  return (
    <SectionShell title="About" icon="info">
      <Card title="Version">
        <Row
          label="Mindex"
          hint={
            update?.phase === 'checking'
              ? 'Checking for a newer one…'
              : offered || staged
                ? `Version ${update?.latestVersion} is available.`
                : 'Checked hourly. Nothing installs until you ask.'
          }
          control={
            <div className="flex items-center gap-2">
              <span className="tabular-nums text-12.5 text-c-2">
                {version ? `v${version}` : '—'}
              </span>
            </div>
          }
        />
        <Row
          label="Updates"
          hint="Ask the release feed now rather than waiting for the hourly check."
          control={
            staged ? (
              <ActionButton icon="check" onClick={() => void api().update.installNow()}>
                Restart to finish
              </ActionButton>
            ) : offered ? (
              <ActionButton icon="cloud-download" onClick={() => void api().update.start()}>
                {`Update to v${update?.latestVersion}`}
              </ActionButton>
            ) : (
              <ActionButton
                icon="sync"
                disabled={update?.phase === 'checking'}
                onClick={() => void api().update.check()}
              >
                Check now
              </ActionButton>
            )
          }
        />
        <Row
          label="Report a bug"
          hint="Goes with this build's version and platform attached. Never your notes."
          control={
            <ActionButton
              icon="bug"
              onClick={() => {
                useUiStore.getState().setSettingsOpen(false)
                useUiStore.getState().setBugReportOpen(true)
              }}
            >
              Report
            </ActionButton>
          }
        />
      </Card>

      <Card title="Developer">
        <div className="space-y-1">
          {ABOUT_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              className="-mx-2 flex h-8 items-center gap-2 rounded-[10px] px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Icon name={l.icon} size={13} className="shrink-0" />
              {/* Underline on the label only — on the `<a>` itself it drew a
                  line under the icons on either side too. */}
              <span className={l.site ? 'underline underline-offset-2' : undefined}>{l.label}</span>
              {/* The same mark, at the same strength, as the rows in Privacy
                  & legal below — they open a link in exactly the same way, and
                  a fainter one here made these read as the lesser kind. */}
              <Icon name="link-external" size={11} className="ml-auto shrink-0 codicon-muted" />
            </a>
          ))}
        </div>
      </Card>

      <Card title="Privacy & legal">
        {LEGAL_LINKS.map((l) => (
          <LinkRow key={l.href} icon={l.icon} label={l.label} href={l.href} />
        ))}
      </Card>

      {/* The last line on the screen, under everything and belonging to no
          card. A byline is not a setting and not a link — it is the signature
          at the bottom of the page, and inside a card it read as one more
          fact about the developer section above it. */}
      <p className="pt-1 text-center text-11 text-c-2">Built by Dmitriy Volynov</p>
    </SectionShell>
  )
}

/**
 * The declared screens contribute their own entries, so the two lists cannot
 * drift. What stays hand-written is the cards that are still hand-written —
 * sorting, and the bulk override resets.
 *
 * Down here because it reads the declarations, which are written next to the
 * screens that use them; a module-scope constant cannot be initialised before
 * what it names.
 */
const SEARCH_ENTRIES = [
  ...SEARCH_INDEX,
  ...searchEntries<FileDisplaySettings, SectionId>('sidebar-left', TREE_ROW_APPEARANCE),
  ...searchEntries<FileDisplaySettings, SectionId>('center', CARD_APPEARANCE)
]
