import { describe, expect, it } from 'vitest'
import { diffContentOf, type PermissionToolCall } from './protocol'

describe('diffContentOf', () => {
  it('finds the diff entry among mixed content, exactly as Claude sends it', () => {
    // Shape captured live off a real Claude adapter — see
    // docs/acp-mcp-wiring-findings.md.
    const toolCall: PermissionToolCall = {
      toolCallId: 'toolu_1',
      content: [{ type: 'diff', path: '/tmp/probe.txt', oldText: 'hello', newText: 'goodbye' }]
    }
    expect(diffContentOf(toolCall)).toEqual({
      type: 'diff',
      path: '/tmp/probe.txt',
      oldText: 'hello',
      newText: 'goodbye'
    })
  })

  it('ignores non-diff content, such as the plain text an MCP tool call carries', () => {
    const toolCall: PermissionToolCall = {
      toolCallId: 'toolu_2',
      content: [{ type: 'content', content: { type: 'text', text: '{"query":"probe"}' } }]
    }
    expect(diffContentOf(toolCall)).toBeUndefined()
  })

  it('returns undefined for no content at all', () => {
    expect(diffContentOf({ toolCallId: 'toolu_3' })).toBeUndefined()
  })

  it('rejects a diff-typed entry missing newText rather than passing a broken shape through', () => {
    const toolCall = {
      toolCallId: 'toolu_4',
      content: [{ type: 'diff', path: '/tmp/x.txt' }]
    } as unknown as PermissionToolCall
    expect(diffContentOf(toolCall)).toBeUndefined()
  })

  it('picks the first diff when more than one is present', () => {
    const toolCall: PermissionToolCall = {
      toolCallId: 'toolu_5',
      content: [
        { type: 'diff', path: '/tmp/a.txt', oldText: 'a', newText: 'A' },
        { type: 'diff', path: '/tmp/b.txt', oldText: 'b', newText: 'B' }
      ]
    }
    expect(diffContentOf(toolCall)?.path).toBe('/tmp/a.txt')
  })
})
