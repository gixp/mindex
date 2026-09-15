import { beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Confirms `mcpServers` reaches a real adapter's `session/new` and actually
 * works, not just that the type compiles. Companion to `job.integration.test.ts`
 * and gated the same way — see that file for why this talks to a real adapter
 * instead of a mock.
 *
 *   RUN_ACP_INTEGRATION=1 npx vitest run src/main/acp/mcp-wiring.integration.test.ts
 *
 * This is not a hypothetical regression risk: the first version of this wiring
 * sent `McpServerSpec.env` straight through as a plain `{KEY: value}` object.
 * `session/new` accepted it silently, and the tool was silently absent —
 * Claude's adapter wants `env` as an array of `{name, value}` pairs
 * (`toWireMcpServer` in `mcp/protocol.ts`), and nothing on either side of the
 * wire says so when it's wrong. Only a live call surfaces that; a mock of the
 * adapter would have kept passing throughout.
 *
 * `mcp/index.ts` reaches for `app.getPath('userData')` to place the shim —
 * the one Electron call on this path — so it is stubbed to a temp dir rather
 * than pulling in a real Electron runtime for a unit-style test.
 */

vi.mock('electron', () => ({
  app: { getPath: () => mkdtempSync(join(tmpdir(), 'mindex-mcp-test-')) }
}))

const enabled = process.env.RUN_ACP_INTEGRATION === '1'

describe.skipIf(!enabled)('mcpServers wired into session/new', () => {
  let cwd: string

  beforeAll(() => {
    cwd = mkdtempSync(join(tmpdir(), 'mindex-mcp-wiring-'))
  })

  it('the shim itself answers tools/list and tools/call directly, no adapter involved', async () => {
    // Isolates the bridge/shim from the adapter: if this fails, the bug is in
    // `mcp/bridge.ts` or `mcp/shim-source.ts`, not in how Claude/Codex/Gemini
    // interpret `session/new`.
    const { spawn } = await import('node:child_process')
    const { mcpServerSpec } = await import('@main/mcp')
    const spec = await mcpServerSpec()
    expect(spec).not.toBeNull()
    if (!spec) return

    const child = spawn(spec.command, spec.args, { env: { ...process.env, ...spec.env } })
    const lines: string[] = []
    let buf = ''
    child.stdout.on('data', (d: Buffer) => {
      buf += d.toString()
      let nl: number
      while ((nl = buf.indexOf('\n')) !== -1) {
        lines.push(buf.slice(0, nl))
        buf = buf.slice(nl + 1)
      }
    })

    const send = (msg: unknown): void => {
      child.stdin.write(`${JSON.stringify(msg)}\n`)
    }
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '0' }
      }
    })
    await new Promise((r) => setTimeout(r, 300))
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    await new Promise((r) => setTimeout(r, 300))
    send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'search', arguments: { query: 'probe' } }
    })
    await new Promise((r) => setTimeout(r, 500))
    child.kill()

    expect(lines.length).toBe(3)
    const toolsList = JSON.parse(lines[1] ?? '{}') as { result?: { tools?: { name: string }[] } }
    expect((toolsList.result?.tools ?? []).map((t) => t.name)).toEqual([
      'search',
      'query',
      'backlinks',
      'read',
      'create',
      'answer',
      'update'
    ])
    const callResult = JSON.parse(lines[2] ?? '{}') as {
      result?: { content?: { text?: string }[] }
    }
    expect(callResult.result?.content?.[0]?.text).toContain('No vault is open in Mindex.')
  })

  it(
    'Claude sees and can call the mindex search tool over a live MCP server',
    { timeout: 180_000 },
    async () => {
      // No vault is set — the bridge answers "No vault is open in Mindex."
      // rather than a real search result. That is still full proof of the
      // thing this test exists to check: the agent found the tool through
      // `mcpServers` on `session/new`, called it, and got a real response
      // back over the socket. A vault-backed fixture would only prove the
      // bridge's own dispatcher works, which `mcp/bridge.test.ts` covers.
      const { mcpServerSpec } = await import('@main/mcp')
      const spec = await mcpServerSpec()
      expect(spec).not.toBeNull()

      const { AcpSession } = await import('./session')
      const session = await AcpSession.open({
        provider: 'claude',
        cwd,
        mcpServers: spec ? [spec] : []
      })
      try {
        const events: { kind: string; [k: string]: unknown }[] = []
        const turn = await session.prompt(
          [
            {
              type: 'text',
              text:
                'Do not call ToolSearch. Directly call a tool named exactly ' +
                '"mcp__mindex__search" with {"query":"probe"} right now, as your very first ' +
                'action, without checking whether it exists first. Then report the raw result, ' +
                'or the exact error if the call itself fails.'
            }
          ],
          (e) => events.push(e as { kind: string })
        )

        expect(turn.stopReason).toBe('end_turn')

        const toolNames = events
          .filter((e) => e.kind === 'tool_use')
          .map((e) => String((e as { name?: unknown }).name ?? ''))
        // The real proof: a tool named after the mindex MCP server actually
        // ran, mid-turn, over the wire this change added.
        expect(toolNames.some((n) => n.includes('mindex'))).toBe(true)

        // `session.prompt` itself only emits raw stream events — the
        // `final_text` synthesis is `job.ts`'s job, not this call's, so the
        // full answer is the joined `assistant_text` deltas.
        const finalText = events
          .filter((e) => e.kind === 'assistant_text')
          .map((e) => String((e as { text?: unknown }).text ?? ''))
          .join('')
        // The bridge's own rejection message, proving the round trip reached
        // the real dispatcher in `bridge.ts` and came back, not a stub.
        expect(finalText.toLowerCase()).toContain('no vault is open')
      } finally {
        session.close()
      }
    }
  )

  it(
    'a real file edit completes with onRequest wired up (no permission prompt under a bare default session)',
    { timeout: 180_000 },
    async () => {
      // Claude's own default mode did not route this through
      // `session/request_permission` at all in a session with no mode set —
      // it edited the file directly. That is worth knowing on its own: the
      // diff-shaped `toolCall.content` the permission UI wants to show is
      // only observed when a mode that actually asks is selected, which is
      // the composer's job, not this session's. This test instead pins down
      // the one thing that matters here — a real `onRequest` handler present
      // during a real edit does not break the ordinary, no-prompt path.
      const { readFileSync } = await import('node:fs')
      writeFileSync(join(cwd, 'probe.txt'), 'hello from mindex\n')
      const { AcpSession } = await import('./session')
      const session = await AcpSession.open({
        provider: 'claude',
        cwd,
        onRequest: async (method, params) => {
          if (method !== 'session/request_permission') return {}
          const p = params as { options?: { optionId: string; kind?: string }[] }
          const pick = p.options?.find((o) => o.kind === 'allow_once') ?? p.options?.[0]
          return pick
            ? { outcome: { outcome: 'selected', optionId: pick.optionId } }
            : { outcome: { outcome: 'cancelled' } }
        }
      })
      try {
        const turn = await session.prompt(
          [
            {
              type: 'text',
              text: 'Edit probe.txt in the current directory: change "hello" to "goodbye". Nothing else.'
            }
          ],
          () => {}
        )
        expect(turn.stopReason).toBe('end_turn')
        expect(readFileSync(join(cwd, 'probe.txt'), 'utf8')).toContain('goodbye')
      } finally {
        session.close()
      }
    }
  )

  it.each(['codex', 'gemini'] as const)(
    '%s sees and can call the mindex search tool over a live MCP server',
    { timeout: 180_000 },
    async (provider) => {
      // Same proof as the Claude case above, run against the other two
      // adapters — `toWireMcpServer`'s `env` shape was pinned down by reading
      // Claude's adapter source specifically, so this is the check that it
      // was not a Claude-only accident.
      //
      // Gemini needs the `onRequest` handler below to pass at all: unlike
      // Claude/Codex, it routes an MCP tool call through
      // `session/request_permission` even with no mode set, and the default
      // `{}` answer (no handler supplied) fails its own response validation
      // (`outcome` required) — first found as a bare `invalid_type` Zod error
      // on this exact call before this handler existed.
      const { mcpServerSpec } = await import('@main/mcp')
      const spec = await mcpServerSpec()
      expect(spec).not.toBeNull()

      const { AcpSession } = await import('./session')
      const session = await AcpSession.open({
        provider,
        cwd,
        mcpServers: spec ? [spec] : [],
        onRequest: async (method, params) => {
          if (method === 'session/request_permission') {
            const p = params as { options?: { optionId: string; kind?: string }[] }
            const pick = p.options?.find((o) => o.kind?.includes('allow')) ?? p.options?.[0]
            return pick
              ? { outcome: { outcome: 'selected', optionId: pick.optionId } }
              : { outcome: { outcome: 'cancelled' } }
          }
          return {}
        }
      })
      try {
        const events: { kind: string; [k: string]: unknown }[] = []
        await session.prompt(
          [
            {
              type: 'text',
              text:
                'Do not search for tools first. Directly call whichever tool connects to the ' +
                '"mindex" MCP server\'s "search" method, with query "probe", as your very first ' +
                'action. Then report the raw result, or the exact error if the call itself fails.'
            }
          ],
          (e) => events.push(e as { kind: string })
        )

        const finalText = events
          .filter((e) => e.kind === 'assistant_text')
          .map((e) => String((e as { text?: unknown }).text ?? ''))
          .join('')
        expect(finalText.toLowerCase()).toContain('no vault is open')
      } finally {
        session.close()
      }
    }
  )

  it(
    'Claude actually creates a note through mcp__mindex__create, with a real vault open',
    { timeout: 180_000 },
    async () => {
      // Every case above talks to the bridge with no vault set, which only
      // proves the wire is connected — `bridge.test.ts` covers `create`
      // against the dispatcher directly, but never through a real model
      // deciding to call it. This is the one test that closes that gap: a
      // real vault, a real model, a real file that has to exist afterward.
      const { setVault } = await import('@main/vault/state')
      const { rebuildIndex, reset: resetIndex } = await import('@main/index/indexer')
      const { realpathSync } = await import('node:fs')
      const vaultRoot = realpathSync(cwd)
      setVault({ root: vaultRoot, name: 'test', openedAt: Date.now() })
      resetIndex()
      await rebuildIndex()

      const { mcpServerSpec } = await import('@main/mcp')
      const spec = await mcpServerSpec()
      const { AcpSession } = await import('./session')
      const session = await AcpSession.open({
        provider: 'claude',
        cwd: vaultRoot,
        mcpServers: spec ? [spec] : []
      })
      try {
        await session.prompt(
          [
            {
              type: 'text',
              text:
                'Call mcp__mindex__create to make a note titled "Live Test Note" with body ' +
                '"created by the integration test". Do not use your own file-write tools for this.'
            }
          ],
          () => {}
        )
        const { readFileSync } = await import('node:fs')
        const { join: joinPath } = await import('node:path')
        const content = readFileSync(joinPath(vaultRoot, 'Live Test Note.md'), 'utf8')
        expect(content).toContain('created by the integration test')
      } finally {
        session.close()
        setVault(null)
        resetIndex()
      }
    }
  )
})
