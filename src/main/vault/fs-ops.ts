import fs from 'node:fs/promises'
import path from 'node:path'
import { ensureDir, fileExists, readText } from '@main/util/fs-helpers'
import { isPathInside, vaultTmpDir } from '@main/util/paths'
import { atomicWriteText } from '@main/claude/config/atomic'
import { requireVault } from './state'

export function resolveInVault(relPath: string): string {
  const vault = requireVault()
  const abs = path.resolve(vault.root, relPath)
  if (abs !== vault.root && !isPathInside(abs, vault.root)) {
    throw new Error(`Path escapes vault: ${relPath}`)
  }
  return abs
}

export async function readNoteFile(relPath: string): Promise<string> {
  const abs = resolveInVault(relPath)
  return await readText(abs)
}

export async function writeNoteFile(relPath: string, content: string): Promise<void> {
  const vault = requireVault()
  const abs = resolveInVault(relPath)
  // Every write to a user's note goes through here, so it is the one place
  // that must not be able to leave a half-written file behind. The temp file
  // is staged in `.mindex/tmp/` rather than beside the note — see
  // `vaultTmpDir` for why a sibling would confuse the watcher.
  await atomicWriteText(abs, content, { tmpDir: vaultTmpDir(vault.root) })
}

export async function deleteFile(relPath: string): Promise<void> {
  const abs = resolveInVault(relPath)
  await fs.rm(abs, { force: true })
}

export async function renameFile(oldRel: string, newRel: string): Promise<void> {
  const oldAbs = resolveInVault(oldRel)
  const newAbs = resolveInVault(newRel)
  if (await fileExists(newAbs)) throw new Error(`Target already exists: ${newRel}`)
  await ensureDir(path.dirname(newAbs))
  await fs.rename(oldAbs, newAbs)
}

const IGNORED_FILENAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini'])

// The CLI config directories are all three here, not just `.claude`. They
// hold the agent's own context files, commands and skills — including the
// note-type skill Mindex generates — and none of that is a note. Leaving
// `.codex`/`.gemini` out meant a vault whose active provider was either of
// those indexed its own generated config as content.
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.obsidian',
  '.mindex',
  '.vault',
  '.backups',
  '.claude',
  '.codex',
  '.gemini'
])

/**
 * Whether a path is one the vault walk above would have skipped.
 *
 * Exported because the incremental path disagreed with the full one: the file
 * watcher does not apply this list, so anything appearing under `.claude/` was
 * indexed live as a note and only disappeared at the next full rebuild. Two
 * answers to "is this a note" is one too many.
 */
export function isIgnoredVaultPath(absPath: string, vaultRoot: string): boolean {
  const rel = path.relative(vaultRoot, absPath)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return true
  const parts = rel.split(path.sep)
  const base = parts[parts.length - 1]
  if (base && IGNORED_FILENAMES.has(base)) return true
  return parts.slice(0, -1).some((segment) => IGNORED_DIRS.has(segment))
}

export async function listMarkdownFiles(): Promise<string[]> {
  return listVaultFiles({ markdownOnly: true })
}

export async function listVaultFiles(opts?: { markdownOnly?: boolean }): Promise<string[]> {
  const vault = requireVault()
  const out: string[] = []
  const markdownOnly = opts?.markdownOnly === true

  async function walk(dir: string): Promise<void> {
    let entries: import('node:fs').Dirent<string>[] = []
    try {
      entries = (await fs.readdir(dir, {
        withFileTypes: true
      })) as import('node:fs').Dirent<string>[]
    } catch {
      return
    }
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue
      if (IGNORED_FILENAMES.has(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile()) {
        if (markdownOnly) {
          const lower = full.toLowerCase()
          if (lower.endsWith('.md') || lower.endsWith('.excalidraw')) out.push(full)
        } else {
          out.push(full)
        }
      }
    }
  }

  await walk(vault.root)
  return out
}

export async function listVaultDirs(): Promise<string[]> {
  const vault = requireVault()
  const out: string[] = []

  async function walk(dir: string): Promise<void> {
    let entries: import('node:fs').Dirent<string>[] = []
    try {
      entries = (await fs.readdir(dir, {
        withFileTypes: true
      })) as import('node:fs').Dirent<string>[]
    } catch {
      return
    }
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue
      if (IGNORED_FILENAMES.has(entry.name)) continue
      if (!entry.isDirectory()) continue
      const full = path.join(dir, entry.name)
      out.push(full)
      await walk(full)
    }
  }

  await walk(vault.root)
  return out
}
