import { describe, expect, it } from 'vitest'
import { ALL_CONTEXT_FILENAMES, contextFilename } from './context-filename'

describe('contextFilename', () => {
  it('maps each provider to its own filename', () => {
    expect(contextFilename('claude')).toBe('CLAUDE.md')
    expect(contextFilename('codex')).toBe('AGENTS.md')
    expect(contextFilename('gemini')).toBe('GEMINI.md')
  })
})

describe('ALL_CONTEXT_FILENAMES', () => {
  it('contains exactly the three provider filenames', () => {
    expect([...ALL_CONTEXT_FILENAMES].sort()).toEqual(
      ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md'].sort()
    )
  })
})
