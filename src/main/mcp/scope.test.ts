import { describe, expect, it } from 'vitest'
import { allows, folderOf, normalise, refusal, toolsToSilence, withinScope } from './scope'

const NOTE = { kind: 'note' as const, note: 'Projects/Roadmap.md' }
const FOLDER = { kind: 'folder' as const, note: 'Projects/Roadmap.md' }
const VAULT = { kind: 'vault' as const, note: 'Projects/Roadmap.md' }

describe('what a scope allows', () => {
  it('lets the whole vault through when that is the scope', () => {
    expect(allows(VAULT, 'anything/at/all.md')).toBe(true)
    expect(allows(null, 'anything/at/all.md')).toBe(true)
  })

  it('allows exactly one note when the scope is the note', () => {
    expect(allows(NOTE, 'Projects/Roadmap.md')).toBe(true)
    expect(allows(NOTE, 'Projects/Other.md')).toBe(false)
    expect(allows(NOTE, 'Roadmap.md')).toBe(false)
  })

  it('allows the folder the note is in, and what is under it', () => {
    expect(allows(FOLDER, 'Projects/Other.md')).toBe(true)
    expect(allows(FOLDER, 'Projects/Sub/Deep.md')).toBe(true)
    expect(allows(FOLDER, 'People/Ivan.md')).toBe(false)
  })

  it('does not let a folder match a longer name that starts the same', () => {
    // The classic: `Projects` must not open `Projects-old`.
    expect(allows(FOLDER, 'Projects-old/Secret.md')).toBe(false)
  })

  it('refuses a path that tries to climb out', () => {
    expect(allows(FOLDER, 'Projects/../People/Ivan.md')).toBe(false)
    expect(allows(FOLDER, '/etc/passwd')).toBe(false)
  })

  it('reads a Windows separator as a separator', () => {
    expect(allows(FOLDER, 'Projects\\Sub\\Deep.md')).toBe(true)
  })

  it('falls open when nothing is anchored', () => {
    // A fence around nothing would refuse everything rather than narrow it.
    expect(allows({ kind: 'note', note: '' }, 'Whatever.md')).toBe(true)
  })

  it('handles a note at the vault root', () => {
    const root = { kind: 'folder' as const, note: 'Inbox.md' }
    expect(folderOf('Inbox.md')).toBe('')
    expect(allows(root, 'Anything.md')).toBe(true)
  })
})

describe('filtering results', () => {
  it('drops what the scope does not reach', () => {
    const hits = [
      { path: 'Projects/Roadmap.md' },
      { path: 'Projects/Other.md' },
      { path: 'People/Ivan.md' }
    ]
    expect(withinScope(NOTE, hits).map((h) => h.path)).toEqual(['Projects/Roadmap.md'])
    expect(withinScope(FOLDER, hits).map((h) => h.path)).toHaveLength(2)
    expect(withinScope(VAULT, hits)).toHaveLength(3)
  })
})

describe('the refusal', () => {
  it('names what it is limited to, so the assistant can say so', () => {
    expect(refusal(NOTE, 'People/Ivan.md')).toContain('Projects/Roadmap.md')
    expect(refusal(FOLDER, 'People/Ivan.md')).toContain('Projects')
  })
})

describe('normalise', () => {
  it('treats a scope that narrows nothing as no scope at all', () => {
    expect(normalise(VAULT)).toBeNull()
    expect(normalise({ kind: 'note', note: '' })).toBeNull()
    expect(normalise(NOTE)).toEqual(NOTE)
  })
})

describe('what a narrow scope switches off', () => {
  it('silences the assistant’s own ways of reading the disk', () => {
    // The half of the fence that reaches past Mindex's tools. Without it a CLI
    // simply opens the file itself and the scope means nothing to it.
    expect(toolsToSilence(NOTE)).toContain('Read')
    expect(toolsToSilence(NOTE)).toContain('Grep')
    expect(toolsToSilence(FOLDER)).toContain('Glob')
  })

  it('leaves writing alone', () => {
    // A narrow scope is about what may be read. Switching off writing would
    // break "write the answer into this note", which is a different row.
    expect(toolsToSilence(NOTE)).not.toContain('Write')
    expect(toolsToSilence(NOTE)).not.toContain('Edit')
  })

  it('switches nothing off for the whole vault', () => {
    // Almost every conversation. It must open exactly the session it always
    // did, with no extra payload on the wire.
    expect(toolsToSilence(VAULT)).toEqual([])
    expect(toolsToSilence(null)).toEqual([])
    expect(toolsToSilence({ kind: 'note', note: '' })).toEqual([])
  })
})
