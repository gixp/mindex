import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'

// The task runner reaches the agent, the engine log, the MCP bridge, and the
// open-vault state — none of which exist under vitest. Each mock is the
// smallest thing that lets the logic under test run.

const runAgentJob = vi.fn()

const logEngine = vi.fn()
vi.mock('@main/agent-engine', () => ({
  runAgentJob: (opts: unknown) => runAgentJob(opts),
  logEngine: (level: string, message: string, ctx: unknown) => logEngine(level, message, ctx)
}))
vi.mock('@main/providers/engine-choice', () => ({
  interactiveChoice: async () => ({ provider: 'claude', model: 'opus' })
}))
vi.mock('@main/mcp/index', () => ({
  mcpServerSpec: async () => ({ name: 'mindex', command: 'node', args: [], env: {} }),
  MCP_TOOL_NAMES: ['mcp__mindex__search', 'mcp__mindex__read', 'mcp__mindex__answer'],
  ANSWER_TOOL_NAME: 'mcp__mindex__answer',
  ANSWER_TOOL_ONLY: ['mcp__mindex__answer']
}))
vi.mock('@main/telemetry/scrub', () => ({ scrubText: (s: string) => s }))

let vault: { root: string } | null = { root: '/vault' }
vi.mock('@main/vault/state', () => ({ getVault: () => vault }))

const { runStructuredTask, extractJson, stripFence } = await import('./task')

type StreamEvent =
  | { kind: 'tool_use'; name: string; input: unknown; id: string }
  | { kind: 'assistant_text'; text: string }

/** A `runAgentJob` stand-in: emits `events` to `onEvent`, then resolves. */
function job(
  result: Partial<{ ok: boolean; finalText: string; errorReason: string; errorMessage: string }>,
  events: StreamEvent[] = []
) {
  return (opts: { onEvent?: (e: StreamEvent) => void }) => {
    for (const e of events) opts.onEvent?.(e)
    return Promise.resolve({ ok: true, exitCode: 0, stdout: '', durationMs: 1, ...result })
  }
}

const schema = z.object({ answer: z.string(), score: z.number() })
const opts = {
  kind: 'test',
  instruction: 'Do the thing.',
  schema,
  shape: '{ "answer": string, "score": number }'
}

beforeEach(() => {
  logEngine.mockReset()
  runAgentJob.mockReset()
  vault = { root: '/vault' }
})

describe('extractJson', () => {
  it('reads a bare object', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 })
  })
  it('reads through a ```json fence and surrounding prose', () => {
    expect(extractJson('Here you go:\n```json\n{"a":1}\n```\nhope that helps')).toEqual({ a: 1 })
  })
  it('reads a top-level array', () => {
    expect(extractJson('sure: [1, 2, 3]')).toEqual([1, 2, 3])
  })
  it('throws when there is no JSON', () => {
    expect(() => extractJson('no json here')).toThrow()
  })
})

describe('stripFence', () => {
  it('unwraps a whole answer that is one fenced block', () => {
    // Told to write a document, a model quite reasonably sometimes fences it —
    // a fence is how you show a document inside a message. Arguing with that
    // in the prompt costs more than unwrapping it here.
    expect(stripFence('```markdown\n---\ntitle: A\n---\n\nBody.\n```')).toBe(
      '---\ntitle: A\n---\n\nBody.'
    )
  })
  it('leaves an unfenced answer alone', () => {
    expect(stripFence('  ---\ntitle: A\n---  ')).toBe('---\ntitle: A\n---')
  })
  it('leaves a fence that is only part of the answer alone', () => {
    const withCode = 'Note.\n\n```js\nconst a = 1\n```\n\nMore.'
    expect(stripFence(withCode)).toBe(withCode)
  })
})

describe('the prompt', () => {
  it('attaches nothing at all for a self-contained task', async () => {
    // A rewrite has its whole input in the prompt. Pointing it at the vault
    // invited a round of searching followed by a narrated answer, which is
    // exactly the shape this runner then rejects.
    runAgentJob.mockImplementation(job({ finalText: '{"answer":"a","score":1}' }))
    await runStructuredTask({ ...opts, useVaultTools: false })

    const sent = runAgentJob.mock.calls[0]![0] as {
      prompt: string
      allowedTools: string[]
      mcpServers?: unknown[]
    }
    expect(sent.prompt).toContain('Do not search, read files, or use any tool.')
    // Nothing attached and nothing allowed. This is the light path: no tool
    // bridge for the agent to reach, so nothing to start and nothing to fail.
    expect(sent.allowedTools).toEqual([])
    expect(sent.mcpServers).toBeUndefined()
  })

  it('points a looking-up task at the vault tools', async () => {
    runAgentJob.mockImplementation(job({ finalText: '{"answer":"a","score":1}' }))
    await runStructuredTask(opts)

    const sent = runAgentJob.mock.calls[0]![0] as { prompt: string; allowedTools: string[] }
    expect(sent.prompt).toContain('mcp__mindex__')
    expect(sent.allowedTools).toContain('mcp__mindex__search')
  })

  it('asks a light task for the shape in the reply itself', async () => {
    runAgentJob.mockImplementation(job({ finalText: '{"answer":"a","score":1}' }))
    await runStructuredTask({ ...opts, useVaultTools: false })
    const sent = runAgentJob.mock.calls[0]![0] as { prompt: string }
    expect(sent.prompt).toContain('The first character of your reply must be {')
    expect(sent.prompt).not.toContain('mcp__mindex__answer')
  })

  it('asks a looking-up task to deliver through the tool instead', async () => {
    runAgentJob.mockImplementation(job({ finalText: '{"answer":"a","score":1}' }))
    await runStructuredTask(opts)
    const sent = runAgentJob.mock.calls[0]![0] as { prompt: string; mcpServers?: unknown[] }
    expect(sent.prompt).toContain('calling mcp__mindex__answer exactly once')
    expect(sent.mcpServers).toHaveLength(1)
  })
})

describe('the engine log', () => {
  it('records which assistant, which model, and what it was allowed to do', async () => {
    // None of this can be recovered after the fact, and all of it changes the
    // answer — "a rewrite started" left no way to tell one run from the next.
    runAgentJob.mockImplementation(job({ finalText: '{"answer":"a","score":1}' }))
    await runStructuredTask({ ...opts, useVaultTools: false, detail: 'Pricing.md:12' })

    const started = logEngine.mock.calls[0]![1] as string
    expect(started).toContain('claude/opus')
    expect(started).toContain('no tools')
    expect(started).toContain('Pricing.md:12')
  })

  it('says the run looked things up when it was allowed to', async () => {
    runAgentJob.mockImplementation(job({ finalText: '{"answer":"a","score":1}' }))
    await runStructuredTask(opts)
    expect(logEngine.mock.calls[0]![1] as string).toContain('vault tools')
  })

  it('records how long the answer took', async () => {
    runAgentJob.mockImplementation(job({ finalText: '{"answer":"a","score":1}' }))
    await runStructuredTask(opts)
    const messages = logEngine.mock.calls.map((c) => c[1] as string)
    expect(messages.some((m) => m.includes('answered in'))).toBe(true)
  })
})

describe('the delivered answer', () => {
  it('is taken from the tool call, not from the message', async () => {
    // The message here is deliberately wrong. If it were still being read,
    // this would come back as the message's value instead of the call's.
    runAgentJob.mockImplementation(
      job({ finalText: 'Sure! {"answer":"from the message","score":9}' }, [
        {
          kind: 'tool_use',
          name: 'mcp__mindex__answer',
          input: { result: { answer: 'from the call', score: 1 } },
          id: 't1'
        }
      ])
    )
    const out = await runStructuredTask(opts)
    expect(out).toMatchObject({ ok: true, data: { answer: 'from the call', score: 1 } })
  })

  it('takes the last call when the assistant corrects itself', async () => {
    runAgentJob.mockImplementation(
      job({ finalText: '' }, [
        {
          kind: 'tool_use',
          name: 'mcp__mindex__answer',
          input: { result: { answer: 'first', score: 1 } },
          id: 'a'
        },
        {
          kind: 'tool_use',
          name: 'mcp__mindex__answer',
          input: { result: { answer: 'second', score: 2 } },
          id: 'b'
        }
      ])
    )
    const out = await runStructuredTask(opts)
    expect(out).toMatchObject({ ok: true, data: { answer: 'second', score: 2 } })
  })

  it('still reads the message when no call was made', async () => {
    // The old path, kept for an assistant that answers in prose regardless.
    runAgentJob.mockImplementation(job({ finalText: 'Here: {"answer":"fallback","score":3}' }))
    const out = await runStructuredTask(opts)
    expect(out).toMatchObject({ ok: true, data: { answer: 'fallback', score: 3 } })
  })
})

describe('runStructuredTask', () => {
  it('returns validated data and the notes the agent read', async () => {
    runAgentJob.mockImplementation(
      job({ finalText: '{"answer":"yes","score":3}' }, [
        { kind: 'tool_use', name: 'mcp__mindex__read', input: { note: 'Pricing.md' }, id: '1' },
        { kind: 'tool_use', name: 'mcp__mindex__search', input: { query: 'pricing' }, id: '2' }
      ])
    )
    const out = await runStructuredTask(opts)
    expect(out).toEqual({
      ok: true,
      data: { answer: 'yes', score: 3 },
      readPaths: ['Pricing.md']
    })
    expect(runAgentJob).toHaveBeenCalledTimes(1)
  })

  it('repairs one malformed answer and then succeeds', async () => {
    runAgentJob
      .mockImplementationOnce(job({ finalText: 'um, not json' }))
      .mockImplementationOnce(job({ finalText: '{"answer":"ok","score":1}' }))
    const out = await runStructuredTask(opts)
    expect(out.ok).toBe(true)
    expect(runAgentJob).toHaveBeenCalledTimes(2)
  })

  it('gives up after a second bad answer', async () => {
    runAgentJob.mockImplementation(job({ finalText: '{"answer":"missing score"}' }))
    const out = await runStructuredTask(opts)
    expect(out).toMatchObject({ ok: false, reason: 'invalid-output' })
    expect(runAgentJob).toHaveBeenCalledTimes(2)
  })

  it('maps an auth failure to not-configured', async () => {
    runAgentJob.mockImplementation(
      job({ ok: false, errorReason: 'auth', errorMessage: 'Not signed in.' })
    )
    const out = await runStructuredTask(opts)
    expect(out).toEqual({ ok: false, reason: 'not-configured', message: 'Not signed in.' })
  })

  it('maps a timeout', async () => {
    runAgentJob.mockImplementation(job({ ok: false, errorReason: 'timeout' }))
    const out = await runStructuredTask(opts)
    expect(out).toMatchObject({ ok: false, reason: 'timeout' })
  })

  it('refuses when no vault is open', async () => {
    vault = null
    const out = await runStructuredTask(opts)
    expect(out).toEqual({ ok: false, reason: 'no-vault', message: 'No vault is open.' })
    expect(runAgentJob).not.toHaveBeenCalled()
  })
})
