import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import net from 'node:net'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { MCP_SHIM_SOURCE } from './shim-source'

/**
 * The shim is a string in this repo and a file on the user's disk, run by a
 * different binary in a different process. Nothing about that is covered by
 * typechecking, and every failure it can have is silent — a handshake that
 * never completes just looks like an agent that never uses the tools. So it is
 * exercised for real: written out, spawned, and spoken to over stdio.
 */

const TOKEN = 'test-token'

let dir: string
let socketPath: string
let script: string
let server: net.Server
let seen: { method: string; params: Record<string, unknown> }[] = []

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mindex-mcp-test-'))
  script = path.join(dir, 'shim.cjs')
  await fs.writeFile(script, MCP_SHIM_SOURCE, 'utf8')

  socketPath = path.join(dir, 's.sock')
  server = net.createServer((socket) => {
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => {
      const req = JSON.parse(chunk.trim())
      if (req.token !== TOKEN) {
        socket.end(`${JSON.stringify({ ok: false, error: 'Not authorised.' })}\n`)
        return
      }
      seen.push({ method: req.method, params: req.params })
      if (req.method === 'backlinks') {
        socket.end(`${JSON.stringify({ ok: false, error: 'No note matches: x' })}\n`)
        return
      }
      socket.end(`${JSON.stringify({ ok: true, data: [{ path: 'A.md', title: 'A' }] })}\n`)
    })
  })
  await new Promise<void>((resolve) => server.listen(socketPath, resolve))
})

afterAll(async () => {
  server.close()
  await fs.rm(dir, { recursive: true, force: true })
})

function startShim(env: Record<string, string> = {}): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, [script], {
    env: {
      ...process.env,
      MINDEX_MCP_SOCKET: socketPath,
      MINDEX_MCP_TOKEN: TOKEN,
      ...env
    },
    stdio: ['pipe', 'pipe', 'pipe']
  })
}

/** Send the given JSON-RPC messages, collecting one reply per id. */
async function converse(
  messages: unknown[],
  env?: Record<string, string>
): Promise<Record<string, Record<string, unknown>>> {
  const child = startShim(env)
  const replies: Record<string, Record<string, unknown>> = {}
  const wanted = messages.filter((m) => (m as { id?: unknown }).id !== undefined).length

  return await new Promise((resolve, reject) => {
    let buffer = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`shim gave ${Object.keys(replies).length}/${wanted} replies`))
    }, 8000)

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk
      for (;;) {
        const nl = buffer.indexOf('\n')
        if (nl === -1) break
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line) continue
        const msg = JSON.parse(line) as { id?: unknown }
        replies[String(msg.id)] = msg as Record<string, unknown>
      }
      if (Object.keys(replies).length >= wanted) {
        clearTimeout(timer)
        child.stdin.end()
        child.kill()
        resolve(replies)
      }
    })
    child.on('error', reject)

    for (const m of messages) child.stdin.write(`${JSON.stringify(m)}\n`)
  })
}

describe('the MCP shim', () => {
  it('completes the handshake, echoing the version it was offered', async () => {
    const replies = await converse([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }
    ])
    const result = replies['1']?.['result'] as Record<string, unknown>
    expect(result['protocolVersion']).toBe('2025-06-18')
    expect((result['serverInfo'] as Record<string, unknown>)['name']).toBe('mindex')
    expect(result['capabilities']).toHaveProperty('tools')
  })

  it('advertises exactly the tools the bridge implements', async () => {
    const replies = await converse([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' }
    ])
    const tools = (replies['2']?.['result'] as { tools: { name: string }[] }).tools
    expect(tools.map((t) => t.name).sort()).toEqual([
      'answer',
      'backlinks',
      'create',
      'query',
      'read',
      'search',
      'update'
    ])
    for (const tool of tools) expect(tool).toHaveProperty('inputSchema')
  })

  it('forwards a tool call to the bridge and returns what came back', async () => {
    seen = []
    const replies = await converse([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'search', arguments: { query: 'acme', limit: 3 } }
      }
    ])
    expect(seen).toEqual([{ method: 'search', params: { query: 'acme', limit: 3 } }])
    const content = (replies['2']?.['result'] as { content: { text: string }[] }).content
    expect(JSON.parse(content[0]!.text)).toEqual([{ path: 'A.md', title: 'A' }])
  })

  it('reports a bridge error as a tool result the model can read', async () => {
    const replies = await converse([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'backlinks', arguments: { note: 'x' } }
      }
    ])
    const result = replies['2']?.['result'] as { isError: boolean; content: { text: string }[] }
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('No note matches')
    expect(replies['2']).not.toHaveProperty('error')
  })

  it('rejects a call carrying the wrong token', async () => {
    const replies = await converse(
      [
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'search', arguments: { query: 'x' } }
        }
      ],
      { MINDEX_MCP_TOKEN: 'wrong' }
    )
    const result = replies['2']?.['result'] as { isError: boolean; content: { text: string }[] }
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('Not authorised')
  })

  it('answers an unknown tool with a protocol error', async () => {
    const replies = await converse([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'nope', arguments: {} } }
    ])
    expect((replies['2']?.['error'] as { message: string }).message).toContain('Unknown tool')
  })

  it('survives a line of junk on stdin', async () => {
    const child = startShim()
    child.stdin.write('not json at all\n')
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list' })}\n`)
    const line = await new Promise<string>((resolve) => {
      child.stdout.setEncoding('utf8')
      child.stdout.once('data', (d: string) => resolve(d))
    })
    child.kill()
    expect(JSON.parse(line.trim())['id']).toBe(9)
  })
})
