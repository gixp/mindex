import { promises as fsp } from 'node:fs'
import { contextFilename } from '@shared/context-filename'
import { engineChoice } from '@main/providers/engine-choice'
import { getCachedAppSettings } from '@main/settings/app-settings'
import path from 'node:path'
import type { FileChangeEvent } from '@shared/types'
import { isManagedOrSidecarFilename } from '@shared/managed-files'
import { onFileChange } from '@main/vault/events'
import {
  engineScheduler,
  logEngine,
  noteAuthOrMissingFailure,
  resetAuthOrMissingCounter,
  runAgentJob,
  type AgentJobErrorReason
} from '@main/agent-engine'
import { createQuietGate } from '@main/agent-engine/quiet-window'
import { buildFolderContextPrompt } from './prompt'
import { readContextTemplate } from '@main/livingindex/template'
import { isFolderAiSyncDisabled } from './api'
import { parseFolderContext } from './format'
import { applyFolderContextFileChange } from './aggregator'
import {
  noteFolderTouched,
  noteJobFailed,
  noteJobFinished,
  noteJobStarted,
  noteJobCancelled,
  listDirtyFolders
} from './status'

export const FEATURE = 'folder-context'
const SELF_WRITE_WINDOW_MS = 5_000
const MAX_FILE_BYTES = 200 * 1024
const MAX_ENTRIES = 100

// Auto mode timings — deliberately more conservative than the 30s/60s
// scheduler-wide defaults those constants back, since manual clicks are
// attended (a stray one costs nothing extra) and auto runs are not.
const AUTO_DEBOUNCE_MS = 120_000
const AUTO_COOLDOWN_MS = 300_000
const GLOBAL_QUIET_MS = 10_000
const GLOBAL_QUIET_MAX_WAIT_MS = 180_000
const GLOBAL_QUIET_POLL_MS = 1_000

/** The master switch — off blocks both the manual click and the automatic arm. */
export function isContextEngineEnabled(): boolean {
  return getCachedAppSettings().engine?.contextEngineEnabled !== false
}

function isAutoContextEnabled(): boolean {
  return isContextEngineEnabled() && getCachedAppSettings().engine?.autoContextEnabled === true
}

// Vault-wide "something just changed" gate — so a burst of changes across
// many folders (git pull, bulk import) settles into one wave of auto-runs
// instead of a stampede firing the moment each folder's own debounce happens
// to expire. The per-folder debounce/cooldown remain the primary correctness
// mechanism; this is a best-effort smoothing layer on top.
const quietGate = createQuietGate({
  quietMs: GLOBAL_QUIET_MS,
  maxWaitMs: GLOBAL_QUIET_MAX_WAIT_MS,
  pollMs: GLOBAL_QUIET_POLL_MS
})

const IGNORED_BASENAMES = new Set([
  '.DS_Store',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb'
])

function shouldIgnoreBasename(name: string): boolean {
  if (IGNORED_BASENAMES.has(name)) return true
  if (isManagedOrSidecarFilename(name)) return true
  return false
}

interface FolderContextHandle {
  stop(): void
  rescanFolder(folderAbs: string, opts?: { immediate?: boolean }): void
}

let active: FolderContextHandle | null = null

const recentSelfWrites = new Map<string, number>()

export function markSelfWrite(absPath: string): void {
  recentSelfWrites.set(absPath, Date.now())
  if (recentSelfWrites.size > 50) {
    const cutoff = Date.now() - SELF_WRITE_WINDOW_MS
    for (const [k, ts] of recentSelfWrites) {
      if (ts < cutoff) recentSelfWrites.delete(k)
    }
  }
}

function wasSelfWrite(absPath: string): boolean {
  const ts = recentSelfWrites.get(absPath)
  if (!ts) return false
  if (Date.now() - ts > SELF_WRITE_WINDOW_MS) {
    recentSelfWrites.delete(absPath)
    return false
  }
  return true
}

export function startFolderContextFeature(opts: { vaultRoot: string }): FolderContextHandle {
  if (active) active.stop()
  const root = opts.vaultRoot

  const off = onFileChange((event: FileChangeEvent) => handleEvent(root, event))

  const handle: FolderContextHandle = {
    stop() {
      off()
      for (const j of engineScheduler.active()) {
        if (j.feature === FEATURE) engineScheduler.cancel(j.scope)
      }
      for (const j of engineScheduler.pending()) {
        if (j.feature === FEATURE) engineScheduler.cancel(j.scope)
      }
      if (active === handle) active = null
    },
    rescanFolder(folderAbs, rOpts) {
      const scope = path.resolve(folderAbs)
      engineScheduler.enqueue(
        {
          scope,
          feature: FEATURE,
          run: (signal) => runFolderContextJob(root, scope, signal)
        },
        { immediate: rOpts?.immediate ?? false }
      )
    }
  }
  active = handle
  return handle
}

export function stopFolderContextFeature(): void {
  active?.stop()
}

export function rescanFolderContextNow(folderAbs: string, opts?: { immediate?: boolean }): void {
  active?.rescanFolder(folderAbs, opts)
}

/**
 * Decides whether a raw file-change event should mark a folder touched, and
 * which folder that is — pure path logic, no I/O, so it's testable without a
 * vault on disk. `addDir`'s own `path` **is** the new folder (chokidar hands
 * back the directory itself, not something inside it) — unlike file events,
 * where the folder is the event path's parent. Getting this wrong arms the
 * new folder's parent instead of the folder that actually needs a context
 * file.
 */
export function resolveTouchedFolder(vaultRoot: string, event: FileChangeEvent): string | null {
  if (event.kind === 'unlinkDir') return null

  const base = path.basename(event.path)
  if (shouldIgnoreBasename(base)) return null
  if (wasSelfWrite(event.path)) return null
  if (base.startsWith('.')) return null

  const rel = path.relative(vaultRoot, event.path)
  if (!rel || rel.startsWith('..')) return null
  const parts = rel.split(path.sep)
  for (const p of parts) {
    if (
      p === '.git' ||
      p === 'node_modules' ||
      p === '.mindex' ||
      p === '.vault' ||
      p === '.obsidian' ||
      p === '.backups' ||
      p === '.claude'
    )
      return null
  }

  const folderAbs = event.kind === 'addDir' ? event.path : path.dirname(event.path)
  if (path.resolve(folderAbs) === path.resolve(vaultRoot)) return null
  return path.resolve(folderAbs)
}

function handleEvent(vaultRoot: string, event: FileChangeEvent): void {
  const folderAbs = resolveTouchedFolder(vaultRoot, event)
  if (!folderAbs) return
  const folderRel = path.relative(vaultRoot, folderAbs).split(path.sep).join('/')

  quietGate.markActivity()

  void (async () => {
    if (await isFolderAiSyncDisabled(folderRel)) return
    noteFolderTouched(folderAbs)
    if (isAutoContextEnabled()) armAutoRun(vaultRoot, folderAbs)
  })()
}

function armAutoRun(vaultRoot: string, folderAbs: string): void {
  const scope = path.resolve(folderAbs)
  engineScheduler.enqueue(
    {
      scope,
      feature: FEATURE,
      run: (signal) =>
        quietGate.waitForQuiet(signal).then(() => runFolderContextJob(vaultRoot, scope, signal))
    },
    { debounceMs: AUTO_DEBOUNCE_MS, cooldownMs: AUTO_COOLDOWN_MS }
  )
}

/** Cancels a folder's in-flight auto-arm before it fires. A no-op if nothing
 *  is pending for it (manual runs are always immediate, so the only pending
 *  entry a folder-context scope can have is an auto-armed one). */
export function cancelArmedAutoRun(folderAbs: string): void {
  engineScheduler.cancel(path.resolve(folderAbs))
}

/** Arms a folder for auto-regeneration, marking it `pending` first if
 *  status.ts hasn't already seen a reason to (a folder with no context file
 *  at all, or one that went stale before this session's file-watcher ever
 *  ran, never fires a live touch event on its own). Idempotent: on an
 *  already-pending folder this only refreshes `lastChange`. */
function armAutoRunForFolder(vaultRoot: string, folderAbs: string): void {
  noteFolderTouched(folderAbs)
  armAutoRun(vaultRoot, folderAbs)
}

/** Arms every folder currently pending/failed per status.ts's own live
 *  tracking — used when auto mode is switched on mid-session, so folders
 *  that went stale while it was off don't wait for their next file change
 *  to join the auto queue. */
export function armAutoRunsForPendingFolders(vaultRoot: string): void {
  for (const folderRel of listDirtyFolders()) {
    armAutoRunForFolder(vaultRoot, path.join(vaultRoot, folderRel.split('/').join(path.sep)))
  }
}

/** Arms an explicit list of folders (posix-relative, `''` excluded — the
 *  vault root isn't a folder-context scope) — for callers that already
 *  computed which folders need regenerating from a source other than
 *  status.ts's live map, e.g. `buildContextOverview`'s on-disk staleness
 *  check, which also catches folders with no context file at all and
 *  folders that went stale before this session ever started watching. */
export function armAutoRunsForFolderRels(vaultRoot: string, folderRels: string[]): void {
  for (const folderRel of folderRels) {
    if (!folderRel) continue
    armAutoRunForFolder(vaultRoot, path.join(vaultRoot, folderRel.split('/').join(path.sep)))
  }
}

export async function runFolderContextJob(
  vaultRoot: string,
  folderAbs: string,
  signal: AbortSignal
): Promise<void> {
  if (signal.aborted) {
    noteJobCancelled(folderAbs)
    return
  }
  // The single choke point for the master switch: both the manual click
  // (`rescanFolderContextNow` → `api.ts`) and the automatic arm
  // (`armAutoRun`) funnel through here, so this is the one place that has to
  // check it rather than every caller separately.
  if (!isContextEngineEnabled()) {
    noteJobCancelled(folderAbs)
    return
  }
  const folderRel = path.relative(vaultRoot, folderAbs).split(path.sep).join('/')

  // Resolved before anything else touches disk: the filename this job reads
  // and writes depends on which CLI is about to run it, not on a fixed name.
  const engine = await engineChoice()
  const FILENAME = contextFilename(engine.provider)
  const contextPath = path.join(folderAbs, FILENAME)

  noteJobStarted(folderAbs)

  let existing: string | null = null
  try {
    existing = await fsp.readFile(contextPath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      noteJobFailed(folderAbs, String((err as Error).message))
      throw err
    }
  }

  const entries = await listShallow(folderAbs)
  const template = await readContextTemplate(vaultRoot)

  const prompt = buildFolderContextPrompt({
    scope: 'folder',
    contextFilename: FILENAME,
    folderAbs,
    folderRel,
    existingContext: existing,
    fileList: entries,
    template
  })

  markSelfWrite(contextPath)

  const result = await runAgentJob({
    provider: engine.provider,
    model: engine.model,
    cwd: folderAbs,
    prompt,
    allowedTools: ['Read', 'Write', 'Glob', 'Grep'],
    outputFormat: 'stream-json',
    permissionMode: 'acceptEdits',
    signal,
    onEvent: (e) => {
      if (e.kind === 'tool_use') {
        const inputPreview =
          typeof e.input === 'object' && e.input !== null
            ? JSON.stringify(e.input).slice(0, 100)
            : ''
        logEngine('info', `${e.name}(${inputPreview})`, {
          feature: FEATURE,
          scope: folderAbs
        })
      } else if (e.kind === 'tool_result' && e.isError) {
        logEngine('warn', `tool_result error: ${e.preview ?? ''}`, {
          feature: FEATURE,
          scope: folderAbs
        })
      }
    }
  })

  if (!result.ok) {
    if (result.errorReason === 'cli_missing' || result.errorReason === 'auth') {
      noteAuthOrMissingFailure(engine.provider)
    }
    noteJobFailed(folderAbs, result.errorMessage ?? result.errorReason ?? 'unknown')
    throwFromResult(result.errorReason, result.errorMessage)
    return
  }
  resetAuthOrMissingCounter(engine.provider)

  let written: string | null = null
  try {
    written = await fsp.readFile(contextPath, 'utf8')
  } catch {}
  if (written == null) {
    logEngine('warn', `the engine did not write ${FILENAME}`, {
      feature: FEATURE,
      scope: folderAbs
    })
    noteJobFailed(folderAbs, 'no file written')
    return
  }
  try {
    parseFolderContext(written, folderRel)
  } catch {
    if (existing != null) {
      logEngine('error', `${FILENAME} unreadable after rewrite — restoring prior`, {
        feature: FEATURE,
        scope: folderAbs
      })
      markSelfWrite(contextPath)
      await fsp.writeFile(contextPath, existing, 'utf8')
    }
  }

  await applyFolderContextFileChange(vaultRoot, contextPath)
  noteJobFinished(folderAbs)
}

async function listShallow(
  folderAbs: string
): Promise<Array<{ rel: string; size: number; kind: 'file' | 'dir' }>> {
  let entries: import('node:fs').Dirent[] = []
  try {
    entries = await fsp.readdir(folderAbs, { withFileTypes: true })
  } catch {
    return []
  }
  const out: Array<{ rel: string; size: number; kind: 'file' | 'dir' }> = []
  for (const entry of entries) {
    if (shouldIgnoreBasename(entry.name)) continue
    if (
      entry.name === '.git' ||
      entry.name === 'node_modules' ||
      entry.name === '.mindex' ||
      entry.name === '.vault' ||
      entry.name === '.obsidian' ||
      entry.name === '.backups' ||
      entry.name === '.claude'
    )
      continue
    if (entry.isDirectory()) {
      out.push({ rel: entry.name, size: 0, kind: 'dir' })
    } else if (entry.isFile()) {
      try {
        const stat = await fsp.stat(path.join(folderAbs, entry.name))
        if (stat.size > MAX_FILE_BYTES) continue
        out.push({ rel: entry.name, size: stat.size, kind: 'file' })
      } catch {}
    }
    if (out.length >= MAX_ENTRIES) break
  }
  return out
}

function throwFromResult(
  reason: AgentJobErrorReason | undefined,
  message: string | undefined
): never {
  const tag = reason ? `[${reason}] ` : ''
  throw new Error(`${tag}${message ?? 'unknown error'}`)
}
