import { promises as fsp } from 'node:fs'
import { contextFilename } from '@shared/context-filename'
import { currentProvider } from '@main/providers/engine-choice'
import path from 'node:path'
import type { FileChangeEvent, FolderContextFile, FolderContextSnapshot } from '@shared/types'
import { onFileChange } from '@main/vault/events'
import { parseFolderContext } from './format'

/** The basename these file-watcher callbacks are matching against right now.
 *  Read fresh each time rather than cached at import time — a provider switch
 *  must be visible to the very next file event, not just the next process
 *  restart. Cheap: `currentProvider()` is a settings-cache read, no I/O. */
function activeFilename(): string {
  return contextFilename(currentProvider())
}

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  '.mindex',
  '.vault',
  '.obsidian',
  '.backups',
  '.claude'
])

interface CacheEntry {
  file: FolderContextFile
  mtime: number
}

const cache = new Map<string, CacheEntry>() // key: abs path of the context file
let initialised = false
let unsubscribe: (() => void) | null = null
let updateListener: ((payload: { folderRel: string }) => void) | null = null

export function setFolderContextUpdateListener(
  listener: ((payload: { folderRel: string }) => void) | null
): void {
  updateListener = listener
}

export function startFolderContextAggregator(opts: { vaultRoot: string }): { stop(): void } {
  if (unsubscribe) unsubscribe()
  cache.clear()
  initialised = false
  unsubscribe = onFileChange((event) => {
    void handleEvent(opts.vaultRoot, event)
  })
  return {
    stop() {
      if (unsubscribe) {
        unsubscribe()
        unsubscribe = null
      }
      cache.clear()
      initialised = false
    }
  }
}

export async function getFolderContextSnapshot(vaultRoot: string): Promise<FolderContextSnapshot> {
  if (!initialised) await primeCache(vaultRoot)
  return {
    files: [...cache.values()].map((c) => c.file),
    builtAt: Date.now()
  }
}

export async function readFolderContext(
  vaultRoot: string,
  folderRel: string
): Promise<FolderContextFile | null> {
  const folderAbs = folderRel
    ? path.join(vaultRoot, folderRel.split('/').join(path.sep))
    : vaultRoot
  const absPath = path.join(folderAbs, activeFilename())
  const existing = cache.get(absPath)
  if (existing) return existing.file
  try {
    const content = await fsp.readFile(absPath, 'utf8')
    const parsed = parseFolderContext(content, folderRel)
    return parsed
  } catch {
    return null
  }
}

export async function applyFolderContextFileChange(
  vaultRoot: string,
  absPath: string
): Promise<void> {
  if (path.basename(absPath) !== activeFilename()) return
  if (path.dirname(absPath) === vaultRoot) return
  let stat: Awaited<ReturnType<typeof fsp.stat>>
  try {
    stat = await fsp.stat(absPath)
  } catch {
    cache.delete(absPath)
    notify(folderRelOf(vaultRoot, absPath))
    return
  }
  let content = ''
  try {
    content = await fsp.readFile(absPath, 'utf8')
  } catch {
    cache.delete(absPath)
    notify(folderRelOf(vaultRoot, absPath))
    return
  }
  const folderRel = folderRelOf(vaultRoot, absPath)
  const parsed = parseFolderContext(content, folderRel)
  cache.set(absPath, { file: parsed, mtime: stat.mtimeMs })
  notify(folderRel)
}

async function handleEvent(vaultRoot: string, event: FileChangeEvent): Promise<void> {
  if (event.kind === 'addDir' || event.kind === 'unlinkDir') return
  if (path.basename(event.path) !== activeFilename()) return
  if (event.kind === 'unlink') {
    cache.delete(event.path)
    notify(folderRelOf(vaultRoot, event.path))
    return
  }
  await applyFolderContextFileChange(vaultRoot, event.path)
}

async function primeCache(vaultRoot: string): Promise<void> {
  initialised = true
  // Resolved once for the whole walk, not per entry — a directory-tree scan
  // makes far too many comparisons to justify re-reading settings for each.
  await walk(vaultRoot, vaultRoot, /*isRoot*/ true, activeFilename())
}

async function walk(
  vaultRoot: string,
  dir: string,
  isRoot: boolean,
  filename: string
): Promise<void> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (IGNORED_DIRS.has(e.name) || e.name === '.DS_Store') continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      await walk(vaultRoot, full, false, filename)
    } else if (e.name === filename && !isRoot) {
      await applyFolderContextFileChange(vaultRoot, full)
    }
  }
}

function folderRelOf(vaultRoot: string, contextAbsPath: string): string {
  const rel = path.relative(vaultRoot, path.dirname(contextAbsPath))
  return rel.split(path.sep).join('/')
}

function notify(folderRel: string): void {
  updateListener?.({ folderRel })
}

export function invalidateFolderContextCache(): void {
  cache.clear()
  initialised = false
}
