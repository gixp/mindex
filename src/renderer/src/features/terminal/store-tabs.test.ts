import { describe, expect, it } from 'vitest'
import { withInheritedProvider } from './store-tabs'

/**
 * A conversation keeps its own assistant.
 *
 * Every chat tab used to follow the assistant chosen in Settings — the one
 * that runs the vault's background work. Choosing an assistant for either
 * purpose silently reached into the other, so the two are now separate, and
 * this is the seam where the old behaviour is honoured one last time: a tab
 * saved under the old rule remembers no assistant of its own, and must not be
 * moved to a different one on the next launch.
 */
describe('withInheritedProvider', () => {
  it('gives a config with no assistant the one it was actually using', () => {
    expect(withInheritedProvider({ model: 'opus' }, 'gemini')).toEqual({
      model: 'opus',
      provider: 'gemini'
    })
  })

  it('never overrules an assistant the config already names', () => {
    // The whole point of the split. If this ever passes the inherited value
    // through, changing the engine's assistant moves an open conversation
    // again — which is the behaviour being removed.
    expect(withInheritedProvider({ provider: 'codex' }, 'gemini')).toEqual({ provider: 'codex' })
  })

  it('leaves the config untouched when there is nothing to inherit', () => {
    const stored = { model: 'opus' }
    expect(withInheritedProvider(stored, undefined)).toBe(stored)
  })

  it('does not mutate what it was given', () => {
    const stored = { model: 'opus' }
    withInheritedProvider(stored, 'claude')
    expect(stored).toEqual({ model: 'opus' })
  })
})
