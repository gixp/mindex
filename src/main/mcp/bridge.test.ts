import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import net from 'node:net'
import { setVault } from '@main/vault/state'
import { rebuildIndex, reset as resetIndex } from '@main/index/indexer'
import { ensureBridge, stopBridge } from './bridge'

/**
 * The dispatcher against a real temp vault and a real socket — the same
 * `search`/`query`/`backlinks` this always had, plus the new `read`/`create`/
 * `update`. Talks over the actual `net.Server` `ensureBridge()` opens rather
 * than calling an internal function directly: `dispatch` is not exported, and
 * the socket framing (token check, one-request-per-connection) is itself
 * part of what a regression here could break.
 */

let vaultRoot: string

async function call(
  method: string,
  params: Record<string, unknown>
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const handle = await ensureBridge()
  if (!handle) throw new Error('bridge did not start')
  return await new Promise((resolve, reject) => {
    const socket = net.connect(handle.address)
    let buf = ''
    socket.setEncoding('utf8')
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ token: handle.token, method, params })}\n`)
    })
    socket.on('data', (chunk) => {
      buf += chunk
      const nl = buf.indexOf('\n')
      if (nl === -1) return
      try {
        resolve(JSON.parse(buf.slice(0, nl)))
      } catch (err) {
        reject(err)
      }
    })
    socket.on('error', reject)
  })
}

beforeEach(async () => {
  // Realpath'd: on macOS `tmpdir()` sits under `/var`, a symlink to
  // `/private/var`, and the indexer resolves real paths as it walks — a
  // vault root that isn't already the real path makes every note's absolute
  // path mismatch what `resolveExistingNotePath` builds from it.
  vaultRoot = realpathSync(mkdtempSync(join(tmpdir(), 'mindex-bridge-test-')))
  setVault({ root: vaultRoot, name: 'test', openedAt: Date.now() })
  resetIndex()
  await rebuildIndex()
})

afterEach(() => {
  stopBridge()
  setVault(null)
  resetIndex()
  rmSync(vaultRoot, { recursive: true, force: true })
})

describe('mcp bridge dispatch', () => {
  it('create makes a real file on disk and returns a hit for it', async () => {
    const res = await call('create', { title: 'My New Note', body: 'hello there' })
    expect(res.ok).toBe(true)
    const hit = res.data as { path: string; title: string }
    expect(hit.title).toBe('My New Note')
    expect(readFileSync(join(vaultRoot, hit.path), 'utf8')).toContain('hello there')
  })

  it('create refuses without a title', async () => {
    const res = await call('create', { body: 'no title here' })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/title/)
  })

  it('read returns the full body and frontmatter, not just a snippet', async () => {
    const created = await call('create', {
      title: 'Readable Note',
      frontmatter: { status: 'active' },
      body: 'the whole body, in full'
    })
    const path = (created.data as { path: string }).path

    const res = await call('read', { note: path })
    expect(res.ok).toBe(true)
    const content = res.data as { body: string; frontmatter: Record<string, unknown> }
    expect(content.body).toContain('the whole body, in full')
    expect(content.frontmatter.status).toBe('active')
  })

  it('read resolves a note by title, not only by path', async () => {
    await call('create', { title: 'Find Me By Title', body: 'x' })
    const res = await call('read', { note: 'Find Me By Title' })
    expect(res.ok).toBe(true)
  })

  it('backlinks resolves an existing note by path (regression: used to always report "no note matches")', async () => {
    const created = await call('create', { title: 'Linked Note', body: 'x' })
    const path = (created.data as { path: string }).path
    const res = await call('backlinks', { note: path })
    expect(res.ok).toBe(true)
    expect(res.data).toEqual([])
  })

  it('backlinks resolves an existing note by title', async () => {
    await call('create', { title: 'Linked By Title', body: 'x' })
    const res = await call('backlinks', { note: 'Linked By Title' })
    expect(res.ok).toBe(true)
  })

  it('read fails clearly for a note that does not exist', async () => {
    const res = await call('read', { note: 'nope/does-not-exist.md' })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/no note matches/i)
  })

  it('update overwrites the body of an existing note', async () => {
    const created = await call('create', { title: 'Editable Note', body: 'old content' })
    const path = (created.data as { path: string }).path

    const res = await call('update', { note: path, body: 'new content, replacing the old' })
    expect(res.ok).toBe(true)
    expect(readFileSync(join(vaultRoot, path), 'utf8')).toContain('new content, replacing the old')
    expect(readFileSync(join(vaultRoot, path), 'utf8')).not.toContain('old content')
  })

  it('update refuses without a body', async () => {
    const created = await call('create', { title: 'Needs A Body', body: 'x' })
    const path = (created.data as { path: string }).path
    const res = await call('update', { note: path })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/body/)
  })

  it('every method fails cleanly with no vault open', async () => {
    setVault(null)
    const res = await call('read', { note: 'anything.md' })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('No vault is open in Mindex.')
  })

  it('rejects a request with the wrong token', async () => {
    const handle = await ensureBridge()
    const res = await new Promise<{ ok: boolean; error?: string }>((resolve, reject) => {
      const socket = net.connect(handle!.address)
      let buf = ''
      socket.setEncoding('utf8')
      socket.on('connect', () => {
        socket.write(
          `${JSON.stringify({ token: 'wrong-token', method: 'search', params: { query: 'x' } })}\n`
        )
      })
      socket.on('data', (chunk) => {
        buf += chunk
        const nl = buf.indexOf('\n')
        if (nl === -1) return
        try {
          resolve(JSON.parse(buf.slice(0, nl)))
        } catch (err) {
          reject(err)
        }
      })
      socket.on('error', reject)
    })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('Not authorised.')
  })
})
