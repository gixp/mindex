import { promises as fsp } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { FileChangeEvent } from '@shared/types'
import { onFileChange } from '@main/vault/events'
import { historyLogFile, toRelative } from '@main/util/paths'
import { appendVersion, readLog, rewriteLog, writeBlob } from './log'
import { resolveAuthor, agentWriteDetail } from './attribution'
import { activeEngineFeature } from './engine-activity'

const DEBOUNCE_MS = 1_500
const DEFAULT_SIZE_CAP = 2 * 1024 * 1024 // 2 MB
const EXCALIDRAW_SIZE_CAP = 10 * 1024 * 1024 // 10 MB — drawings are bigger

const SKIP_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.ico',
  '.svg',
  '.mp3',
  '.wav',
  '.m4a',
  '.aac',
  '.flac',
  '.ogg',
  '.mp4',
  '.mov',
  '.avi',
  '.mkv',
  '.webm',
  '.zip',
  '.gz',
  '.tar',
  '.7z',
  '.rar',
  '.pdf',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot'
])

interface HistoryFeatureHandle {
  stop(): void
}

let active: HistoryFeatureHandle | null = null

let updateListener: ((relPath: string) => void) | null = null
export function setHistoryUpdateListener(cb: (relPath: string) => void): void {
  updateListener = cb
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()

function newId(): string {
  return crypto.randomBytes(8).toString('hex')
}

function isSidecar(base: string): boolean {
  return /\.(bak|tmp)$/i.test(base) || /\.tmp\./i.test(base)
}

function pathAllowed(absPath: string): boolean {
  const base = path.basename(absPath)
  if (base === '.DS_Store') return false
  if (isSidecar(base)) return false
  const ext = path.extname(base).toLowerCase()
  if (SKIP_EXTENSIONS.has(ext)) return false
  return true
}

function contentAllowed(absPath: string, buf: Buffer): boolean {
  const ext = path.extname(absPath).toLowerCase()
  const cap = ext === '.excalidraw' ? EXCALIDRAW_SIZE_CAP : DEFAULT_SIZE_CAP
  if (buf.byteLength > cap) return false
  const probe = buf.subarray(0, 8192)
  if (probe.includes(0)) return false
  return true
}

async function captureFile(vaultRoot: string, absPath: string): Promise<void> {
  if (!pathAllowed(absPath)) return
  let buf: Buffer
  try {
    buf = await fsp.readFile(absPath)
  } catch {
    return
  }
  if (!contentAllowed(absPath, buf)) return
  const relPath = toRelative(absPath, vaultRoot)
  const { hash, size } = await writeBlob(vaultRoot, buf)
  const log = await readLog(vaultRoot, relPath)
  const last = log?.versions[log.versions.length - 1]
  if (last && !last.deleted && last.blobHash === hash) return
  const feature = activeEngineFeature()
  const author = resolveAuthor(absPath, feature !== null)
  // A running engine job names itself; an applied AI proposal left its label
  // as a mark (`markAgentWrite`) because it does not run as one.
  const detail = feature ?? agentWriteDetail(absPath)
  await appendVersion(vaultRoot, relPath, {
    id: newId(),
    ts: Date.now(),
    size,
    blobHash: hash,
    author,
    ...(author === 'agent' && detail ? { authorDetail: detail } : {})
  })
  updateListener?.(relPath)
}

async function captureTombstone(vaultRoot: string, absPath: string): Promise<void> {
  if (!pathAllowed(absPath)) return
  const relPath = toRelative(absPath, vaultRoot)
  const log = await readLog(vaultRoot, relPath)
  if (!log || log.versions.length === 0) return
  const last = log.versions[log.versions.length - 1]
  if (last?.deleted) return
  await appendVersion(vaultRoot, relPath, { id: newId(), ts: Date.now(), deleted: true })
  updateListener?.(relPath)
}

function schedule(vaultRoot: string, absPath: string, run: () => Promise<void>): void {
  const existing = timers.get(absPath)
  if (existing) clearTimeout(existing)
  timers.set(
    absPath,
    setTimeout(() => {
      timers.delete(absPath)
      void run().catch(() => {})
    }, DEBOUNCE_MS)
  )
}

export function startHistoryFeature(opts: { vaultRoot: string }): HistoryFeatureHandle {
  if (active) active.stop()
  const root = opts.vaultRoot

  const off = onFileChange((event: FileChangeEvent) => {
    if (event.kind === 'addDir' || event.kind === 'unlinkDir') return
    if (event.kind === 'unlink') {
      schedule(root, event.path, () => captureTombstone(root, event.path))
      return
    }
    schedule(root, event.path, () => captureFile(root, event.path))
  })

  const handle: HistoryFeatureHandle = {
    stop() {
      off()
      for (const t of timers.values()) clearTimeout(t)
      timers.clear()
      if (active === handle) active = null
    }
  }
  active = handle
  return handle
}

export function stopHistoryFeature(): void {
  active?.stop()
}

export async function rekeyHistory(
  vaultRoot: string,
  oldRel: string,
  newRel: string
): Promise<void> {
  if (oldRel === newRel) return
  const oldAbs = path.join(vaultRoot, oldRel.split('/').join(path.sep))
  const newAbs = path.join(vaultRoot, newRel.split('/').join(path.sep))
  for (const p of [oldAbs, newAbs]) {
    const t = timers.get(p)
    if (t) {
      clearTimeout(t)
      timers.delete(p)
    }
  }
  const log = await readLog(vaultRoot, oldRel)
  if (!log) return
  const newLogPath = historyLogFile(vaultRoot, newRel)
  const destLog = await readLog(vaultRoot, newRel)
  const merged = destLog
    ? [...destLog.versions, ...log.versions].sort((a, b) => a.ts - b.ts)
    : log.versions
  await rewriteLog(vaultRoot, newLogPath, { v: log.header.v, relPath: newRel }, merged)
  try {
    await fsp.unlink(historyLogFile(vaultRoot, oldRel))
  } catch {}
}
