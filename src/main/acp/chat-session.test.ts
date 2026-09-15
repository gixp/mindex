import { describe, expect, it } from 'vitest'
import { isUsableFor } from './chat-session'

/**
 * A chat tab's live session, and who it actually belongs to.
 *
 * Every lookup here used to be by tab id alone. A tab id survives a change of
 * assistant, so a Claude session went on answering questions about Gemini —
 * and, because the same lookup decides where a turn is sent, went on *running*
 * Gemini's messages. The reported symptom was the model and mode menus not
 * changing; the real one was messages reaching the assistant the person had
 * just switched away from.
 */
describe('isUsableFor', () => {
  it('accepts a live session belonging to the assistant asked about', () => {
    expect(isUsableFor({ alive: true, provider: 'claude' }, 'claude')).toBe(true)
  })

  it('refuses a live session belonging to a different assistant', () => {
    // The whole bug, in one line. This returned the Claude session.
    expect(isUsableFor({ alive: true, provider: 'claude' }, 'gemini')).toBe(false)
    expect(isUsableFor({ alive: true, provider: 'gemini' }, 'codex')).toBe(false)
  })

  it('refuses a dead session even when the assistant matches', () => {
    expect(isUsableFor({ alive: false, provider: 'claude' }, 'claude')).toBe(false)
  })

  it('refuses when there is no session at all', () => {
    expect(isUsableFor(undefined, 'claude')).toBe(false)
  })
})
