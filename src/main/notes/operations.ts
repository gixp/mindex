import fs from 'node:fs/promises'
import { withNoteExtension } from '@shared/note-types'
import path from 'node:path'
import type { NoteMeta, NoteTypeId } from '@shared/types'
import { fileExists } from '@main/util/fs-helpers'
import { WriteConflictError } from '@main/util/result'
import { fromRelative, toRelative } from '@main/util/paths'
import { capture } from '@main/telemetry/analytics'
import { requireVault } from '@main/vault/state'
import {
  deleteFile,
  listMarkdownFiles,
  readNoteFile,
  renameFile,
  resolveInVault,
  writeNoteFile
} from '@main/vault/fs-ops'
import { isProtectedManagedFile } from '@shared/managed-files'
import { isExcalidrawPath } from '@shared/excalidraw'
import { generateId, parseFrontmatter, rewriteWikilinks, serializeFrontmatter } from './frontmatter'

function refuseIfProtected(absPath: string, verb: string): void {
  const base = path.basename(absPath)
  if (isProtectedManagedFile(base)) {
    throw new Error(`Refusing to ${verb} Mindex-managed file: ${base}`)
  }
}
import { specOrUntyped, detectType } from '@main/types/registry'
import { readVaultDef } from '@main/types/definitions'
import {
  applyFileChange,
  forgetCreatedAt,
  getNoteByRelPath,
  getNoteMeta,
  listAllNotes
} from '@main/index/indexer'
import { getTemplateForType, instantiate } from '@main/templates/engine'
import { rekeyHistory } from '@main/history/store'
import { rekeyComments } from '@main/comments/store'

function nowDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function nowDateTime(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '-').trim()
}

async function computeRelativePath(
  type: NoteTypeId,
  title: string,
  folder?: string
): Promise<string> {
  // The vault's own definition first, so the Placement tab of the type editor
  // actually decides where a note lands; the registry is the factory default
  // behind it.
  const spec = (await readVaultDef(requireVault().root, type)) ?? specOrUntyped(type)
  const base = folder && folder.length > 0 ? folder : spec.defaultFolder
  let pattern = spec.filenamePattern
  pattern = pattern
    .replace('{{title}}', sanitizeFilename(title))
    .replace('{{date}}', nowDate())
    .replace('{{datetime}}', nowDateTime())
  // A pattern is free text and need not carry an extension — `asset`'s does
  // not, and the Placement tab lets any type be edited into the same shape.
  // Without this a note was written with no extension at all. See
  // `withNoteExtension` for why a name that already has one is left alone.
  return withNoteExtension(path.posix.join(base.split(path.sep).join('/'), pattern))
}

export interface CreateInput {
  type: NoteTypeId
  title: string
  folder?: string
  frontmatter?: Record<string, unknown>
  body?: string
}

export async function createNote(input: CreateInput): Promise<NoteMeta> {
  // Not called here for its own sake: `resolveInVault` below already
  // requires a vault, so an explicit `requireVault()` first was a second,
  // redundant guard for the exact same precondition.
  const relPath = await computeRelativePath(input.type, input.title, input.folder)
  const abs = resolveInVault(relPath)
  if (await fileExists(abs)) {
    throw new Error(`Note already exists: ${relPath}`)
  }
  let content: string
  if (input.body) {
    content = input.body
  } else {
    const template = await getTemplateForType(input.type)
    content = instantiate(template, {
      title: input.title,
      date: nowDate(),
      datetime: nowDateTime(),
      id: generateId(input.type)
    })
  }
  if (input.frontmatter && Object.keys(input.frontmatter).length > 0) {
    const { data, body } = parseFrontmatter(content)
    const merged = { ...data, ...input.frontmatter }
    content = serializeFrontmatter(merged, body)
  }
  // This path is starting over, so any creation date remembered for a note
  // that used to live here must not carry over to this one.
  forgetCreatedAt(relPath)
  await writeNoteFile(relPath, content)
  await applyFileChange({ kind: 'add', path: abs })
  const meta = getNoteMeta(abs)
  if (!meta) {
    return {
      path: abs,
      relPath,
      title: input.title,
      type: input.type,
      frontmatter: input.frontmatter ?? {},
      tags: [],
      outgoingLinks: [],
      mtime: Date.now(),
      size: content.length,
      isDirectory: false
    }
  }
  capture('note_created', { type: input.type })
  return meta
}

async function readRawVaultFile(
  absPath: string,
  relPath: string
): Promise<{ meta: NoteMeta; body: string }> {
  const raw = await readNoteFile(relPath)
  const stat = await fs.stat(absPath)
  return {
    meta: {
      path: absPath,
      relPath,
      title: path.basename(absPath, path.extname(absPath)),
      type: 'asset',
      frontmatter: {},
      tags: [],
      outgoingLinks: [],
      mtime: stat.mtimeMs,
      size: stat.size,
      isDirectory: false
    },
    body: raw
  }
}

export async function readNote(absPath: string): Promise<{ meta: NoteMeta; body: string }> {
  const vault = requireVault()
  const relPath = toRelative(absPath, vault.root)
  if (isExcalidrawPath(absPath)) {
    const cached = getNoteMeta(absPath)
    const result = await readRawVaultFile(absPath, relPath)
    return cached ? { meta: cached, body: result.body } : result
  }
  const isMd = absPath.toLowerCase().endsWith('.md')
  if (!isMd) {
    const cached = getNoteMeta(absPath)
    const fs = await import('node:fs/promises')
    const stat = await fs.stat(absPath)
    return {
      meta: cached ?? {
        path: absPath,
        relPath,
        title: path.basename(absPath),
        type: 'untyped',
        frontmatter: {},
        tags: [],
        outgoingLinks: [],
        mtime: stat.mtimeMs,
        createdAt: stat.birthtimeMs,
        size: stat.size,
        isDirectory: false
      },
      body: ''
    }
  }
  const raw = await readNoteFile(relPath)
  const { data, body } = parseFrontmatter(raw)
  const cached = getNoteMeta(absPath)
  if (cached) return { meta: cached, body }
  const fs = await import('node:fs/promises')
  const stat = await fs.stat(absPath)
  const title = (() => {
    const h1 = body.match(/^#\s+(.+)$/m)
    return h1?.[1]?.trim() ?? path.basename(absPath, path.extname(absPath))
  })()
  return {
    meta: {
      path: absPath,
      relPath,
      title,
      type: detectType(data, relPath),
      frontmatter: data,
      tags: [],
      outgoingLinks: [],
      mtime: stat.mtimeMs,
      size: stat.size,
      isDirectory: false
    },
    body
  }
}

/**
 * Refuse the write if the file on disk is not the one the caller last read.
 *
 * Without this, an external edit to an open note is lost without a trace: the
 * editor deliberately skips reloading a note whose tab has unsaved changes
 * (`stores/editor.ts:onExternalChange`), and the next autosave then writes
 * the stale in-memory copy over it.
 *
 * A missing file is not a conflict — recreating a note the user deleted
 * elsewhere is the normal "save brings it back" behaviour, not a collision.
 */
async function assertNotChangedOnDisk(absPath: string, expectedMtime: number): Promise<void> {
  let actual: number
  try {
    actual = (await fs.stat(absPath)).mtimeMs
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return
    throw e
  }
  if (actual !== expectedMtime) throw new WriteConflictError(expectedMtime, actual)
}

export async function writeNote(
  absPath: string,
  body: string,
  frontmatter?: Record<string, unknown>,
  expectedMtime?: number
): Promise<NoteMeta> {
  const vault = requireVault()
  const relPath = toRelative(absPath, vault.root)
  // Opt-in: callers that pass no `expectedMtime` (agent writes, migrations,
  // internal rewrites) keep the previous unconditional behaviour.
  if (expectedMtime !== undefined) await assertNotChangedOnDisk(absPath, expectedMtime)
  if (isExcalidrawPath(absPath)) {
    await writeNoteFile(relPath, body)
    await applyFileChange({ kind: 'change', path: absPath })
    const meta = getNoteMeta(absPath)
    if (!meta) throw new Error(`Failed to index drawing after write: ${relPath}`)
    return meta
  }
  let content: string
  if (frontmatter !== undefined) {
    content = serializeFrontmatter(frontmatter, body)
  } else {
    try {
      const existing = await readNoteFile(relPath)
      const { data } = parseFrontmatter(existing)
      content = Object.keys(data).length > 0 ? serializeFrontmatter(data, body) : body
    } catch {
      content = body
    }
  }
  await writeNoteFile(relPath, content)
  await applyFileChange({ kind: 'change', path: absPath })
  const meta = getNoteMeta(absPath)
  if (!meta) throw new Error(`Failed to index note after write: ${relPath}`)
  return meta
}

export async function renameNote(absPath: string, newName: string): Promise<NoteMeta> {
  refuseIfProtected(absPath, 'rename')
  const vault = requireVault()
  const oldRel = toRelative(absPath, vault.root)
  const dir = path.posix.dirname(oldRel)
  const ext = path.extname(absPath)
  const safeName = sanitizeFilename(newName.replace(new RegExp(`\\${ext}$`), ''))
  const newRel = path.posix.join(dir, `${safeName}${ext}`)
  if (newRel === oldRel) {
    const meta = getNoteMeta(absPath)
    if (!meta) throw new Error('Note not indexed')
    return meta
  }
  await renameFile(oldRel, newRel)
  await rewriteIncomingLinks(oldRel, newRel)
  await rekeyHistory(vault.root, oldRel, newRel).catch(() => {})
  await rekeyComments(vault.root, oldRel, newRel).catch(() => {})
  const newAbs = fromRelative(newRel, vault.root)
  await applyFileChange({ kind: 'unlink', path: absPath })
  await applyFileChange({ kind: 'add', path: newAbs })
  const meta = getNoteMeta(newAbs)
  if (!meta) throw new Error('Index missing after rename')
  return meta
}

export async function moveNote(absPath: string, newFolder: string): Promise<NoteMeta> {
  refuseIfProtected(absPath, 'move')
  const vault = requireVault()
  const oldRel = toRelative(absPath, vault.root)
  const filename = path.posix.basename(oldRel)
  const newRel = path.posix.join(newFolder.split(path.sep).join('/'), filename)
  if (newRel === oldRel) {
    const meta = getNoteMeta(absPath)
    if (!meta) throw new Error('Note not indexed')
    return meta
  }
  await renameFile(oldRel, newRel)
  await rewriteIncomingLinks(oldRel, newRel)
  await rekeyHistory(vault.root, oldRel, newRel).catch(() => {})
  await rekeyComments(vault.root, oldRel, newRel).catch(() => {})
  const newAbs = fromRelative(newRel, vault.root)
  await applyFileChange({ kind: 'unlink', path: absPath })
  await applyFileChange({ kind: 'add', path: newAbs })
  const meta = getNoteMeta(newAbs)
  if (!meta) throw new Error('Index missing after move')
  return meta
}

export async function deleteNote(absPath: string): Promise<void> {
  // Managed files stay protected from rename/move (see `refuseIfProtected`
  // above) — those leave a file whose name no CLI or Mindex feature
  // recognizes anymore. Delete is different: gone is gone, the folder simply
  // has no context file until something in it changes again and the
  // background engine regenerates one. Nothing to reconcile, nothing left in
  // a confusing half-renamed state.
  const vault = requireVault()
  const relPath = toRelative(absPath, vault.root)
  await deleteFile(relPath)
  await applyFileChange({ kind: 'unlink', path: absPath })
}

export async function createFolder(input: {
  folder?: string
  name: string
}): Promise<{ path: string; relPath: string }> {
  const parent = (input.folder ?? '')
    .split(path.sep)
    .join('/')
    .replace(/^\/+|\/+$/g, '')
  const name = sanitizeFilename(input.name)
  const relPath = parent ? path.posix.join(parent, name) : name
  const abs = resolveInVault(relPath)
  if (await fileExists(abs)) {
    throw new Error(`Folder already exists: ${relPath}`)
  }
  await fs.mkdir(abs, { recursive: true })
  await applyFileChange({ kind: 'addDir', path: abs })
  return { path: abs, relPath }
}

/**
 * Every directory at or below `absRoot`, itself included.
 *
 * Used to tell the index about a folder tree that has just arrived somewhere
 * new. The index keeps folders in a set of its own, separate from the notes,
 * because a folder with nothing in it is not implied by any note's path —
 * and that is exactly the folder a rename or a move would otherwise lose.
 */
async function dirsUnder(absRoot: string): Promise<string[]> {
  const out: string[] = [absRoot]
  async function walk(dir: string): Promise<void> {
    let entries: import('node:fs').Dirent<string>[] = []
    try {
      entries = (await fs.readdir(dir, { withFileTypes: true })) as import('node:fs').Dirent<
        string
      >[]
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const full = path.join(dir, entry.name)
      out.push(full)
      await walk(full)
    }
  }
  await walk(absRoot)
  return out
}

/**
 * Move a folder's whole subtree from one vault-relative path to another.
 *
 * Shared by `moveFolder` (same name, new parent) and `renameFolder` (same
 * parent, new name), which differ only in how they work out where the folder
 * is going. Everything after that — the notes inside it, the links pointing
 * at them, their history and their comments — is the same job.
 */
async function relocateFolder(oldRel: string, newRel: string, vaultRoot: string): Promise<void> {
  const oldPrefix = `${oldRel}/`
  const affected = listAllNotes()
    .filter((n) => n.relPath === oldRel || n.relPath.startsWith(oldPrefix))
    .map((n) => ({
      oldAbs: n.path,
      oldRel: n.relPath,
      newRel: `${newRel}/${n.relPath.slice(oldPrefix.length)}`
    }))
  const oldAbs = fromRelative(oldRel, vaultRoot)
  const newAbs = fromRelative(newRel, vaultRoot)
  await renameFile(oldRel, newRel)
  // The folders themselves, before the notes. `unlinkDir` drops the old path
  // and everything under it; the walk then puts the same tree back under its
  // new name. Without this pair a renamed empty folder keeps its old name in
  // the sidebar until the next full rebuild, and a moved one shows up twice.
  await applyFileChange({ kind: 'unlinkDir', path: oldAbs })
  for (const dir of await dirsUnder(newAbs)) {
    await applyFileChange({ kind: 'addDir', path: dir })
  }
  for (const n of affected) {
    await applyFileChange({ kind: 'unlink', path: n.oldAbs })
    await applyFileChange({ kind: 'add', path: fromRelative(n.newRel, vaultRoot) })
    await rewriteIncomingLinks(n.oldRel, n.newRel)
    await rekeyHistory(vaultRoot, n.oldRel, n.newRel).catch(() => {})
    await rekeyComments(vaultRoot, n.oldRel, n.newRel).catch(() => {})
  }
}

export async function moveFolder(absPath: string, newParentFolder: string): Promise<void> {
  const vault = requireVault()
  const oldRel = toRelative(absPath, vault.root)
  if (oldRel === '' || oldRel === '.') throw new Error('Refusing to move vault root')
  const folderName = path.posix.basename(oldRel)
  const parent = newParentFolder.split(path.sep).join('/').replace(/\/+$/, '')
  const newRel = parent === '' ? folderName : path.posix.join(parent, folderName)
  if (newRel === oldRel) return
  if (newRel === oldRel || newRel.startsWith(`${oldRel}/`)) {
    throw new Error('Refusing to move folder into itself')
  }
  await relocateFolder(oldRel, newRel, vault.root)
}

/**
 * Give a folder a different name, where it already is.
 *
 * The sidebar offered this for a note and not for a folder, so the only way
 * to correct a folder's name was to make a new one, drag everything across
 * and delete the old — which loses nothing but takes a dozen gestures, and
 * is how a folder ends up named "Untitled folder" forever.
 */
export async function renameFolder(
  absPath: string,
  newName: string
): Promise<{ path: string; relPath: string }> {
  const vault = requireVault()
  const oldRel = toRelative(absPath, vault.root)
  if (oldRel === '' || oldRel === '.') throw new Error('Refusing to rename vault root')
  const name = sanitizeFilename(newName)
  if (!name) throw new Error('A folder needs a name')
  const parentRel = path.posix.dirname(oldRel)
  const newRel = parentRel === '.' ? name : path.posix.join(parentRel, name)
  const newAbs = fromRelative(newRel, vault.root)
  if (newRel === oldRel) return { path: absPath, relPath: oldRel }
  // Case-only renames are a rename on every filesystem Mindex runs on, but
  // on the case-insensitive ones macOS and Windows ship by default the new
  // path "already exists" — it is the same folder. Asking whether the name
  // differs only in case is what tells those two cases apart.
  if (newRel.toLowerCase() !== oldRel.toLowerCase() && (await fileExists(newAbs))) {
    throw new Error(`Folder already exists: ${newRel}`)
  }
  await relocateFolder(oldRel, newRel, vault.root)
  return { path: newAbs, relPath: newRel }
}

export async function deleteFolder(absPath: string): Promise<void> {
  const vault = requireVault()
  const relPath = toRelative(absPath, vault.root)
  if (relPath === '' || relPath === '.') throw new Error('Refusing to delete vault root')
  const prefix = relPath.endsWith('/') ? relPath : `${relPath}/`
  const affected = listAllNotes().filter(
    (n) => n.relPath === relPath || n.relPath.startsWith(prefix)
  )
  const abs = resolveInVault(relPath)
  await fs.rm(abs, { recursive: true, force: true })
  for (const note of affected) {
    await applyFileChange({ kind: 'unlink', path: note.path })
  }
}

async function rewriteIncomingLinks(oldRel: string, newRel: string): Promise<void> {
  const oldNoExt = oldRel.replace(/\.md$/, '')
  const newNoExt = newRel.replace(/\.md$/, '')
  const oldBase = path.posix.basename(oldNoExt)
  const newBase = path.posix.basename(newNoExt)

  const all = await listMarkdownFiles()
  for (const file of all) {
    try {
      const content = await readNoteFile(toRelative(file, requireVault().root))
      let next = content
      next = rewriteWikilinks(next, oldBase, newBase)
      if (oldNoExt !== oldBase) {
        next = rewriteWikilinks(next, oldNoExt, newNoExt)
      }
      if (next !== content) {
        await writeNoteFile(toRelative(file, requireVault().root), next)
        await applyFileChange({ kind: 'change', path: file })
      }
    } catch {}
  }
}

export function listAllNoteMetas(): NoteMeta[] {
  return listAllNotes()
}

export function getNoteByRelative(relPath: string): NoteMeta | null {
  return getNoteByRelPath(relPath)
}

/**
 * An ordering prefix on a filename: "01 - ", "02.", "3) ", "10 ".
 *
 * The separator is consumed along with the number. It was not, so "01 - Atlas"
 * came out as "- Atlas" — the number went and the dash it was joined to
 * stayed. Nobody saw that before, because this ran with no confirmation and no
 * report; it is now offered as "rename 12 files" with a promise about what
 * they will be called.
 *
 * At most three digits, and a separator or a space is required after them, so
 * a name that simply opens with a number keeps it: "2026 review" is a title,
 * and "01Atlas" is one word.
 */
const NUMBER_PREFIX_RE = /^\s*\d{1,3}(?:\s*[-–—._)]+\s*|\s+)/

/**
 * Drop "01 - " style ordering prefixes from note filenames across the vault.
 *
 * `dryRun` counts what would change without touching anything, so the person
 * can be told how many files this is about before being asked to approve it.
 * Same walk either way, so the number in the question is the number that
 * happens.
 */
export async function stripNumberPrefixes(vaultRoot: string, dryRun = false): Promise<number> {
  const notes = listAllNotes().filter(
    (n) => !n.isDirectory && n.relPath.toLowerCase().endsWith('.md')
  )
  let renamed = 0
  for (const n of notes) {
    const ext = path.extname(n.path)
    const base = path.basename(n.path, ext)
    if (!NUMBER_PREFIX_RE.test(base)) continue
    if (isProtectedManagedFile(path.basename(n.path))) continue
    const stripped = base.replace(NUMBER_PREFIX_RE, '').trim()
    if (!stripped) continue
    const dir = path.posix.dirname(n.relPath)
    const targetRel = dir === '.' ? `${stripped}${ext}` : path.posix.join(dir, `${stripped}${ext}`)
    if (targetRel === n.relPath) continue
    const targetAbs = fromRelative(targetRel, vaultRoot)
    if (await fileExists(targetAbs)) continue
    if (dryRun) {
      renamed++
      continue
    }
    try {
      await renameNote(n.path, stripped)
      renamed++
    } catch {}
  }
  return renamed
}
