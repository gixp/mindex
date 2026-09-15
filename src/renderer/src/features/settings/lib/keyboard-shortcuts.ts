/**
 * Every keyboard shortcut Mindex answers to, in one place — read by the
 * Hotkeys settings page and nowhere else yet (the shortcuts themselves stay
 * bound where they always were: `main/menu.ts` for the native accelerators,
 * each component's own listener for the rest). This is a reference, not a
 * dispatcher.
 *
 * Hand-written rather than scraped from the menu/keydown handlers: half of
 * them live in Electron's native menu (`main/menu.ts`), half in renderer
 * `keydown` listeners scattered across components, and there is no single
 * registration point to read them off of. Missing a real shortcut here is a
 * silent gap the same way `SEARCH_INDEX` in `SettingsDialog.tsx` is — adding
 * one means adding a row here too.
 */

export type ShortcutCategory = 'notes' | 'editor' | 'layout' | 'chat'

export const SHORTCUT_CATEGORY_ORDER: ShortcutCategory[] = ['notes', 'editor', 'layout', 'chat']

export const SHORTCUT_CATEGORY_LABELS: Record<ShortcutCategory, string> = {
  notes: 'Notes & vault',
  editor: 'Editor',
  layout: 'Layout',
  chat: 'Chat'
}

export interface ShortcutBinding {
  mac: string
  windowsLinux: string
}

export interface Shortcut {
  id: string
  category: ShortcutCategory
  title: string
  description: string
  bindings: ShortcutBinding[]
}

export const KEYBOARD_SHORTCUTS: Shortcut[] = [
  {
    id: 'commandPalette',
    category: 'notes',
    title: 'Command palette',
    description:
      'Jump to a note or run a command. With text selected in a note, turns the selection into a link instead.',
    bindings: [{ mac: '⌘K', windowsLinux: 'Ctrl+K' }]
  },
  {
    id: 'newNote',
    category: 'notes',
    title: 'New plain note',
    description: 'Create an untyped note.',
    bindings: [{ mac: '⌘N', windowsLinux: 'Ctrl+N' }]
  },
  {
    id: 'newProject',
    category: 'notes',
    title: 'New project',
    description: 'Create a note of the Project type.',
    bindings: [{ mac: '⌘⇧P', windowsLinux: 'Ctrl+Shift+P' }]
  },
  {
    id: 'save',
    category: 'notes',
    title: 'Save',
    description:
      'Every change also saves on its own shortly after you stop typing — this just does it now.',
    bindings: [{ mac: '⌘S', windowsLinux: 'Ctrl+S' }]
  },
  {
    id: 'openVault',
    category: 'notes',
    title: 'Open vault…',
    bindings: [{ mac: '⌘O', windowsLinux: 'Ctrl+O' }],
    description: 'Pick a different vault folder to open.'
  },
  {
    id: 'newVault',
    category: 'notes',
    title: 'New vault…',
    description: 'Create a fresh vault folder.',
    bindings: [{ mac: '⌘⇧N', windowsLinux: 'Ctrl+Shift+N' }]
  },
  {
    id: 'closeVault',
    category: 'notes',
    title: 'Close vault',
    description: 'Close the open vault and return to the start screen.',
    bindings: [{ mac: '⌘⇧W', windowsLinux: 'Ctrl+Shift+W' }]
  },
  {
    id: 'findInNote',
    category: 'editor',
    title: 'Find in note',
    description: 'Search the open note. Enter/Shift+Enter move to the next/previous match.',
    bindings: [{ mac: '⌘F', windowsLinux: 'Ctrl+F' }]
  },
  {
    id: 'pasteAsPlainText',
    category: 'editor',
    title: 'Paste as plain text',
    description: 'Paste the clipboard’s text as-is, skipping link/markdown detection.',
    bindings: [{ mac: '⌘⇧V', windowsLinux: 'Ctrl+Shift+V' }]
  },
  {
    id: 'editorZoom',
    category: 'editor',
    title: 'Editor text size',
    description:
      'Grows, shrinks, or resets the note text — separate from the whole app’s zoom below.',
    bindings: [
      { mac: '⌘⇧+', windowsLinux: 'Ctrl+Shift+=' },
      { mac: '⌘⇧-', windowsLinux: 'Ctrl+Shift+-' },
      { mac: '⌘⇧0', windowsLinux: 'Ctrl+Shift+0' }
    ]
  },
  {
    id: 'toggleLeftSidebar',
    category: 'layout',
    title: 'Toggle left sidebar',
    description: 'Show or hide the note tree.',
    bindings: [{ mac: '⌘B', windowsLinux: 'Ctrl+B' }]
  },
  {
    id: 'toggleRightSidebar',
    category: 'layout',
    title: 'Toggle right sidebar',
    description: 'Show or hide the chat/CLI panel.',
    bindings: [{ mac: '⌘⌥B', windowsLinux: 'Ctrl+Alt+B' }]
  },
  {
    id: 'appZoom',
    category: 'layout',
    title: 'App zoom',
    description:
      'Grows, shrinks, or resets the whole window — every panel, not just a note’s text.',
    bindings: [
      { mac: '⌘+', windowsLinux: 'Ctrl+=' },
      { mac: '⌘-', windowsLinux: 'Ctrl+-' },
      { mac: '⌘0', windowsLinux: 'Ctrl+0' }
    ]
  },
  {
    id: 'sendMessage',
    category: 'chat',
    title: 'Send',
    description: 'Send the message in the composer.',
    bindings: [{ mac: '↵', windowsLinux: 'Enter' }]
  },
  {
    id: 'stopTurn',
    category: 'chat',
    title: 'Stop',
    description: 'Interrupt the assistant’s current turn.',
    bindings: [{ mac: 'Esc', windowsLinux: 'Esc' }]
  }
]

/** One binding, formatted for the current platform — `⌘K` or `Ctrl+K`. */
export function formatShortcutBinding(binding: ShortcutBinding, isMac: boolean): string {
  return isMac ? binding.mac : binding.windowsLinux
}

export function isMacPlatform(): boolean {
  return navigator.userAgent.includes('Mac')
}
