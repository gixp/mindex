import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

function flattenCwd(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

function canonicalCwd(cwd: string): string {
  try {
    return fs.realpathSync(cwd)
  } catch {
    return cwd
  }
}

export function projectDir(cwd: string): string {
  return path.join(os.homedir(), '.claude', 'projects', flattenCwd(canonicalCwd(cwd)))
}

export function sessionFile(cwd: string, sessionId: string): string {
  return path.join(projectDir(cwd), `${sessionId}.jsonl`)
}

export function sessionFileExists(cwd: string, sessionId: string): boolean {
  try {
    return fs.statSync(sessionFile(cwd, sessionId)).isFile()
  } catch {
    return false
  }
}

const MAX_TITLE_LEN = 60

export function readSessionTitle(cwd: string, sessionId: string): string | null {
  const file = sessionFile(cwd, sessionId)
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
  const lines = raw.split('\n')
  for (const line of lines) {
    if (!line) continue
    let rec: unknown
    try {
      rec = JSON.parse(line)
    } catch {
      continue
    }
    if (!rec || typeof rec !== 'object') continue
    const r = rec as Record<string, unknown>
    if (r.type !== 'user') continue
    if (r.isSidechain === true) continue
    const message = r.message as Record<string, unknown> | undefined
    const content = message?.content
    let text: string | null = null
    if (typeof content === 'string') text = content
    else if (Array.isArray(content)) {
      for (const item of content) {
        if (item && typeof item === 'object' && (item as { type?: string }).type === 'text') {
          const t = (item as { text?: unknown }).text
          if (typeof t === 'string') {
            text = t
            break
          }
        }
      }
    }
    if (!text) continue
    text = text.trim()
    if (!text) continue
    if (text.startsWith('<')) continue
    if (text.startsWith('[Request interrupted')) continue
    if (text.startsWith('Caveat:')) continue
    text = text.replace(/\s+/g, ' ')
    if (text.length > MAX_TITLE_LEN) text = text.slice(0, MAX_TITLE_LEN - 1) + '…'
    return text
  }
  return null
}

type TitleListener = (payload: { cwd: string; sessionId: string; title: string }) => void

interface Watcher {
  cwd: string
  watcher: fs.FSWatcher
  cache: Map<string, string>
}

const watchers = new Map<string, Watcher>()
let listener: TitleListener = () => {}

export function bindClaudeSessionListener(fn: TitleListener): void {
  listener = fn
}

export function watchProject(cwd: string): void {
  if (watchers.has(cwd)) return
  const dir = projectDir(cwd)
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {}
  let fsWatcher: fs.FSWatcher
  try {
    fsWatcher = fs.watch(dir, { persistent: false }, (_event, filename) => {
      if (!filename) return
      if (!filename.endsWith('.jsonl')) return
      const sessionId = filename.slice(0, -'.jsonl'.length)
      const w = watchers.get(cwd)
      if (!w) return
      const title = readSessionTitle(cwd, sessionId)
      if (!title) return
      if (w.cache.get(sessionId) === title) return
      w.cache.set(sessionId, title)
      listener({ cwd, sessionId, title })
    })
  } catch {
    return
  }
  watchers.set(cwd, { cwd, watcher: fsWatcher, cache: new Map() })
}

export function unwatchProject(cwd: string): void {
  const w = watchers.get(cwd)
  if (!w) return
  try {
    w.watcher.close()
  } catch {}
  watchers.delete(cwd)
}

export function unwatchAll(): void {
  for (const cwd of [...watchers.keys()]) unwatchProject(cwd)
}

export interface RecentChat {
  sessionId: string
  title: string
  mtimeMs: number
}

export function deleteSession(cwd: string, sessionId: string): void {
  const file = sessionFile(cwd, sessionId)
  fs.rmSync(file, { force: true })
  const dir = path.join(projectDir(cwd), sessionId)
  fs.rmSync(dir, { recursive: true, force: true })
  for (const w of watchers.values()) {
    if (w.cwd === cwd) w.cache.delete(sessionId)
  }
}

export function listRecentChats(cwd: string): RecentChat[] {
  const dir = projectDir(cwd)
  let entries: string[]
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return []
  }
  const out: RecentChat[] = []
  for (const name of entries) {
    if (!name.endsWith('.jsonl')) continue
    const sessionId = name.slice(0, -'.jsonl'.length)
    let mtimeMs: number
    try {
      mtimeMs = fs.statSync(path.join(dir, name)).mtimeMs
    } catch {
      continue
    }
    const title = readSessionTitle(cwd, sessionId)
    if (!title) continue
    out.push({ sessionId, title, mtimeMs })
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return out
}
