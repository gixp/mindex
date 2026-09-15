import net from 'node:net'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { getVault } from '@main/vault/state'
import { getBacklinks, listAllNotes, searchNotes } from '@main/index/indexer'
import { filterNotes } from '@main/index/filter'
import { buildWikilinkIndex, resolveWikilinkTarget } from '@shared/wikilink'
import { fromRelative } from '@main/util/paths'
import { snippetFor } from './snippet'
import {
  toHit,
  type BridgeMethod,
  type BridgeRequest,
  type NoteContent,
  type NoteHit
} from './protocol'
import { allows, normalise, refusal, withinScope, type Scope } from './scope'
import { logEngine } from '@main/agent-engine'
import { createNote, readNote, writeNote } from '@main/notes/operations'
import type { NoteTypeId } from '@shared/types'

/**
 * The vault answering questions, over a local socket.
 *
 * The agent runs in a CLI Mindex spawns, so anything it asks has to cross a
 * process boundary. What it must *not* cross is a rebuild: the MiniSearch
 * index and the note metadata live in this process precisely because the file
 * watcher keeps them current, and a second copy in the CLI's own process would
 * be a snapshot that goes stale the moment the user saves a note.
 *
 * A socket rather than a port: there is no listening TCP service to find, no
 * port to collide with, and the filesystem already answers "who may connect".
 * The token on each request is a second lock on the same door — cheap, and it
 * makes the failure mode of a stale socket file a clean rejection.
 */

interface BridgeHandle {
  address: string
  token: string
}

let handle: BridgeHandle | null = null
let server: net.Server | null = null

function socketAddress(): string {
  const id = randomBytes(6).toString('hex')
  if (process.platform === 'win32') return `\\\\.\\pipe\\mindex-mcp-${id}`
  // `os.tmpdir()` rather than userData: a unix socket path has a hard length
  // limit around 104 bytes, and "~/Library/Application Support/Mindex/…"
  // spends most of it before the filename starts.
  return path.join(os.tmpdir(), `mindex-mcp-${id}.sock`)
}

function limit(value: unknown, fallback: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback
  return Math.min(Math.max(n, 1), max)
}

async function handleSearch(params: Record<string, unknown>): Promise<NoteHit[]> {
  const query = String(params['query'] ?? '').trim()
  if (!query) throw new Error('search needs a query')
  const vault = getVault()
  if (!vault) throw new Error('No vault is open in Mindex.')

  const results = searchNotes(query, limit(params['limit'], 10, 50))
  const byPath = new Map(listAllNotes().map((n) => [n.path, n]))

  const hits: NoteHit[] = []
  for (const result of results) {
    const meta = byPath.get(result.path)
    if (!meta) continue
    let snippet: string | undefined
    try {
      snippet = snippetFor(await fs.readFile(result.path, 'utf8'), query)
    } catch {
      // A note that vanished between the index and this read is not worth
      // failing the whole search for — return the hit without its snippet.
    }
    hits.push(toHit(meta, { score: Math.round(result.score * 100) / 100, snippet }))
  }
  return hits
}

function handleQuery(params: Record<string, unknown>): NoteHit[] {
  const expr = String(params['filter'] ?? '').trim()
  if (!expr) throw new Error('query needs a filter expression')
  if (!getVault()) throw new Error('No vault is open in Mindex.')

  const matched = filterNotes(listAllNotes(), expr)
  matched.sort((a, b) => a.title.localeCompare(b.title))
  return matched.slice(0, limit(params['limit'], 50, 200)).map((meta) =>
    toHit(meta, {
      // The frontmatter is the whole reason this tool exists — returning only
      // the path would send the agent off to read every hit to see the field
      // it just filtered on.
      snippet: JSON.stringify(meta.frontmatter)
    })
  )
}

/**
 * What an agent hands back for a note it has already seen — a vault-relative
 * path (what `search`/`query` return) or a title (what a `[[wikilink]]` in a
 * note's own body gives) — resolved to the absolute path on disk. Shared by
 * every method that acts on an *existing* note; `create` has no such note
 * yet, so it does not go through this.
 *
 * `resolveWikilinkTarget` already returns the note's *absolute* path when it
 * finds a match — `buildWikilinkIndex` claims every entry against
 * `note.path`, not `note.relPath` (confirmed directly: matching by relpath or
 * by title both hand back the absolute form). Running that result through
 * `fromRelative` a second time double-joined it onto `vault.root`, so a real
 * note failed to resolve however it was found — this only ever fell through
 * to the raw `target` when the lookup found *nothing*, which is exactly the
 * one case where `target` is still relative and actually needs joining.
 */
function resolveExistingNotePath(
  target: string,
  vault: { root: string },
  notes: ReturnType<typeof listAllNotes>
): string {
  const resolved = resolveWikilinkTarget(target, buildWikilinkIndex(notes))
  const abs = resolved ?? fromRelative(target, vault.root)
  if (!notes.some((n) => n.path === abs)) throw new Error(`No note matches: ${target}`)
  return abs
}

function handleBacklinks(params: Record<string, unknown>): NoteHit[] {
  const target = String(params['note'] ?? '').trim()
  if (!target) throw new Error('backlinks needs a note')
  const vault = getVault()
  if (!vault) throw new Error('No vault is open in Mindex.')
  const abs = resolveExistingNotePath(target, vault, listAllNotes())
  return getBacklinks(abs).map((meta) => toHit(meta))
}

async function handleRead(
  params: Record<string, unknown>,
  fence: { assert(relPath: string): void }
): Promise<NoteContent> {
  const target = String(params['note'] ?? '').trim()
  if (!target) throw new Error('read needs a note')
  const vault = getVault()
  if (!vault) throw new Error('No vault is open in Mindex.')
  const abs = resolveExistingNotePath(target, vault, listAllNotes())
  const { meta, body } = await readNote(abs)
  // Checked against what it resolved to, not what was asked for: these tools
  // accept a title as well as a path, so the name in the request says nothing
  // about where the file is.
  fence.assert(meta.relPath)
  return { ...toHit(meta), frontmatter: meta.frontmatter, body }
}

function objectParam(
  params: Record<string, unknown>,
  key: string
): Record<string, unknown> | undefined {
  const v = params[key]
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined
}

async function handleCreate(
  params: Record<string, unknown>,
  fence: { assert(relPath: string): void }
): Promise<NoteHit> {
  const title = String(params['title'] ?? '').trim()
  if (!title) throw new Error('create needs a title')
  if (!getVault()) throw new Error('No vault is open in Mindex.')
  // `untyped` — a plain note with no required frontmatter or sections — is
  // the deliberate default for a caller with no reason to know Mindex's own
  // type system (see `types/registry.ts`'s own `specOrUntyped`, the same
  // fallback used everywhere else "no type given" means something).
  const type = (typeof params['type'] === 'string' ? params['type'] : 'untyped') as NoteTypeId
  const folder = typeof params['folder'] === 'string' ? params['folder'] : undefined
  // A new note is checked by where it is going. Its own type may choose the
  // folder when none is given, so the check is on the folder asked for — and a
  // scope of one note refuses outright, there being no second note in it.
  if (folder !== undefined) fence.assert(`${folder}/${title}.md`.replace(/^\//, ''))
  const body = typeof params['body'] === 'string' ? params['body'] : undefined
  const meta = await createNote({
    type,
    title,
    folder,
    frontmatter: objectParam(params, 'frontmatter'),
    body
  })
  return toHit(meta)
}

async function handleUpdate(
  params: Record<string, unknown>,
  fence: { assert(relPath: string): void }
): Promise<NoteHit> {
  const target = String(params['note'] ?? '').trim()
  const body = params['body']
  if (!target) throw new Error('update needs a note')
  if (typeof body !== 'string') throw new Error('update needs a body')
  const vault = getVault()
  if (!vault) throw new Error('No vault is open in Mindex.')
  const abs = resolveExistingNotePath(target, vault, listAllNotes())
  fence.assert(path.relative(vault.root, abs).split(path.sep).join('/'))
  // No `expectedMtime`: an agent has no notion of Mindex's own mtime
  // bookkeeping — the same reasoning `writeNote`'s own doc comment gives for
  // every other unconditional caller (migrations, internal rewrites).
  const meta = await writeNote(abs, body, objectParam(params, 'frontmatter'))
  return toHit(meta)
}

/**
 * What each conversation is allowed to reach, by the key its tools carry.
 *
 * Held here rather than travelling with the request because the scope changes
 * between messages while the assistant's connection — and the tool server it
 * was handed at the start — does not. The key is minted once per conversation;
 * what it points at is rewritten before every turn.
 */
const scopes = new Map<string, Scope>()

export function setBridgeScope(sessionKey: string, scope: Scope | null): void {
  const narrowed = normalise(scope)
  if (narrowed) scopes.set(sessionKey, narrowed)
  else scopes.delete(sessionKey)
}

export function clearBridgeScope(sessionKey: string): void {
  scopes.delete(sessionKey)
}

/** Only for the tests: the fence as the bridge currently sees it. */
export function bridgeScopeFor(sessionKey: string): Scope | undefined {
  return scopes.get(sessionKey)
}

/**
 * The scope a request arrives under, and the check every path answers to.
 *
 * A request with no key is unscoped by definition — the background jobs and
 * the one-shot tasks carry none, and they are not a conversation anybody has
 * narrowed.
 */
function guard(sessionKey: string | undefined): {
  scope: Scope | null
  assert(relPath: string): void
} {
  const scope = sessionKey ? (scopes.get(sessionKey) ?? null) : null
  return {
    scope,
    assert(relPath: string): void {
      if (scope && !allows(scope, relPath)) throw new Error(refusal(scope, relPath))
    }
  }
}

async function dispatch(
  method: BridgeMethod,
  params: Record<string, unknown>,
  sessionKey?: string
): Promise<unknown> {
  const fence = guard(sessionKey)
  switch (method) {
    case 'search':
      return withinScope(fence.scope, await handleSearch(params))
    case 'query':
      return withinScope(fence.scope, handleQuery(params))
    case 'backlinks':
      return withinScope(fence.scope, handleBacklinks(params))
    case 'read':
      return await handleRead(params, fence)
    case 'create':
      return await handleCreate(params, fence)
    case 'update':
      return await handleUpdate(params, fence)
    case 'answer':
      // Nothing to do here on purpose. The caller that asked the question is
      // watching the agent's own tool-call stream and reads the arguments
      // straight off it; this only has to exist and succeed, so the agent has
      // somewhere real to deliver to and does not report a failed call.
      return { received: true }
    default:
      throw new Error(`Unknown method: ${String(method)}`)
  }
}

/**
 * Every question the agent asks, in the Engine Log.
 *
 * This is the only place the two halves meet, and it is the only place that
 * can answer "did the tool actually reach the vault, and what came back" —
 * the chat shows the call it *made*, and a terminal tab shows nothing at all.
 */
function logCall(method: string, params: Record<string, unknown>, outcome: string): void {
  const arg = params['query'] ?? params['filter'] ?? params['note'] ?? params['title'] ?? ''
  logEngine('info', `mcp ${method}(${String(arg)}) → ${outcome}`, {
    feature: MCP_FEATURE,
    scope: 'mcp'
  })
}

const MCP_FEATURE = 'mcp'

const MAX_REQUEST_BYTES = 64 * 1024

function onConnection(socket: net.Socket, token: string): void {
  let buffer = ''
  socket.setEncoding('utf8')
  socket.on('error', () => {})
  socket.on('data', (chunk: string) => {
    buffer += chunk
    if (buffer.length > MAX_REQUEST_BYTES) {
      socket.destroy()
      return
    }
    const nl = buffer.indexOf('\n')
    if (nl === -1) return

    let request: BridgeRequest
    try {
      request = JSON.parse(buffer.slice(0, nl)) as BridgeRequest
    } catch {
      socket.end(`${JSON.stringify({ ok: false, error: 'Malformed request.' })}\n`)
      return
    }
    buffer = ''

    if (request.token !== token) {
      socket.end(`${JSON.stringify({ ok: false, error: 'Not authorised.' })}\n`)
      return
    }

    const params = request.params ?? {}
    void dispatch(request.method, params, request.session)
      .then((data) => {
        logCall(request.method, params, `${Array.isArray(data) ? data.length : 1} result(s)`)
        socket.end(`${JSON.stringify({ ok: true, data })}\n`)
      })
      .catch((err: unknown) => {
        const error = err instanceof Error ? err.message : String(err)
        logCall(request.method, params, `failed: ${error}`)
        socket.end(`${JSON.stringify({ ok: false, error })}\n`)
      })
  })
}

/** Start the bridge if it is not already up. Returns null if it cannot listen. */
export async function ensureBridge(): Promise<BridgeHandle | null> {
  if (handle) return handle

  const address = socketAddress()
  const token = randomBytes(24).toString('hex')
  await fs.rm(address, { force: true }).catch(() => {})

  const started = await new Promise<boolean>((resolve) => {
    const s = net.createServer((socket) => onConnection(socket, token))
    s.on('error', (err) => {
      logEngine('warn', `mcp bridge failed to listen: ${err.message}`, { feature: MCP_FEATURE })
      resolve(false)
    })
    s.listen(address, () => {
      server = s
      resolve(true)
    })
  })
  if (!started) return null

  // Belt and braces over the per-user temp directory: on a machine whose
  // tmpdir is shared, the mode is what stops another account connecting at all
  // rather than being turned away by the token.
  if (process.platform !== 'win32') await fs.chmod(address, 0o600).catch(() => {})

  handle = { address, token }
  return handle
}

export function stopBridge(): void {
  server?.close()
  server = null
  const address = handle?.address
  handle = null
  if (address && process.platform !== 'win32') void fs.rm(address, { force: true }).catch(() => {})
}
