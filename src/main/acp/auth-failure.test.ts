import { describe, expect, it } from 'vitest'
import { authFailureMessage, looksLikeAuthFailure } from './auth-failure'

describe('looksLikeAuthFailure', () => {
  it('recognises the failure a lapsed Claude session actually produced', () => {
    // Both halves are quoted from the real thing: the assistant answered with
    // the first line, and what the turn failed with was the adapter's log tail
    // — which names a phase and a duration and no cause at all.
    const answer = 'Failed to authenticate: OAuth session expired and could not be refreshed'
    const stderr =
      '[session/models] sessionId=ee2248a0-24a6-48c2-afd2-9b5a86c3e6d5 ' +
      'phase=read-transcript durationMs=9 totalMs=9 messages=46 model=claude-opus-5'

    expect(looksLikeAuthFailure(stderr, undefined, answer)).toBe(true)
  })

  it('recognises the wordings the other CLIs use', () => {
    expect(looksLikeAuthFailure('Please run /login to continue')).toBe(true)
    expect(looksLikeAuthFailure('Authentication failed (invalid api key)')).toBe(true)
    expect(looksLikeAuthFailure('Your credentials have expired')).toBe(true)
  })

  it('leaves an ordinary crash alone', () => {
    expect(looksLikeAuthFailure('spawn ENOENT')).toBe(false)
    expect(looksLikeAuthFailure('timed out')).toBe(false)
    expect(looksLikeAuthFailure()).toBe(false)
    expect(looksLikeAuthFailure('', undefined)).toBe(false)
  })

  it('does not fire on an answer that merely discusses access', () => {
    // The text searched includes the assistant's own words, so a note about
    // permissions must not turn into a sign-in prompt.
    const answer =
      'The server returns 401 Unauthorized when the header is missing, and 403 Forbidden ' +
      'when the role is wrong.'
    expect(looksLikeAuthFailure(answer)).toBe(false)
  })
})

describe('authFailureMessage', () => {
  it('puts a readable line first and keeps the raw text underneath', () => {
    // The chip shows the first line; the details panel shows all of it.
    const msg = authFailureMessage('Claude Code', '[session/models] phase=read-transcript')
    expect(msg.split('\n')[0]).toBe('Claude Code is signed out — its session expired.')
    expect(msg).toContain('[session/models] phase=read-transcript')
  })
})
