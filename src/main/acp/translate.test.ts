import { describe, expect, it } from 'vitest'
import { makeTranslator } from './translate'
import type { SessionUpdate } from './protocol'
import type { StreamEvent } from '@main/providers/stream-parser'
import fixture from './__fixtures__/claude-tool-turn.json'

/**
 * The translator is tested against traffic captured from a real adapter, not
 * against hand-written shapes — the same reason the stdout parsers are tested
 * against recorded `.jsonl` output. Every assumption in `translate.ts` came
 * from this exchange; a hand-made fixture would only re-assert the assumptions.
 *
 * The recorded turn: "read probe.txt and tell me what it says", answered by
 * Claude with one Bash call.
 */

function run(updates: SessionUpdate[]): StreamEvent[] {
  const events: StreamEvent[] = []
  const t = makeTranslator((e) => events.push(e))
  for (const u of updates) t.handle(u)
  t.endTurn()
  return events
}

describe('makeTranslator, against real captured Claude traffic', () => {
  const events = run(fixture as SessionUpdate[])

  it('names the tool as the vendor does, not as the title reads', () => {
    // The opening `tool_call` says `title: "Terminal"`, while the real name
    // sits in `_meta.claudeCode.toolName`. ToolCard renders per-tool icons and
    // summaries off `Bash`, so taking the title would break all of them.
    const toolUse = events.find((e) => e.kind === 'tool_use')
    expect(toolUse).toBeDefined()
    expect(toolUse).toMatchObject({ kind: 'tool_use', name: 'Bash' })
  })

  it('waits for the arguments before announcing the call', () => {
    // `rawInput` is `{}` on the first notification and fills in later. Emitting
    // straight away would render a tool card with nothing in it.
    const toolUse = events.find((e) => e.kind === 'tool_use')
    expect(toolUse && 'input' in toolUse ? toolUse.input : undefined).toMatchObject({
      command: 'cat probe.txt 2>&1; echo "---"; pwd'
    })
  })

  it('emits exactly one tool_use and one tool_result for one call', () => {
    // Five notifications describe this single call; the transcript must not
    // grow five cards.
    expect(events.filter((e) => e.kind === 'tool_use')).toHaveLength(1)
    expect(events.filter((e) => e.kind === 'tool_result')).toHaveLength(1)
  })

  it('pairs the result to the call and carries the output', () => {
    const use = events.find((e) => e.kind === 'tool_use')
    const result = events.find((e) => e.kind === 'tool_result')
    expect(use?.kind === 'tool_use' && result?.kind === 'tool_result').toBe(true)
    if (use?.kind !== 'tool_use' || result?.kind !== 'tool_result') return
    expect(result.toolUseId).toBe(use.id)
    expect(result.isError).toBe(false)
    // Tool content nests: [{type:'content', content:{type:'text', text}}]
    expect(result.preview).toContain('hello from mindex acp spike')
  })

  it('streams assistant text as deltas', () => {
    const text = events
      .filter(
        (e): e is Extract<StreamEvent, { kind: 'assistant_text' }> => e.kind === 'assistant_text'
      )
      .map((e) => e.text)
      .join('')
    expect(text).toContain('probe.txt')
  })

  it('does not report context-window fill as token usage', () => {
    // `usage_update` says 36k of a 200k window. `StreamEvent.usage` means
    // tokens billed, which arrives in the `session/prompt` response instead —
    // filling one from the other would put a number on the wrong axis.
    expect(events.some((e) => e.kind === 'usage')).toBe(false)
  })

  it('records the context window separately, keeping the latest report', () => {
    // Five `usage_update`s arrive during this one turn and the window itself
    // changes size partway through — 200k early, 1M by the end, because the
    // resolved model has a 1M context lane. Keeping the last one is the point:
    // an earlier value describes a window the session is no longer in.
    const t = makeTranslator(() => {})
    for (const u of fixture as SessionUpdate[]) t.handle(u)
    expect(t.contextUsed()).toEqual({ used: 36188, size: 1_000_000 })
  })
})

describe('makeTranslator, edge cases the adapters can produce', () => {
  it('closes a tool call left open when the turn ends', () => {
    // Without this the card spins forever in the transcript.
    const events = run([
      {
        sessionUpdate: 'tool_call',
        toolCallId: 't1',
        status: 'pending',
        rawInput: { file_path: '/x' },
        _meta: { claudeCode: { toolName: 'Read' } }
      }
    ])
    expect(events.filter((e) => e.kind === 'tool_use')).toHaveLength(1)
    expect(events.filter((e) => e.kind === 'tool_result')).toHaveLength(1)
  })

  it('marks a failed call as an error', () => {
    const events = run([
      {
        sessionUpdate: 'tool_call',
        toolCallId: 't1',
        status: 'pending',
        rawInput: { command: 'false' },
        _meta: { claudeCode: { toolName: 'Bash' } }
      },
      { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'failed' }
    ])
    const result = events.find((e) => e.kind === 'tool_result')
    expect(result?.kind === 'tool_result' && result.isError).toBe(true)
  })

  it('ignores update kinds it does not know', () => {
    // Adapters add these on their own schedule; an unknown kind is not an error.
    const events = run([
      { sessionUpdate: 'something_invented_next_year', toolCallId: 'x' },
      { sessionUpdate: 'current_mode_update', currentModeId: 'plan' }
    ])
    expect(events).toHaveLength(0)
  })

  it('keeps the models reasoning out of the answer', () => {
    // `agent_thought_chunk` has no home in the current event union. Dropping it
    // is deliberate: folding it into assistant text would publish the model's
    // private reasoning as if it were the reply.
    const events = run([
      { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'hmm' } }
    ])
    expect(events).toHaveLength(0)
  })
})
