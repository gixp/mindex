import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

export async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw) as T
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
}

/**
 * One settings file (vault settings in particular) can get patched from
 * several places in quick succession — a toggle click, a debounced
 * autosave, a background sync — and two `writeJson` calls to the same path
 * used to be able to interleave: both `fs.writeFile` calls open the file
 * with truncate, but nothing stopped the slower call's tail bytes from
 * landing after the faster call had already finished and moved on, since
 * `fs.writeFile` on the same path isn't itself serialized. That produced a
 * real corrupted file in the wild — a complete JSON object immediately
 * followed by a leftover fragment of a shorter write, `JSON.parse` throwing
 * on every subsequent read, and every setting for that vault silently
 * failing forever after (the IPC layer's `safe()` catches the parse error
 * and returns `{ok:false}`, which nothing downstream surfaced to the user —
 * a toggle just stopped doing anything).
 *
 * Two independent fixes, both needed: writes to the same path are queued
 * here so they never run concurrently, and each write lands via a temp
 * file + rename rather than an in-place truncate, so even a write this
 * queue didn't know about (a crash mid-write, another process) can only
 * ever leave the old complete file or the new complete file, never a
 * mixture of both.
 */
const writeQueues = new Map<string, Promise<void>>()

export async function writeJson(filePath: string, data: unknown): Promise<void> {
  const prior = writeQueues.get(filePath) ?? Promise.resolve()
  const next = prior
    .catch(() => {
      // A previous write in this chain failing must not wedge the queue —
      // the next write still deserves its own, independent attempt.
    })
    .then(() => writeJsonAtomic(filePath, data))
  // Store the settled form so a later `.catch` above doesn't chain onto an
  // already-rejected promise forever; the caller of *this* call still gets
  // the real rejection via `next` itself, returned below.
  writeQueues.set(
    filePath,
    next.catch(() => {})
  )
  return next
}

async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const dir = path.dirname(filePath)
  await fs.mkdir(dir, { recursive: true })
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`)
  const json = JSON.stringify(data, null, 2)
  try {
    await fs.writeFile(tmpPath, json, 'utf8')
    await fs.rename(tmpPath, filePath)
  } catch (e) {
    await fs.rm(tmpPath, { force: true })
    throw e
  }
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
}

export async function readText(filePath: string): Promise<string> {
  return await fs.readFile(filePath, 'utf8')
}

export async function writeText(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, 'utf8')
}

export async function listFilesRecursive(
  root: string,
  options: { ignore?: string[]; extensions?: string[] } = {}
): Promise<string[]> {
  const ignore = new Set(options.ignore ?? ['node_modules', '.git', '.obsidian'])
  const extFilter = options.extensions
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
      if (ignore.has(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile()) {
        if (!extFilter || extFilter.includes(path.extname(entry.name).toLowerCase())) {
          out.push(full)
        }
      }
    }
  }

  await walk(root)
  return out
}

export function debounce<F extends (...args: never[]) => unknown>(
  fn: F,
  ms: number
): (...args: Parameters<F>) => void {
  let timer: NodeJS.Timeout | null = null
  return (...args: Parameters<F>) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}
