import { describe, expect, it } from 'vitest'
import type { NoteTypeDef } from '@shared/note-types'
import { draftPath, fileableTypes, isLoneUrl, sourceLabel } from './capture-draft'

function def(over: Partial<NoteTypeDef>): NoteTypeDef {
  return {
    id: 'knowledge',
    label: 'Knowledge',
    icon: 'book',
    color: 'blue',
    defaultFolder: 'Knowledge',
    filenamePattern: '{{title}}.md',
    requiredSections: [],
    fields: [],
    template: '',
    origin: 'mindex',
    ...over
  } as NoteTypeDef
}

const DEFS = [
  def({}),
  def({ id: 'asset', label: 'Asset', defaultFolder: 'Assets', filenamePattern: '{{title}}' }),
  def({ id: 'untyped', label: 'Note', defaultFolder: '' })
]

describe('draftPath — what the window shows before anything is written', () => {
  it('resolves the type’s own pattern and folder', () => {
    expect(draftPath(DEFS, 'knowledge', 'An idea', '')).toBe('Knowledge/An idea.md')
  })

  it('lets a folder typed in the window win over the type’s own', () => {
    expect(draftPath(DEFS, 'knowledge', 'An idea', 'Inbox')).toBe('Inbox/An idea.md')
  })

  it('files at the vault root when neither names a folder', () => {
    expect(draftPath(DEFS, 'untyped', 'An idea', '')).toBe('An idea.md')
  })

  it('strips the characters a filename cannot carry', () => {
    // A title is prose and routinely contains a slash or a colon.
    expect(draftPath(DEFS, 'untyped', 'Notes: a/b', '')).toBe('Notes- a-b.md')
  })

  it('gives an extension to a pattern that has none', () => {
    // The bug this whole path exists to make visible.
    expect(draftPath(DEFS, 'asset', 'An idea', '')).toBe('Assets/An idea.md')
  })

  it('shows nothing rather than guessing', () => {
    expect(draftPath(DEFS, 'knowledge', '   ', '')).toBeNull()
    expect(draftPath(DEFS, 'spaceship', 'An idea', '')).toBeNull()
  })
})

describe('fileableTypes', () => {
  it('drops the ones that would not write a markdown file', () => {
    expect(fileableTypes(DEFS).map((d) => d.id)).toEqual(['knowledge', 'untyped'])
  })
})

describe('sourceLabel', () => {
  it('shortens an address to its host', () => {
    expect(sourceLabel('https://example.com/a/b?c=1')).toBe('example.com')
  })

  it('survives something that is not an address', () => {
    // Called bare inside render, this threw and took the window with it.
    expect(sourceLabel('not a url')).toBe('not a url')
    expect(() => sourceLabel('')).not.toThrow()
  })

  it('truncates a long non-address rather than overflowing the chip', () => {
    expect(sourceLabel('x'.repeat(80))).toHaveLength(40)
  })
})

describe('isLoneUrl — which of the two things was handed in', () => {
  it('recognises a bare address', () => {
    expect(isLoneUrl('https://example.com/a')).toBe(true)
    expect(isLoneUrl('  http://example.com  ')).toBe(true)
  })

  it('refuses an address with prose around it', () => {
    // Not a link to be read, a passage that happens to mention one.
    expect(isLoneUrl('see https://example.com for more')).toBe(false)
  })

  it('refuses prose, and anything that is not a web address', () => {
    expect(isLoneUrl('a passage about something')).toBe(false)
    expect(isLoneUrl('')).toBe(false)
    // A scheme the page reader cannot fetch is not a link for this purpose.
    expect(isLoneUrl('file:///etc/hosts')).toBe(false)
    expect(isLoneUrl('mailto:a@b.c')).toBe(false)
  })
})
