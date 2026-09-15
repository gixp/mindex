import { useCallback, useMemo } from 'react'
import { useVaultStore } from '@/platform/workspace'
import { useUiStore } from '@/platform/app-settings'
import { api } from '@/platform/api'
import type { NoteTypeId } from '@shared/types'
import { NOTE_TYPE_LABELS } from '@/features/editor/lib/note-types'
import { requestTreeInlineRename } from '@/platform/presentation/tree-events'
import {
  openDocument,
  graphViewPath,
  SKILLS_HOME_PATH,
  TYPES_HOME_PATH
} from '@/platform/documents'
import { pushToast } from '@/platform/notifications'
import { useContentMatches } from '@/platform/search'
import { confirmAction } from '@/ui/confirm'
import { useAiProposalsStore } from '@/features/ai/store'

export interface PaletteItem {
  id: string
  label: string
  sublabel?: string
  kind: 'create' | 'command' | 'note'
  /** Absolute path, for a note. What its chosen icon is stored under. */
  path?: string
  action: () => void | Promise<void>
}

/** How many notes a list of names is worth; past this it stops being a list. */
const NOTE_LIMIT = 20
/** Text matches sit under the names, and are capped separately. */
const CONTENT_LIMIT = 20

const CREATE_TYPES: NoteTypeId[] = [
  'untyped',
  'project',
  'person',
  'organization',
  'goal',
  'knowledge',
  'daily-note',
  'asset'
]

/**
 * Every verb in the product, in the one place someone types a verb.
 *
 * It held two: check link health, and clean up file numbering. Settings, the
 * graph, the context window, capture, the terminal and source control were all
 * a mouse trip to a particular corner of the window and reachable no other
 * way, which makes the palette a list of notes with two commands attached
 * rather than a map of the app.
 *
 * `terms` carries the words someone would actually type for a thing — they
 * think "dark mode" and the label says "Appearance".
 */
interface PaletteCommand {
  id: string
  label: string
  sublabel?: string
  /** Extra words that should find this row. */
  terms: string
  action: () => void | Promise<void>
}

function settingsAt(section: string): () => void {
  return () => {
    useUiStore.getState().setSettingsSection(section)
    useUiStore.getState().setSettingsOpen(true)
  }
}

const COMMANDS: PaletteCommand[] = [
  {
    id: 'graph',
    label: 'Open the graph',
    sublabel: 'Every note and what links to what',
    terms: 'graph links map connections',
    action: () => void openDocument(graphViewPath(''))
  },
  {
    id: 'context',
    label: 'Context management',
    sublabel: 'What the assistant knows about each folder',
    terms: 'context ai assistant folders briefing',
    action: () => useUiStore.getState().setContextEngineOpen(true)
  },
  {
    id: 'capture',
    label: 'Capture a link or a passage',
    sublabel: 'Turn something you pasted into a note',
    terms: 'capture paste clip url save',
    action: () => useAiProposalsStore.getState().openCapture()
  },
  {
    id: 'linkHealth',
    label: 'Check link health',
    sublabel: 'Find links pointing nowhere, and notes nothing links to',
    terms: 'link dead orphan broken health',
    action: () => useUiStore.getState().setLinkHealthOpen(true)
  },
  {
    id: 'sourceControl',
    label: 'Source control',
    sublabel: 'Review, commit and push this vault',
    terms: 'git commit push pull version diff',
    action: () => useUiStore.getState().setSourceControlOpen(true)
  },
  {
    id: 'terminal',
    label: 'Toggle the terminal',
    terms: 'terminal shell console cli',
    action: () => useUiStore.getState().toggleBottomPanel()
  },
  {
    id: 'leftPanel',
    label: 'Toggle the left sidebar',
    terms: 'sidebar explorer files panel hide',
    action: () => useUiStore.getState().toggleLeftPanel()
  },
  {
    id: 'rightPanel',
    label: 'Toggle the right sidebar',
    terms: 'sidebar assistant chat panel hide',
    action: () => useUiStore.getState().toggleRightPanel()
  },
  {
    id: 'skills',
    label: 'Skills',
    terms: 'skills agent abilities',
    action: () => {
      useUiStore.getState().setSidebarTab('skills')
      void openDocument(SKILLS_HOME_PATH)
    }
  },
  {
    id: 'types',
    label: 'Note types',
    sublabel: 'The shapes a note in this vault can take',
    terms: 'types template frontmatter schema',
    action: () => {
      useUiStore.getState().setSidebarTab('types')
      void openDocument(TYPES_HOME_PATH)
    }
  },
  {
    id: 'settings',
    label: 'Settings',
    terms: 'settings preferences options config',
    action: settingsAt('vaults')
  },
  {
    id: 'shortcuts',
    label: 'Keyboard shortcuts',
    terms: 'shortcuts keys hotkeys bindings',
    action: settingsAt('hotkeys')
  },
  {
    id: 'appearance',
    label: 'Appearance',
    sublabel: 'Theme, text size, what a row shows',
    terms: 'appearance theme dark light font size',
    action: settingsAt('appearance')
  },
  {
    id: 'assistant',
    label: 'Assistant settings',
    sublabel: 'Which CLI answers, and which model',
    terms: 'assistant ai engine model provider claude codex gemini',
    action: settingsAt('engine')
  },
  {
    id: 'stripNumberPrefixes',
    label: 'Clean up file numbering',
    sublabel: 'Remove leading "01 -", "02." ordering prefixes from note names',
    terms: 'clean number prefix rename tidy',
    action: cleanUpFileNumbering
  }
]

/**
 * A vault-wide rename, asked about first and reported afterwards.
 *
 * It used to run the moment it was picked — no confirmation, no preview, no
 * undo — and write the number of files it had renamed to the developer
 * console. From the person's side, a bulk rename across every folder looked
 * exactly like nothing happening.
 */
async function cleanUpFileNumbering(): Promise<void> {
  const preview = await api().notes.stripNumberPrefixes(true)
  if (!preview.ok || preview.data === undefined) {
    pushToast(`Could not check the file names. ${preview.error ?? ''}`.trim())
    return
  }
  const count = preview.data.renamed
  if (count === 0) {
    pushToast('No file names start with a number prefix.')
    return
  }
  const ok = await confirmAction({
    title: `Rename ${count} ${count === 1 ? 'file' : 'files'}?`,
    message:
      'Leading "01 -" and "02." prefixes will be dropped from their names. Links to them are rewritten, but this is not undone in one step.',
    confirmLabel: 'Rename',
    destructive: true
  })
  if (!ok) return
  const r = await api().notes.stripNumberPrefixes()
  if (!r.ok || r.data === undefined) {
    pushToast(`The rename did not finish. ${r.error ?? ''}`.trim())
    return
  }
  pushToast(`Renamed ${r.data.renamed} ${r.data.renamed === 1 ? 'file' : 'files'}.`)
}

/**
 * Same note/command search the ⌘K modal has always used, factored out so the
 * inline header search can share it without re-implementing the matching
 * rules. Actions only do the underlying thing (create/open) — callers are
 * responsible for their own post-select behavior (closing a modal, clearing
 * an input, etc).
 */
export function usePaletteItems(query: string): PaletteItem[] {
  const notes = useVaultStore((s) => s.notes)
  const vault = useVaultStore((s) => s.vault)
  const openNote = openDocument
  const content = useContentMatches(query)
  const byPath = useMemo(() => new Map(notes.map((n) => [n.path, n])), [notes])

  const createNote = useCallback(
    async (type: NoteTypeId): Promise<void> => {
      if (!vault) return
      const hadTitle = query.trim().length > 0
      const title = query.trim() || 'Untitled'
      const r = await api().notes.create({ type, title })
      if (r.ok && r.data) {
        openNote(r.data.path)
        // Only drop into inline rename when the title was the generic
        // default — if the user already typed a name via the palette,
        // asking them to name it again is redundant friction.
        if (!hadTitle) requestTreeInlineRename(r.data)
      }
    },
    [query, vault, openNote]
  )

  const items: PaletteItem[] = []
  const q = query.trim().toLowerCase()

  const showCreate = q === '' || q.startsWith('new') || q.startsWith('creat')
  if (showCreate) {
    for (const type of CREATE_TYPES) {
      // The label map covers the built-ins; a vault's own type falls back to
      // its id, which is what the user named it anyway.
      const label = NOTE_TYPE_LABELS[type] ?? type
      if (
        !q ||
        label.toLowerCase().includes(q.replace(/^new\s*/, '').replace(/^creat\w*\s*/, ''))
      ) {
        items.push({
          id: `create:${type}`,
          label: `New ${label}`,
          kind: 'create',
          action: () => createNote(type)
        })
      }
    }
  }

  if (vault) {
    for (const c of COMMANDS) {
      if (!q || c.label.toLowerCase().includes(q) || c.terms.includes(q)) {
        items.push({
          id: `cmd:${c.id}`,
          label: c.label,
          sublabel: c.sublabel,
          kind: 'command',
          action: c.action
        })
      }
    }
  }

  /**
   * Notes by name first, then notes by what they say.
   *
   * Name matching is local and instant; searching the text is a round trip to
   * the index in the app process. Doing them separately means the list is
   * never waiting on the slower half — the names appear as you type and the
   * text matches join them a moment later, rather than everything arriving at
   * the speed of the slowest thing.
   */
  const byName =
    q.length >= 1
      ? notes.filter(
          (n) => n.title.toLowerCase().includes(q) || n.relPath.toLowerCase().includes(q)
        )
      : notes.slice(0, NOTE_LIMIT)

  const seen = new Set<string>()
  for (const n of byName.slice(0, NOTE_LIMIT)) {
    seen.add(n.path)
    items.push({
      id: `note:${n.path}`,
      path: n.path,
      label: n.title,
      sublabel: n.relPath,
      kind: 'note',
      action: () => openNote(n.path)
    })
  }

  for (const path of content.paths) {
    if (seen.has(path) || items.length >= NOTE_LIMIT + CONTENT_LIMIT) continue
    const n = byPath.get(path)
    if (!n) continue
    seen.add(path)
    items.push({
      id: `note:${path}`,
      path,
      // Said out loud: a note whose name has nothing to do with what was typed
      // otherwise reads as a result with no reason to be in the list.
      label: n.title,
      sublabel:
        content.matchedIn.get(path) === 'tags'
          ? `${n.relPath} — matched a tag`
          : `${n.relPath} — matched in the text`,
      kind: 'note',
      action: () => openNote(path)
    })
  }

  return items
}
