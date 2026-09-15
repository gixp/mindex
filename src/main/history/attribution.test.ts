import { describe, it, expect, beforeEach } from 'vitest'
import {
  USER_WRITE_WINDOW_MS,
  agentWriteDetail,
  markAgentWrite,
  markUserWrite,
  resetAttribution,
  resolveAuthor
} from './attribution'

const FILE = '/vault/Notes/idea.md'
const T0 = 1_000_000

beforeEach(() => {
  resetAttribution()
})

describe('resolveAuthor', () => {
  it('is external when nothing marked it and the engine is idle', () => {
    expect(resolveAuthor(FILE, false, T0)).toBe('external')
  })

  it('is agent when the engine was busy and nothing marked it', () => {
    expect(resolveAuthor(FILE, true, T0)).toBe('agent')
  })

  it('is user for a marked path', () => {
    markUserWrite(FILE, T0)
    expect(resolveAuthor(FILE, false, T0 + 100)).toBe('user')
  })

  it('prefers the user over a running job', () => {
    // The everyday case: typing in the editor while a background
    // folder-context job happens to be running. Calling that the agent's edit
    // would be plainly wrong.
    markUserWrite(FILE, T0)
    expect(resolveAuthor(FILE, true, T0 + 100)).toBe('user')
  })

  it('still counts as the user across the whole watcher + debounce delay', () => {
    // The snapshot lands ~1.6s after the write; the window must comfortably
    // outlast that.
    markUserWrite(FILE, T0)
    expect(resolveAuthor(FILE, false, T0 + 2_000)).toBe('user')
  })

  it('stops counting as the user once the window has passed', () => {
    markUserWrite(FILE, T0)
    expect(resolveAuthor(FILE, false, T0 + USER_WRITE_WINDOW_MS + 1)).toBe('external')
  })

  it('does not let one file’s mark speak for another', () => {
    markUserWrite(FILE, T0)
    expect(resolveAuthor('/vault/Notes/other.md', false, T0 + 100)).toBe('external')
  })

  it('re-marking extends the window', () => {
    markUserWrite(FILE, T0)
    markUserWrite(FILE, T0 + USER_WRITE_WINDOW_MS - 1)
    expect(resolveAuthor(FILE, false, T0 + USER_WRITE_WINDOW_MS + 100)).toBe('user')
  })

  it('an expired mark does not resurrect a later agent write as the user’s', () => {
    markUserWrite(FILE, T0)
    expect(resolveAuthor(FILE, true, T0 + USER_WRITE_WINDOW_MS + 1)).toBe('agent')
  })
})

describe('markAgentWrite', () => {
  it('makes an otherwise-external write count as the agent', () => {
    // An applied AI proposal writes through IPC with no engine job running.
    markAgentWrite(FILE, 'Knowledge linter', T0)
    expect(resolveAuthor(FILE, false, T0 + 100)).toBe('agent')
  })

  it('carries the feature label for the history entry', () => {
    markAgentWrite(FILE, 'Knowledge linter', T0)
    expect(agentWriteDetail(FILE, T0 + 100)).toBe('Knowledge linter')
  })

  it('still loses to a real user edit of the same file', () => {
    markAgentWrite(FILE, 'Rewrite selection', T0)
    markUserWrite(FILE, T0 + 10)
    expect(resolveAuthor(FILE, false, T0 + 100)).toBe('user')
  })

  it('expires on the same window as a user mark', () => {
    markAgentWrite(FILE, 'x', T0)
    expect(resolveAuthor(FILE, false, T0 + USER_WRITE_WINDOW_MS + 1)).toBe('external')
    expect(agentWriteDetail(FILE, T0 + USER_WRITE_WINDOW_MS + 1)).toBeUndefined()
  })
})
