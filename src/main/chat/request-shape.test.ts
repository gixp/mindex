import { describe, expect, it } from 'vitest'
import { buildRequestPreamble, clampWords, withRequestShape } from './request-shape'

const NOTE = 'Projects/Roadmap.md'

describe('when there is nothing to say', () => {
  it('says nothing at all', () => {
    // The common message has to be exactly the message that was typed: no
    // preamble, no blank line, no instruction nobody asked for.
    expect(buildRequestPreamble(undefined, NOTE)).toBe('')
    expect(buildRequestPreamble({}, NOTE)).toBe('')
    expect(
      buildRequestPreamble(
        { scope: { kind: 'vault', note: NOTE }, output: 'auto', length: 'auto' },
        NOTE
      )
    ).toBe('')
  })

  it('leaves the message untouched', () => {
    expect(withRequestShape('hello', {}, NOTE)).toBe('hello')
  })
})

describe('scope', () => {
  it('names the note, and says the tools will enforce it', () => {
    const out = buildRequestPreamble({ scope: { kind: 'note', note: NOTE } }, NOTE)
    expect(out).toContain(NOTE)
    // Worth saying out loud: a refusal the assistant was not warned about
    // reads as a broken tool, and it will spend a turn retrying.
    expect(out).toContain('refuse')
  })

  it('names the folder rather than the note', () => {
    const out = buildRequestPreamble({ scope: { kind: 'folder', note: NOTE } }, NOTE)
    expect(out).toContain('Projects')
    expect(out).not.toContain('Roadmap.md')
  })

  it('says nothing with no note to measure from', () => {
    expect(buildRequestPreamble({ scope: { kind: 'note', note: '' } }, '')).toBe('')
  })
})

describe('output', () => {
  it('asking for the conversation is itself a request', () => {
    expect(buildRequestPreamble({ output: 'chat' }, NOTE)).toContain('conversation')
  })

  it('writes into the note that is open', () => {
    expect(buildRequestPreamble({ output: 'this-note' }, NOTE)).toContain(NOTE)
  })

  it('drops the line that would name no file', () => {
    expect(buildRequestPreamble({ output: 'this-note' }, '')).toBe('')
  })
})

describe('a file format', () => {
  it('asks the assistant to write it, and says where', () => {
    // Nothing converts anything here. The sentence has to carry the folder and
    // the name, or the file lands somewhere nobody looks.
    const out = buildRequestPreamble({ output: 'docx' }, NOTE)
    expect(out).toContain('Word')
    expect(out).toContain('Projects')
    expect(out).toContain('Roadmap')
    expect(out).toContain('.docx')
  })

  it('says the file is the deliverable, not the reply', () => {
    expect(buildRequestPreamble({ output: 'pdf' }, NOTE)).toContain('where it went')
  })

  it('covers each of the four', () => {
    for (const [output, ext] of [
      ['docx', '.docx'],
      ['xlsx', '.xlsx'],
      ['pdf', '.pdf'],
      ['md', '.md']
    ] as const) {
      expect(buildRequestPreamble({ output }, NOTE)).toContain(ext)
    }
  })

  it('falls back to the vault root with nothing open', () => {
    const out = buildRequestPreamble({ output: 'docx' }, '')
    expect(out).toContain('vault root')
  })
})

describe('length', () => {
  it('asks for each of the named sizes', () => {
    expect(buildRequestPreamble({ length: 'sentence' }, NOTE)).toContain('single sentence')
    expect(buildRequestPreamble({ length: 'paragraph' }, NOTE)).toContain('one paragraph')
    expect(buildRequestPreamble({ length: 'page' }, NOTE)).toContain('about a page')
  })

  it('asks for a count, kept inside its bounds', () => {
    expect(buildRequestPreamble({ length: 'words', lengthWords: 120 }, NOTE)).toContain('120 words')
    expect(buildRequestPreamble({ length: 'words', lengthWords: 1 }, NOTE)).toContain('10 words')
    expect(buildRequestPreamble({ length: 'words', lengthWords: 1e9 }, NOTE)).toContain(
      '5000 words'
    )
  })
})

describe('together', () => {
  it('gives one line per row, and puts them above the message', () => {
    const shape = {
      scope: { kind: 'note' as const, note: NOTE },
      output: 'docx' as const,
      length: 'sentence' as const
    }
    expect(buildRequestPreamble(shape, NOTE).split('\n')).toHaveLength(3)
    expect(withRequestShape('do the thing', shape, NOTE).endsWith('\n\ndo the thing')).toBe(true)
  })
})

describe('clampWords', () => {
  it('keeps a sensible number, rounds, and refuses nonsense', () => {
    expect(clampWords(250)).toBe(250)
    expect(clampWords(120.6)).toBe(121)
    expect(clampWords(Number.NaN)).toBe(200)
    expect(clampWords(undefined)).toBe(200)
  })
})
