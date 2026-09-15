import { describe, it, expect } from 'vitest'
import { describeIpcFailure } from './ipc-error'

describe('describeIpcFailure', () => {
  it('explains an unknown channel as a version mismatch, not a broken feature', () => {
    // The exact string Electron produces. Read literally it accuses the
    // feature; what it actually means is that the window and the app process
    // are from different builds.
    const raw = new Error(
      "Error invoking remote method 'ai:transformSelection': Error: No handler registered for 'ai:transformSelection'"
    )
    expect(describeIpcFailure(raw)).toContain('Restart Mindex')
    expect(describeIpcFailure(raw)).not.toContain('No handler registered')
  })

  it('passes any other failure through unchanged', () => {
    expect(describeIpcFailure(new Error('Not signed in to Claude Code.'))).toBe(
      'Not signed in to Claude Code.'
    )
  })

  it('copes with something thrown that is not an Error', () => {
    expect(describeIpcFailure('plain string')).toBe('plain string')
  })
})
