/**
 * Where a document lives, and the one way to put one on screen.
 *
 * Both halves used to be exported by the editor's own store, and 25 files
 * outside the editor imported it — almost all of them only ever wanting an
 * address or `open`. That is what made the editor a hub the rest of the app
 * reaches into rather than an ordinary feature. The clearest symptom was a
 * platform module, `platform/markdown/wikilink.ts`, importing a feature store
 * to follow a link.
 *
 * The addresses below are pure functions and moved here verbatim. Opening is
 * the editor's job and stays there; this holds only the door. The editor
 * registers what is behind it at startup, the same way the markdown renderer
 * is told how to illustrate a link — see `setWikilinkIconResolver`. Injected
 * rather than imported, so nothing in platform points at a feature.
 */

import { useSyncExternalStore } from 'react'

export const FOLDER_VIEW_PREFIX = 'mindex://folder/'
export function isFolderViewPath(p: string | null | undefined): boolean {
  return typeof p === 'string' && p.startsWith(FOLDER_VIEW_PREFIX)
}
export function folderViewPath(folderRel: string): string {
  return `${FOLDER_VIEW_PREFIX}${folderRel}`
}
export function folderRelFromPath(p: string): string {
  return p.slice(FOLDER_VIEW_PREFIX.length)
}

/**
 * The screen each sidebar tab opens onto, the way Explorer opens onto the
 * vault root's folder view. A place to land, rather than an empty pane until
 * you happen to click something.
 */
export const SKILLS_HOME_PATH = 'mindex://skills'
export const TYPES_HOME_PATH = 'mindex://types'

/**
 * The link graph. Not a sidebar tab's landing screen — it is opened from the
 * header — but it behaves like one: a single view of the whole vault with no
 * document behind it, so it counts as a home tab and gets replaced rather than
 * pushed aside when you open a note from it.
 */
export const GRAPH_HOME_PATH = 'mindex://graph'

/**
 * A graph scoped to one folder.
 *
 * The whole-vault graph keeps the bare `mindex://graph`, so it stays a home
 * path and every tab that already exists goes on meaning what it meant. A
 * scoped one carries the folder after the slash — and since the bare path has
 * no trailing slash, the two can never be confused for one another.
 */
export const GRAPH_VIEW_PREFIX = 'mindex://graph/'

export function isGraphPath(p: string | null | undefined): boolean {
  return typeof p === 'string' && (p === GRAPH_HOME_PATH || p.startsWith(GRAPH_VIEW_PREFIX))
}

/** The tab for a folder's graph — or the whole vault's, for the root. */
export function graphViewPath(folderRel: string): string {
  return folderRel ? `${GRAPH_VIEW_PREFIX}${folderRel}` : GRAPH_HOME_PATH
}

/** The folder a graph tab is scoped to. Empty means the whole vault. */
export function graphFolderFromPath(p: string): string {
  return p.startsWith(GRAPH_VIEW_PREFIX) ? p.slice(GRAPH_VIEW_PREFIX.length) : ''
}

export const SKILL_VIEW_PREFIX = 'mindex://skill/'
export function isSkillViewPath(p: string | null | undefined): boolean {
  return typeof p === 'string' && p.startsWith(SKILL_VIEW_PREFIX)
}
/** Skill files live outside the vault, so the tab carries an absolute path. */
export function skillViewPath(absPath: string): string {
  return `${SKILL_VIEW_PREFIX}${absPath}`
}
export function skillPathFromView(p: string): string {
  return p.slice(SKILL_VIEW_PREFIX.length)
}

export const TYPE_VIEW_PREFIX = 'mindex://type/'
export function isTypeViewPath(p: string | null | undefined): boolean {
  return typeof p === 'string' && p.startsWith(TYPE_VIEW_PREFIX)
}
export function typeViewPath(id: string): string {
  return `${TYPE_VIEW_PREFIX}${id}`
}
export function typeIdFromPath(p: string): string {
  return p.slice(TYPE_VIEW_PREFIX.length)
}

/**
 * The real file a tab stands for, for the features that key off a path.
 *
 * A skill tab's own path is virtual, but the file behind it is a real one —
 * so comments, which are stored per file, follow it rather than the tab. A
 * tab with no file behind it returns null.
 */
export function documentPathOf(p: string | null | undefined): string | null {
  if (!p) return null
  if (isSkillViewPath(p)) return skillPathFromView(p)
  return isVirtualPath(p) ? null : p
}

/**
 * A tab that is a view, not a file on disk.
 *
 * Every guard below used to name the folder view specifically, which was only
 * ever shorthand for "there is nothing here to read, save, rename or persist".
 * Naming the real condition means the next view type does not have to be added
 * to nine separate checks — and being forgotten in one of them would mean
 * trying to autosave something that has no file.
 */
export function isVirtualPath(p: string | null | undefined): boolean {
  return typeof p === 'string' && p.startsWith('mindex://')
}

// --- the door ------------------------------------------------------------

interface DocumentHost {
  open(path: string): Promise<void>
  activePath(): string | null
  subscribe(listener: () => void): () => void
}

/**
 * Before the editor registers, opening does nothing and nothing is open.
 *
 * Not a throw: this stands in during a test that renders one component, and
 * failing there would say the component is broken when it is only alone.
 */
let host: DocumentHost = {
  open: async () => undefined,
  activePath: () => null,
  subscribe: () => () => undefined
}

export function setDocumentHost(next: DocumentHost): void {
  host = next
}

/**
 * Put a document on screen — a file, a wikilink target, a home screen, a
 * freshly created skill or type.
 *
 * It replaces whatever the active tab is showing rather than piling up a new
 * one, and something already open somewhere just gets focused. That is the
 * editor's rule, not this module's; this is the name the rest of the app
 * calls it by.
 */
export function openDocument(path: string): Promise<void> {
  return host.open(path)
}

/** What is on screen right now, outside React. */
export function activeDocumentPath(): string | null {
  return host.activePath()
}

/** What is on screen right now, for a component that should redraw when it changes. */
export function useActiveDocumentPath(): string | null {
  return useSyncExternalStore(
    (listener) => host.subscribe(listener),
    () => host.activePath(),
    () => null
  )
}
