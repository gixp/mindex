import { create } from 'zustand'
import type { AppSettings, BugReportCategory } from '@shared/types'
import { api } from '@/platform/api'
import { setShowFileIcons as setMarkdownShowFileIcons } from '@/platform/markdown/markdown'
import { onVaultSettings } from '@/platform/vault-settings'

interface UiState {
  settings: AppSettings | null
  paletteOpen: boolean
  settingsOpen: boolean
  /** The folder-context engine modal — the single Context surface. */
  contextEngineOpen: boolean
  sourceControlOpen: boolean
  cloneVaultOpen: boolean
  engineLogOpen: boolean
  bugReportOpen: boolean
  /** Which kind of message the form opens on — Help offers both doors. */
  bugReportCategory: BugReportCategory
  /**
   * Which screen Settings opens on.
   *
   * Held here rather than inside the dialog because the useful openers are
   * elsewhere: Help wants the shortcut list, and the palette wants whichever
   * screen the command names. The dialog reads it when it opens and owns its
   * own navigation from then on.
   */
  settingsSection: string | null
  historyModal: { open: boolean; path: string | null }
  linkHealthOpen: boolean
  commentsOpen: boolean
  leftPanelHidden: boolean
  rightPanelHidden: boolean
  /** The floating terminal drawer. Not a `Hidden` flag like its neighbours:
   *  this one is closed until asked for, so the useful state is "open", and
   *  the double negative was worth avoiding. */
  bottomPanelOpen: boolean
  /** Which screen the left sidebar shows — switched from the activity bar. */
  sidebarTab: 'explorer' | 'skills' | 'types'
  editorFontSize: number
  cliFontSize: number
  chatFontSize: number
  iconOverrides: Record<string, string>
  iconColorOverrides: Record<string, string>
  showFileIcons: boolean
  showFolderIcons: boolean

  load(): Promise<void>
  setPanelSizes(sizes: { left: number; center: number; right: number }): Promise<void>
  setIconOverride(key: string, codicon: string | null): Promise<void>
  setShowFileIcons(v: boolean): void
  setShowFolderIcons(v: boolean): void
  setIconColorOverride(key: string, color: string | null): Promise<void>
  toggleLeftPanel(): void
  toggleBottomPanel(): void
  setBottomPanelOpen(open: boolean): void
  toggleRightPanel(): void
  /**
   * Take a panel's state FROM the layout library without writing it back.
   *
   * `react-resizable-panels` reports `onCollapse`/`onExpand` for its own
   * startup restoration and for every programmatic collapse we ask for — not
   * only for something the user did. Persisting those reports meant the app
   * saved its own initialisation over the user's stored layout, and every
   * panel came back open. Same reason `onLayout` is not persisted directly;
   * see the note above `sizesRef` in App.tsx.
   */
  syncPanelVisibility(patch: {
    leftPanelHidden?: boolean
    rightPanelHidden?: boolean
    bottomPanelOpen?: boolean
  }): void
  /** Write the current visibility of all three panels. Called after a real
   *  pointer resize, which is the one case the library reports and no setter
   *  above has already recorded. */
  persistPanelVisibility(): void
  setRightPanelHidden(hidden: boolean): void
  setSidebarTab(tab: 'explorer' | 'skills' | 'types'): void
  togglePalette(): void
  setSettingsOpen(open: boolean): void
  /** Open Settings on a named screen. */
  setSettingsSection(section: string | null): void
  setContextEngineOpen(open: boolean): void
  setSourceControlOpen(open: boolean): void
  setCloneVaultOpen(open: boolean): void
  setEngineLogOpen(open: boolean): void
  setBugReportOpen(open: boolean, category?: BugReportCategory): void
  openFileHistory(absPath: string): void
  setLinkHealthOpen(open: boolean): void
  setCommentsOpen(open: boolean): void
  closeFileHistory(): void
  setEditorViewMode(mode: 'edit' | 'preview'): void
  setEditorFontSize(px: number): void
  bumpEditorFontSize(delta: number): void
  setCliFontSize(px: number): void
  bumpCliFontSize(delta: number): void
  setChatFontSize(px: number): void
  bumpChatFontSize(delta: number): void
}

export const EDITOR_FONT_SIZE_DEFAULT = 13
export const EDITOR_FONT_SIZE_MIN = 9
export const EDITOR_FONT_SIZE_MAX = 32

export const CLI_FONT_SIZE_DEFAULT = 13
export const CLI_FONT_SIZE_MIN = 9
export const CLI_FONT_SIZE_MAX = 32

// Interface scale is a percentage of the default size, not a px value: it
// drives Electron's zoom factor, which scales the whole UI. The bounds match
// clampZoomFactor in main/menu.ts — keep them in sync.

export const CHAT_FONT_SIZE_DEFAULT = 14
export const CHAT_FONT_SIZE_MIN = 10
export const CHAT_FONT_SIZE_MAX = 28

export const useUiStore = create<UiState>((set, get) => ({
  settings: null,
  paletteOpen: false,
  settingsOpen: false,
  contextEngineOpen: false,
  sourceControlOpen: false,
  cloneVaultOpen: false,
  engineLogOpen: false,
  bugReportOpen: false,
  bugReportCategory: 'bug',
  settingsSection: null,
  historyModal: { open: false, path: null },
  linkHealthOpen: false,
  commentsOpen: false,
  leftPanelHidden: false,
  rightPanelHidden: true,
  bottomPanelOpen: false,
  sidebarTab: 'explorer',
  editorFontSize: EDITOR_FONT_SIZE_DEFAULT,
  cliFontSize: CLI_FONT_SIZE_DEFAULT,
  chatFontSize: CHAT_FONT_SIZE_DEFAULT,
  iconOverrides: {},
  iconColorOverrides: {},
  showFileIcons: true,
  showFolderIcons: true,

  async load() {
    const r = await api().settings.getApp()
    if (r.ok && r.data) {
      const data = r.data
      set({
        settings: data,
        leftPanelHidden: data.leftPanelHidden ?? false,
        rightPanelHidden: data.rightPanelHidden ?? true,
        bottomPanelOpen: data.bottomPanelOpen ?? false,
        editorFontSize:
          typeof r.data.editorFontSize === 'number'
            ? r.data.editorFontSize
            : EDITOR_FONT_SIZE_DEFAULT,
        cliFontSize:
          typeof r.data.cliFontSize === 'number' ? r.data.cliFontSize : CLI_FONT_SIZE_DEFAULT,
        chatFontSize:
          typeof r.data.chatFontSize === 'number' ? r.data.chatFontSize : CHAT_FONT_SIZE_DEFAULT
      })
    }
  },

  async setPanelSizes(sizes) {
    const cur = get().settings?.panelSizes
    if (
      cur &&
      cur.left === sizes.left &&
      cur.center === sizes.center &&
      cur.right === sizes.right
    ) {
      return
    }
    const r = await api().settings.setApp({ panelSizes: sizes })
    if (r.ok && r.data) {
      set({ settings: r.data })
    }
  },

  async setIconOverride(key, codicon) {
    const overrides = { ...get().iconOverrides }
    if (codicon === null || codicon === '') delete overrides[key]
    else overrides[key] = codicon
    set({ iconOverrides: overrides })
    await api().settings.setVault({ iconOverrides: overrides })
  },

  async setIconColorOverride(key, color) {
    const overrides = { ...get().iconColorOverrides }
    if (color === null || color === '') delete overrides[key]
    else overrides[key] = color
    set({ iconColorOverrides: overrides })
    await api().settings.setVault({ iconColorOverrides: overrides })
  },

  setShowFileIcons(v) {
    set({ showFileIcons: v })
    setMarkdownShowFileIcons(v)
  },

  setShowFolderIcons(v) {
    set({ showFolderIcons: v })
  },

  toggleLeftPanel() {
    const next = !get().leftPanelHidden
    set({ leftPanelHidden: next })
    void api().settings.setApp({ leftPanelHidden: next })
  },

  syncPanelVisibility(patch) {
    set(patch)
  },

  persistPanelVisibility() {
    const { leftPanelHidden, rightPanelHidden, bottomPanelOpen } = get()
    void api().settings.setApp({ leftPanelHidden, rightPanelHidden, bottomPanelOpen })
  },

  toggleRightPanel() {
    const next = !get().rightPanelHidden
    set({ rightPanelHidden: next })
    void api().settings.setApp({ rightPanelHidden: next })
  },

  setRightPanelHidden(hidden) {
    if (get().rightPanelHidden === hidden) return
    set({ rightPanelHidden: hidden })
    void api().settings.setApp({ rightPanelHidden: hidden })
  },

  toggleBottomPanel() {
    const next = !get().bottomPanelOpen
    set({ bottomPanelOpen: next })
    void api().settings.setApp({ bottomPanelOpen: next })
  },

  setBottomPanelOpen(open) {
    if (get().bottomPanelOpen === open) return
    set({ bottomPanelOpen: open })
    void api().settings.setApp({ bottomPanelOpen: open })
  },

  setSidebarTab(tab) {
    set({ sidebarTab: tab })
  },

  togglePalette() {
    set({ paletteOpen: !get().paletteOpen })
  },

  setSettingsOpen(open) {
    set({ settingsOpen: open })
  },

  setSettingsSection(section) {
    set({ settingsSection: section })
  },

  setContextEngineOpen(open) {
    set({ contextEngineOpen: open })
  },

  setSourceControlOpen(open) {
    set({ sourceControlOpen: open })
  },

  setCloneVaultOpen(open) {
    set({ cloneVaultOpen: open })
  },

  setEngineLogOpen(open) {
    set({ engineLogOpen: open })
  },

  setBugReportOpen(open, category) {
    // The category only moves when a caller names one, so closing the form
    // does not quietly reset what the next opener asked for.
    set(category ? { bugReportOpen: open, bugReportCategory: category } : { bugReportOpen: open })
  },

  setLinkHealthOpen(open) {
    set({ linkHealthOpen: open })
  },

  setCommentsOpen(open) {
    set({ commentsOpen: open })
  },

  openFileHistory(absPath) {
    set({ historyModal: { open: true, path: absPath } })
  },

  closeFileHistory() {
    set({ historyModal: { open: false, path: null } })
  },

  async setEditorViewMode(mode) {
    const cur = get().settings?.editorViewMode
    if (cur === mode) return
    const r = await api().settings.setApp({ editorViewMode: mode })
    if (r.ok && r.data) set({ settings: r.data })
  },

  setEditorFontSize(px) {
    const clamped = Math.min(EDITOR_FONT_SIZE_MAX, Math.max(EDITOR_FONT_SIZE_MIN, Math.round(px)))
    if (clamped === get().editorFontSize) return
    set({ editorFontSize: clamped })
    void api().settings.setApp({ editorFontSize: clamped })
  },

  bumpEditorFontSize(delta) {
    get().setEditorFontSize(get().editorFontSize + delta)
  },

  setCliFontSize(px) {
    const clamped = Math.min(CLI_FONT_SIZE_MAX, Math.max(CLI_FONT_SIZE_MIN, Math.round(px)))
    if (clamped === get().cliFontSize) return
    set({ cliFontSize: clamped })
    void api().settings.setApp({ cliFontSize: clamped })
  },

  bumpCliFontSize(delta) {
    get().setCliFontSize(get().cliFontSize + delta)
  },

  setChatFontSize(px) {
    const clamped = Math.min(CHAT_FONT_SIZE_MAX, Math.max(CHAT_FONT_SIZE_MIN, Math.round(px)))
    if (clamped === get().chatFontSize) return
    set({ chatFontSize: clamped })
    void api().settings.setApp({ chatFontSize: clamped })
  },

  bumpChatFontSize(delta) {
    get().setChatFontSize(get().chatFontSize + delta)
  }
}))

/**
 * The workspace-scoped half of this store: which icons the person chose for
 * which paths, and whether file and folder icons are shown at all.
 *
 * Registered against the shared vault-settings module rather than fetched
 * here, so this store no longer has to be told when a vault opens — and the
 * vault store no longer has to know this one exists. `null` means no
 * workspace is open, which resets all four rather than the two that used to be
 * cleared on close.
 */
onVaultSettings((s) => {
  const showFileIcons = s?.fileDisplay?.showFileIcons !== false
  const showFolderIcons = s?.fileDisplay?.showFolderIcons !== false
  useUiStore.setState({
    iconOverrides: s?.iconOverrides ?? {},
    iconColorOverrides: s?.iconColorOverrides ?? {},
    showFileIcons,
    showFolderIcons
  })
  setMarkdownShowFileIcons(showFileIcons)
})
