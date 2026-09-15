import { describe, expect, it } from 'vitest'
import { bridgeScopeFor, clearBridgeScope, setBridgeScope } from './bridge'

/**
 * The fence is held per conversation and rewritten between messages.
 *
 * Worth pinning because of what it buys: the assistant's tool server is handed
 * over once, when the conversation opens, and never rebuilt. If the scope
 * travelled with that server, narrowing it would need the assistant restarted.
 */
describe('the fence a conversation is under', () => {
  it('is remembered against the conversation that set it', () => {
    setBridgeScope('tab-1', { kind: 'note', note: 'Projects/Roadmap.md' })
    expect(bridgeScopeFor('tab-1')).toEqual({ kind: 'note', note: 'Projects/Roadmap.md' })
    clearBridgeScope('tab-1')
  })

  it('does not reach the conversation next to it', () => {
    setBridgeScope('tab-1', { kind: 'note', note: 'A.md' })
    expect(bridgeScopeFor('tab-2')).toBeUndefined()
    clearBridgeScope('tab-1')
  })

  it('moves between messages without anything being rebuilt', () => {
    setBridgeScope('tab-1', { kind: 'note', note: 'A.md' })
    setBridgeScope('tab-1', { kind: 'folder', note: 'Projects/B.md' })
    expect(bridgeScopeFor('tab-1')).toEqual({ kind: 'folder', note: 'Projects/B.md' })
    clearBridgeScope('tab-1')
  })

  it('lifts entirely when the scope is the whole vault', () => {
    // Not stored as "vault" — stored as nothing, so the hot path has no fence
    // to consult at all for the case that is almost every message.
    setBridgeScope('tab-1', { kind: 'note', note: 'A.md' })
    setBridgeScope('tab-1', { kind: 'vault', note: 'A.md' })
    expect(bridgeScopeFor('tab-1')).toBeUndefined()
  })

  it('lifts when there is no note to measure from', () => {
    setBridgeScope('tab-1', { kind: 'note', note: '' })
    expect(bridgeScopeFor('tab-1')).toBeUndefined()
  })
})
