import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  FileChangeEvent,
  IndexStats,
  LinkHealth,
  NoteMeta,
  NoteTypeId,
  SearchResult,
  Task
} from '@shared/types'
import { computeBacklinks, computeLinkHealth } from './links'
import { ensureDir, readJson, readText, writeJson } from '@main/util/fs-helpers'
import { toRelative, vaultCacheFile, vaultMetaDir } from '@main/util/paths'
import {
  extractTags,
  extractTitle,
  extractWikilinks,
  parseFrontmatter
} from '@main/notes/frontmatter'
import { detectType } from '@main/types/registry'
import { frontmatterLinkTargets } from '@shared/relations'
import { isIgnoredVaultPath, listVaultDirs, listVaultFiles } from '@main/vault/fs-ops'
import { getVault, requireVault } from '@main/vault/state'
import { isExcalidrawPath } from '@shared/excalidraw'
import { DUE_RE } from '@shared/due'
import { createSearchIndex, metaToDoc, type SearchDoc } from './search'
import MiniSearch from 'minisearch'

interface IndexState {
  byPath: Map<string, NoteMeta>
  byId: Map<string, string>
  byType: Map<NoteTypeId, Set<string>>
  byTag: Map<string, Set<string>>
  byFolder: Map<string, Set<string>>
  links: Map<string, Set<string>>
  backlinks: Map<string, Set<string>>
  tasks: Task[]
  search: MiniSearch<SearchDoc>
  dirs: Set<string>
}

let state: IndexState | null = null

/**
 * Earliest known creation time per relative path, recovered from the last
 * persisted cache.
 *
 * `createdAt` comes from the filesystem's birthtime, which is not as stable as
 * it looks: notes are written atomically (temp file + rename), and a rename
 * puts a *new* inode in place, so birthtime becomes "when this note was last
 * saved". Without a floor, the Created column in the tree and folder views
 * would drift forward on every autosave. A git clone or a fresh sync has
 * always had the same effect; this covers that too.
 */
let createdAtFloor: Map<string, number> | null = null

/**
 * The oldest creation time we have any evidence for: what the filesystem
 * currently reports, what the previous cache recorded, and what the live index
 * already knows. Times only ever move backwards here, never forwards.
 */
function earliestCreatedAt(absPath: string, relPath: string, birthtimeMs: number): number {
  let earliest = birthtimeMs
  const cached = createdAtFloor?.get(relPath)
  if (cached !== undefined && cached < earliest) earliest = cached
  const live = state?.byPath.get(absPath)?.createdAt
  if (live !== undefined && live < earliest) earliest = live
  return earliest
}

/**
 * Drop the remembered creation time for a path, so a genuinely new note there
 * gets today's date instead of inheriting whatever used to live at that path.
 *
 * Creating is the only unambiguous signal for this: an `unlink` on its own
 * cannot tell a deletion apart from the inode swap of an atomic write.
 */
export function forgetCreatedAt(relPath: string): void {
  createdAtFloor?.delete(relPath)
}

async function loadCreatedAtFloor(): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  try {
    const vault = requireVault()
    const snap = await readJson<{ notes?: NoteMeta[] }>(vaultCacheFile(vault.root))
    for (const note of snap?.notes ?? []) {
      if (typeof note.createdAt === 'number') out.set(note.relPath, note.createdAt)
    }
  } catch {}
  return out
}

function emptyState(): IndexState {
  return {
    byPath: new Map(),
    byId: new Map(),
    byType: new Map(),
    byTag: new Map(),
    byFolder: new Map(),
    links: new Map(),
    backlinks: new Map(),
    tasks: [],
    search: createSearchIndex(),
    dirs: new Set()
  }
}

const TASK_RE = /^(\s*)-\s\[( |x|X)\]\s+(.+)$/gm
const ASSIGNEE_RE = /@\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/

function parseTasksFromBody(notePath: string, body: string): Task[] {
  const tasks: Task[] = []
  const lines = body.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === undefined) continue
    const match = line.match(/^(\s*)-\s\[( |x|X)\]\s+(.+)$/)
    if (!match) continue
    const text = match[3] ?? ''
    const done = (match[2] ?? ' ') !== ' '
    const assignee = text.match(ASSIGNEE_RE)?.[1]
    const due = text.match(DUE_RE)?.[1]
    const task: Task = { notePath, line: i + 1, text, done }
    if (assignee) task.assignee = assignee
    if (due) task.due = due
    tasks.push(task)
  }
  void TASK_RE
  return tasks
}

function isParseableNote(absPath: string): boolean {
  const lower = absPath.toLowerCase()
  return lower.endsWith('.md') || lower.endsWith('.excalidraw')
}

async function statStub(absPath: string): Promise<NoteMeta | null> {
  let stat: import('node:fs').Stats
  try {
    stat = await fs.stat(absPath)
  } catch {
    return null
  }
  const vault = requireVault()
  const relPath = toRelative(absPath, vault.root)
  return {
    path: absPath,
    relPath,
    title: path.basename(absPath),
    type: 'untyped',
    frontmatter: {},
    tags: [],
    outgoingLinks: [],
    mtime: stat.mtimeMs,
    createdAt: earliestCreatedAt(absPath, relPath, stat.birthtimeMs),
    size: stat.size,
    isDirectory: false
  }
}

async function readNote(absPath: string): Promise<{ meta: NoteMeta; body: string } | null> {
  let raw: string
  try {
    raw = await readText(absPath)
  } catch {
    return null
  }
  const stat = await fs.stat(absPath)
  const vault = requireVault()
  const relPath = toRelative(absPath, vault.root)
  const { data, body } = parseFrontmatter(raw)
  const fallbackTitle = path.basename(absPath, path.extname(absPath))
  const title = extractTitle(body, fallbackTitle)
  const tags = extractTags(data)
  const type = detectType(data, relPath)
  // Frontmatter counts too: `company: "[[Acme]]"` is a link by anyone's
  // reading, and rename already rewrites it — it rewrites the whole file, not
  // just the body — so leaving it out of the graph made backlinks and the
  // dead-link report disagree with what a rename would actually change.
  const outgoingLinks = [...new Set([...extractWikilinks(body), ...frontmatterLinkTargets(data)])]
  const id = typeof data['id'] === 'string' ? (data['id'] as string) : undefined
  const meta: NoteMeta = {
    path: absPath,
    relPath,
    title,
    type,
    frontmatter: data,
    tags,
    outgoingLinks,
    mtime: stat.mtimeMs,
    createdAt: earliestCreatedAt(absPath, relPath, stat.birthtimeMs),
    preview: derivePreview(body),
    size: stat.size,
    isDirectory: false
  }
  if (id) meta.id = id
  return { meta, body }
}

function derivePreview(body: string): string {
  const lines = body.split('\n')
  const picked: string[] = []
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (/^#{1,6}\s/.test(line)) continue // heading line — skip
    if (/^(---|===)\s*$/.test(line)) continue // hr / setext underline
    if (/^<!--.*-->$/.test(line)) continue // html comment
    const cleaned = stripMarkdown(line)
    if (!cleaned) continue
    picked.push(cleaned)
    if (picked.length >= 2) break
  }
  const text = picked.join(' ').replace(/\s+/g, ' ').trim()
  return text.length > 160 ? `${text.slice(0, 157)}…` : text
}

function stripMarkdown(line: string): string {
  return line
    .replace(/^\s*>\s?/, '') // blockquote
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s*/, '') // task checkbox
    .replace(/^\s*[-*+]\s+/, '') // list bullet
    .replace(/^\s*\d+\.\s+/, '') // ordered list
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links → text
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, a, b) => b || a) // wikilinks
    .replace(/`([^`]+)`/g, '$1') // inline code
    .replace(/\*\*([^*]+)\*\*/g, '$1') // bold
    .replace(/\*([^*]+)\*/g, '$1') // italic
    .replace(/__([^_]+)__/g, '$1') // bold (underscore)
    .replace(/_([^_]+)_/g, '$1') // italic (underscore)
    .replace(/~~([^~]+)~~/g, '$1') // strikethrough
    .replace(/<!--.*?-->/g, '') // inline html comments
    .replace(/\s+/g, ' ')
    .trim()
}

function indexNote(
  s: IndexState,
  meta: NoteMeta,
  body: string,
  opts: { indexSearch?: boolean } = {}
): void {
  const { indexSearch = true } = opts
  const prev = s.byPath.get(meta.path)
  if (prev) removeFromIndex(s, prev)

  s.byPath.set(meta.path, meta)
  if (meta.id) s.byId.set(meta.id, meta.path)

  const typeSet = s.byType.get(meta.type) ?? new Set<string>()
  typeSet.add(meta.path)
  s.byType.set(meta.type, typeSet)

  for (const tag of meta.tags) {
    const set = s.byTag.get(tag) ?? new Set<string>()
    set.add(meta.path)
    s.byTag.set(tag, set)
  }

  const folder = path.dirname(meta.relPath)
  const folderSet = s.byFolder.get(folder) ?? new Set<string>()
  folderSet.add(meta.path)
  s.byFolder.set(folder, folderSet)

  s.links.set(meta.path, new Set(meta.outgoingLinks))
  for (const target of meta.outgoingLinks) {
    const back = s.backlinks.get(target) ?? new Set<string>()
    back.add(meta.path)
    s.backlinks.set(target, back)
  }

  s.tasks = s.tasks.filter((t) => t.notePath !== meta.path)
  s.tasks.push(...parseTasksFromBody(meta.path, body))

  if (indexSearch) {
    if (s.search.has(meta.path)) s.search.discard(meta.path)
    s.search.add(metaToDoc(meta, body))
  }
}

function removeFromIndex(s: IndexState, meta: NoteMeta): void {
  s.byPath.delete(meta.path)
  if (meta.id) s.byId.delete(meta.id)

  const typeSet = s.byType.get(meta.type)
  if (typeSet) {
    typeSet.delete(meta.path)
    if (typeSet.size === 0) s.byType.delete(meta.type)
  }
  for (const tag of meta.tags) {
    const set = s.byTag.get(tag)
    if (set) {
      set.delete(meta.path)
      if (set.size === 0) s.byTag.delete(tag)
    }
  }
  const folder = path.dirname(meta.relPath)
  const folderSet = s.byFolder.get(folder)
  if (folderSet) {
    folderSet.delete(meta.path)
    if (folderSet.size === 0) s.byFolder.delete(folder)
  }
  for (const target of meta.outgoingLinks) {
    const back = s.backlinks.get(target)
    if (back) {
      back.delete(meta.path)
      if (back.size === 0) s.backlinks.delete(target)
    }
  }
  s.links.delete(meta.path)
  s.tasks = s.tasks.filter((t) => t.notePath !== meta.path)

  if (s.search.has(meta.path)) s.search.discard(meta.path)
}

export async function rebuildIndex(): Promise<IndexStats> {
  const start = Date.now()
  // Read before the walk below re-stats every file: birthtime on disk may
  // already have moved forward, and this is the only record of the original.
  createdAtFloor = await loadCreatedAtFloor()
  const fresh = emptyState()
  for (const dir of await listVaultDirs()) fresh.dirs.add(dir)
  const files = await listVaultFiles()
  for (const file of files) {
    if (isParseableNote(file)) {
      const result = await readNote(file)
      if (result) indexNote(fresh, result.meta, '', { indexSearch: false })
    } else {
      const stub = await statStub(file)
      if (stub) indexNote(fresh, stub, '', { indexSearch: false })
    }
  }
  for (const meta of fresh.byPath.values()) {
    if (isExcalidrawPath(meta.path) || !isParseableNote(meta.path)) continue
    try {
      const raw = await readText(meta.path)
      const { body } = parseFrontmatter(raw)
      fresh.tasks = fresh.tasks.filter((t) => t.notePath !== meta.path)
      fresh.tasks.push(...parseTasksFromBody(meta.path, body))
      if (fresh.search.has(meta.path)) fresh.search.discard(meta.path)
      fresh.search.add(metaToDoc(meta, body))
    } catch {}
  }
  state = fresh
  const stats = computeStats(Date.now() - start)
  await persistCache().catch(() => {})
  return stats
}

export function getState(): IndexState {
  if (!state) throw new Error('Index not initialized')
  return state
}

export function isInitialized(): boolean {
  return state !== null
}

export async function applyFileChange(event: FileChangeEvent): Promise<void> {
  if (!state) return

  // The watcher reports everything under the vault root, including the CLI
  // config directories the full walk skips. Without this the two disagreed:
  // a file written into `.claude/skills/` was indexed as a note until the
  // next rebuild silently dropped it again.
  const vault = getVault()
  if (vault && isIgnoredVaultPath(event.path, vault.root)) return

  if (event.kind === 'addDir') {
    state.dirs.add(event.path)
    return
  }
  if (event.kind === 'unlinkDir') {
    state.dirs.delete(event.path)
    const prefix = `${event.path}/`
    for (const d of state.dirs) if (d.startsWith(prefix)) state.dirs.delete(d)
    return
  }

  if (event.kind === 'unlink') {
    const meta = state.byPath.get(event.path)
    if (meta) {
      // Deliberately *keep* the creation time rather than dropping it: an
      // atomic write can surface as unlink+add rather than change (the rename
      // swaps in a different inode), and forgetting here would reset the date
      // on an ordinary save. `forgetCreatedAt` handles the one case where the
      // path really is starting over — see `createNote`.
      if (meta.createdAt !== undefined) {
        createdAtFloor ??= new Map()
        createdAtFloor.set(meta.relPath, meta.createdAt)
      }
      removeFromIndex(state, meta)
    }
    return
  }
  if (event.kind === 'add' || event.kind === 'change') {
    if (!isParseableNote(event.path)) {
      const stub = await statStub(event.path)
      if (stub) indexNote(state, stub, '')
      return
    }
    const result = await readNote(event.path)
    if (!result) return
    indexNote(state, result.meta, '')
    if (isExcalidrawPath(event.path)) return
    try {
      const raw = await readText(event.path)
      const { body } = parseFrontmatter(raw)
      state.tasks = state.tasks.filter((t) => t.notePath !== event.path)
      state.tasks.push(...parseTasksFromBody(event.path, body))
      if (state.search.has(event.path)) state.search.discard(event.path)
      state.search.add(metaToDoc(result.meta, body))
    } catch {}
  }
}

export function listAllNotes(): NoteMeta[] {
  if (!state) return []
  return [...state.byPath.values()]
}

export function listAllDirs(): string[] {
  if (!state) return []
  return [...state.dirs]
}

export function getNoteMeta(absPath: string): NoteMeta | null {
  return state?.byPath.get(absPath) ?? null
}

export function getNoteByRelPath(relPath: string): NoteMeta | null {
  if (!state) return null
  for (const meta of state.byPath.values()) {
    if (meta.relPath === relPath) return meta
  }
  return null
}

/**
 * Now resolved with the shared wikilink rule instead of an exact,
 * case-sensitive basename match against `state.backlinks`. That old rule was
 * stricter than the one the editor uses to open a link, so `[[my note]]`
 * pointing at `My Note.md` opened correctly but never showed up here.
 *
 * `state.backlinks` is still maintained — it is keyed by the raw link text,
 * which is what makes rewriting links on rename cheap — it just is not the
 * thing that answers this question any more.
 */
export function getBacklinks(absPath: string): NoteMeta[] {
  if (!state) return []
  if (!state.byPath.has(absPath)) return []
  return computeBacklinks([...state.byPath.values()], absPath)
}

export function getLinkHealth(): LinkHealth {
  if (!state) return { dead: [], orphans: [], checkedNotes: 0 }
  return computeLinkHealth([...state.byPath.values()])
}

export function searchNotes(query: string, limit = 25): SearchResult[] {
  if (!state) return []
  const results = state.search.search(query, { fuzzy: 0.2, prefix: true })
  return results.slice(0, limit).map((r) => {
    const path = r['path'] as string
    const title = (r['title'] as string) ?? ''
    const type = ((r['type'] as string) ?? 'untyped') as NoteTypeId
    return { path, title, type, score: r.score, matchedIn: matchedField(r.match) }
  })
}

/**
 * Where a hit came from, out of what MiniSearch reports per matched term.
 *
 * `match` is `{ term: [fields…] }`. The title is named first because a note
 * whose name matches is what someone searching for a name meant; the body is
 * the interesting case, since that is the half of the index no screen in the
 * app could reach until now.
 *
 * Deliberately derived rather than stored: keeping the body in `storeFields`
 * to build an excerpt would hold a second copy of every note in memory, and
 * saying which half matched is most of the value at none of the cost.
 */
function matchedField(match: Record<string, string[]> | undefined): 'title' | 'text' | 'tags' {
  const fields = new Set(Object.values(match ?? {}).flat())
  if (fields.has('title')) return 'title'
  if (fields.has('tags')) return 'tags'
  return 'text'
}

export function listTasks(): Task[] {
  return state?.tasks ?? []
}

function computeStats(buildMs: number): IndexStats {
  const s = state
  if (!s) return { totalNotes: 0, totalAssets: 0, totalTasks: 0, byType: {}, buildMs }
  const byType: Record<string, number> = {}
  for (const [type, paths] of s.byType) byType[type] = paths.size
  return {
    totalNotes: s.byPath.size,
    totalAssets: s.byType.get('asset')?.size ?? 0,
    totalTasks: s.tasks.length,
    byType,
    buildMs
  }
}

export function getStats(buildMs = 0): IndexStats {
  return computeStats(buildMs)
}

export async function persistCache(): Promise<void> {
  if (!state) return
  const vault = requireVault()
  await ensureDir(vaultMetaDir(vault.root))
  const snapshot = {
    version: 1,
    builtAt: Date.now(),
    notes: [...state.byPath.values()]
  }
  await writeJson(vaultCacheFile(vault.root), snapshot)
}

export async function loadCache(): Promise<boolean> {
  const vault = requireVault()
  const snap = await readJson<{ version: number; builtAt: number; notes: NoteMeta[] }>(
    vaultCacheFile(vault.root)
  )
  if (!snap || snap.version !== 1) return false
  return Array.isArray(snap.notes)
}

export function reset(): void {
  state = null
  createdAtFloor = null
}
