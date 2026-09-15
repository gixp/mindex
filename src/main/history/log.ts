import { promises as fsp } from 'node:fs'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { promisify } from 'node:util'
import type { HistoryVersion } from '@shared/types'
import { historyBlobFile, historyBlobsDir, historyFilesDir, historyLogFile } from '@main/util/paths'
import { ensureDir } from '@main/util/fs-helpers'
import { atomicWrite, atomicWriteText } from '@main/claude/config/atomic'

const gzip = promisify(zlib.gzip)
const gunzip = promisify(zlib.gunzip)

export const LOG_VERSION = 1

export interface LogHeader {
  v: number
  relPath: string
}

export interface ParsedLog {
  header: LogHeader
  versions: HistoryVersion[]
}

export function sha256(buf: Buffer | string): string {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

export async function readLog(vaultRoot: string, relPath: string): Promise<ParsedLog | null> {
  let raw: string
  try {
    raw = await fsp.readFile(historyLogFile(vaultRoot, relPath), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  const lines = raw.split('\n').filter((l) => l.trim().length > 0)
  if (lines.length === 0) return null
  let header: LogHeader
  try {
    header = JSON.parse(lines[0]!) as LogHeader
  } catch {
    return null
  }
  const versions: HistoryVersion[] = []
  for (let i = 1; i < lines.length; i++) {
    try {
      versions.push(JSON.parse(lines[i]!) as HistoryVersion)
    } catch {}
  }
  return { header, versions }
}

export async function appendVersion(
  vaultRoot: string,
  relPath: string,
  version: HistoryVersion
): Promise<void> {
  await ensureDir(historyFilesDir(vaultRoot))
  const logPath = historyLogFile(vaultRoot, relPath)
  let prefix = ''
  try {
    await fsp.access(logPath)
  } catch {
    const header: LogHeader = { v: LOG_VERSION, relPath }
    prefix = JSON.stringify(header) + '\n'
  }
  await fsp.appendFile(logPath, prefix + JSON.stringify(version) + '\n', 'utf8')
}

export async function rewriteLog(
  vaultRoot: string,
  logPath: string,
  header: LogHeader,
  versions: HistoryVersion[]
): Promise<void> {
  await ensureDir(historyFilesDir(vaultRoot))
  const body =
    JSON.stringify(header) +
    '\n' +
    versions.map((v) => JSON.stringify(v)).join('\n') +
    (versions.length > 0 ? '\n' : '')
  // Compaction rewrites the whole log in place, so a torn write here drops
  // every version record for this file at once. No `tmpDir` needed: the log
  // already lives under `.mindex/`, which the watcher ignores.
  await atomicWriteText(logPath, body)
}

export async function writeBlob(
  vaultRoot: string,
  content: Buffer
): Promise<{ hash: string; size: number }> {
  const hash = sha256(content)
  const blobPath = historyBlobFile(vaultRoot, hash)
  try {
    await fsp.access(blobPath)
  } catch {
    await ensureDir(historyBlobsDir(vaultRoot))
    const gz = await gzip(content)
    // Blobs are content-addressed, so a half-written one is worse than a
    // missing one: its name claims a hash its bytes don't match, and the
    // `access` check above would keep accepting it forever after.
    await atomicWrite(blobPath, gz)
  }
  return { hash, size: content.byteLength }
}

export async function readBlob(vaultRoot: string, hash: string): Promise<string> {
  const gz = await fsp.readFile(historyBlobFile(vaultRoot, hash))
  const buf = await gunzip(gz)
  return buf.toString('utf8')
}
