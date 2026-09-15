import path from 'node:path'
import { contextFilename } from '@shared/context-filename'
import { promises as fs } from 'node:fs'
import type { ContextOverview, FolderContextMetrics } from '@shared/suggestions'
import { approxTokens } from '@shared/suggestions'
import { isManagedOrSidecarFilename } from '@shared/managed-files'
import { getFolderContextSnapshot } from '@main/folderContext/aggregator'
import { parseFolderContext } from '@main/folderContext/format'
import { listAllNotes, listAllDirs } from '@main/index/indexer'
import { contextFile } from '@main/util/paths'
import { currentProvider } from '@main/providers/engine-choice'
import { getVaultSettings } from '@main/settings/vault-settings'

const ROOT_EXCERPT_CHARS = 1200

/**
 * Builds the "what the AI currently knows" picture. Deliberately free of any
 * Claude call — everything here is already on disk or in the index, so the
 * Context modal has something real to show the moment it opens.
 */
export async function buildContextOverview(vaultRoot: string): Promise<ContextOverview> {
  const provider = currentProvider()
  const filename = contextFilename(provider)
  const snapshot = await getFolderContextSnapshot(vaultRoot)
  const contextByFolder = new Map(snapshot.files.map((f) => [f.folderRel, f]))
  const settings = await getVaultSettings()
  const exclusions = settings.folderContext?.excludedPaths ?? []

  const notes = listAllNotes().filter(
    (n) => !n.isDirectory && !isManagedOrSidecarFilename(path.basename(n.relPath))
  )

  // Notes are bucketed by their immediate parent folder, matching how the
  // indexer and the folder-context engine both think about ownership.
  const byFolder = new Map<string, { count: number; bytes: number; newest: number }>()
  for (const note of notes) {
    const dir = path.posix.dirname(note.relPath)
    const folderRel = dir === '.' ? '' : dir
    const acc = byFolder.get(folderRel) ?? { count: 0, bytes: 0, newest: 0 }
    acc.count += 1
    acc.bytes += note.size ?? 0
    if (note.mtime > acc.newest) acc.newest = note.mtime
    byFolder.set(folderRel, acc)
  }

  // Every folder that either holds notes or already has a context file. The root
  // is handled separately below — it is excluded from the folder snapshot by
  // design, but it is the single biggest thing the AI reads.
  const folderRels = new Set<string>()
  for (const dir of listAllDirs()) {
    const rel = path.relative(vaultRoot, dir).split(path.sep).join('/')
    if (rel && !rel.startsWith('../')) folderRels.add(rel)
  }
  for (const rel of byFolder.keys()) if (rel) folderRels.add(rel)
  for (const rel of contextByFolder.keys()) if (rel) folderRels.add(rel)

  const folders: FolderContextMetrics[] = []
  for (const folderRel of folderRels) {
    const ctx = contextByFolder.get(folderRel)
    const stats = byFolder.get(folderRel) ?? { count: 0, bytes: 0, newest: 0 }
    const contextStat = ctx ? await fileMetadata(path.join(vaultRoot, folderRel, filename)) : null
    const contextBytes = contextStat?.bytes ?? 0
    const generatedAt = ctx?.generatedAt ?? contextStat?.modifiedAt
    const generatedAtMs = generatedAt ? Date.parse(generatedAt) : NaN
    const disabledBy = disabledAt(folderRel, exclusions)

    folders.push({
      folderRel,
      hasContextFile: !!ctx,
      aiDisabled: disabledBy !== null,
      ...(disabledBy ? { disabledBy } : {}),
      contextBytes,
      contextTokensApprox: approxTokens(contextBytes),
      purpose: (ctx?.purpose ?? '').trim(),
      noteCount: stats.count,
      noteBytes: stats.bytes,
      generatedAt,
      newestNoteMtime: stats.newest || undefined,
      staleness: !ctx
        ? 'missing'
        : Number.isFinite(generatedAtMs) && stats.newest > generatedAtMs
          ? 'behind'
          : 'fresh'
    })
  }

  // Folders needing attention first, then the largest context consumers.
  const rank = { missing: 0, behind: 1, fresh: 2 }
  folders.sort(
    (a, b) =>
      rank[a.staleness] - rank[b.staleness] ||
      b.noteCount - a.noteCount ||
      a.folderRel.localeCompare(b.folderRel)
  )

  const rootPath = contextFile(vaultRoot, provider)
  const rootBytes = await byteLength(rootPath)
  const rootText = rootBytes > 0 ? await readTextSafe(rootPath) : ''

  return {
    root: {
      hasContextFile: rootBytes > 0,
      bytes: rootBytes,
      tokensApprox: approxTokens(rootBytes),
      excerpt: rootText.slice(0, ROOT_EXCERPT_CHARS),
      purpose: rootText ? parseFolderContext(rootText, '').purpose.trim() : ''
    },
    folders,
    totals: {
      folders: folders.length,
      withContext: folders.filter((f) => f.hasContextFile).length,
      contextBytes: folders.reduce((n, f) => n + f.contextBytes, 0) + rootBytes,
      contextTokensApprox:
        folders.reduce((n, f) => n + f.contextTokensApprox, 0) + approxTokens(rootBytes),
      notes: notes.length,
      noteBytes: notes.reduce((n, x) => n + (x.size ?? 0), 0)
    },
    builtAt: Date.now()
  }
}

function disabledAt(folderRel: string, exclusions: string[]): string | null {
  const target = folderRel.replace(/\/+$/, '')
  for (const raw of exclusions) {
    const entry = raw.replace(/\/+$/, '')
    if (entry && (target === entry || target.startsWith(`${entry}/`))) return entry
  }
  return null
}

async function byteLength(absPath: string): Promise<number> {
  try {
    const stat = await fs.stat(absPath)
    return stat.isFile() ? stat.size : 0
  } catch {
    return 0
  }
}

async function fileMetadata(
  absPath: string
): Promise<{ bytes: number; modifiedAt: string } | null> {
  try {
    const stat = await fs.stat(absPath)
    return stat.isFile() ? { bytes: stat.size, modifiedAt: stat.mtime.toISOString() } : null
  } catch {
    return null
  }
}

async function readTextSafe(absPath: string): Promise<string> {
  try {
    return await fs.readFile(absPath, 'utf8')
  } catch {
    return ''
  }
}
