import { describe, expect, it } from 'vitest'
import { producesMarkdown, withNoteExtension } from './note-types'

/**
 * A note written with no extension at all.
 *
 * A type's `filenamePattern` is free text. The built-in `asset` type ends in
 * `{{title}}` on purpose, and the type editor's Placement tab lets any type be
 * edited into the same shape. Nothing checked — so a note filed under one came
 * out as a file with no extension: not markdown to the editor, not a note to
 * the indexer, and nothing in particular in Finder.
 */
describe('withNoteExtension', () => {
  it('gives a bare name one', () => {
    expect(withNoteExtension('Ideas/Something')).toBe('Ideas/Something.md')
    expect(withNoteExtension('Something')).toBe('Something.md')
  })

  it('leaves a name that already carries one alone', () => {
    // This is what keeps `asset` working: an asset's extension comes from its
    // own title, not from its pattern.
    expect(withNoteExtension('Assets/diagram.png')).toBe('Assets/diagram.png')
    expect(withNoteExtension('Notes/idea.md')).toBe('Notes/idea.md')
  })

  it('is not fooled by a dot in a folder name', () => {
    // The extension belongs to the filename. A dotted folder with a bare name
    // still has no extension, and the old naive check would have missed it.
    expect(withNoteExtension('v1.2/Release')).toBe('v1.2/Release.md')
  })

  it('leaves a dotfile alone rather than treating the dot as an extension', () => {
    expect(withNoteExtension('.gitkeep')).toBe('.gitkeep.md')
  })
})

describe('producesMarkdown', () => {
  it('accepts a pattern that always ends in .md', () => {
    expect(producesMarkdown('{{title}}.md')).toBe(true)
    expect(producesMarkdown('{{date}} - {{title}}.md')).toBe(true)
    expect(producesMarkdown('{{title}}/Overview.md')).toBe(true)
    expect(producesMarkdown('{{title}}.MD')).toBe(true)
  })

  it('refuses one that leaves the extension to the title', () => {
    // `asset`'s own pattern. Right for a file being imported, wrong for a note
    // being written.
    expect(producesMarkdown('{{title}}')).toBe(false)
    expect(producesMarkdown('{{datetime}}-{{title}}')).toBe(false)
  })

  it('refuses a pattern that ends in some other extension', () => {
    expect(producesMarkdown('{{title}}.txt')).toBe(false)
  })
})
