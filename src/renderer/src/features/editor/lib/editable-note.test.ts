import { describe, expect, it } from 'vitest'
import { isMarkdownNote } from './editable-note'

/**
 * Which files get the two views, and which only get shown.
 *
 * Every text file in the vault opens. Only markdown gets the rendered view,
 * the preview toggle and comments — the rest are shown as code and nothing
 * else, because there is nothing else they could be shown as.
 */
describe('isMarkdownNote', () => {
  it('claims markdown', () => {
    expect(isMarkdownNote('/v/note.md')).toBe(true)
    // Case is not a promise anybody made about their filenames.
    expect(isMarkdownNote('/v/NOTE.MD')).toBe(true)
  })

  it('does not claim a file with some other extension', () => {
    for (const p of ['/v/style.css', '/v/data.csv', '/v/run.sh', '/v/logo.png']) {
      expect(isMarkdownNote(p)).toBe(false)
    }
  })

  it('does not claim a file with no extension at all', () => {
    // The case that started this: these used to meet a screen saying the app
    // would not show them.
    expect(isMarkdownNote('/v/Makefile')).toBe(false)
    expect(isMarkdownNote('/v/Max Kade Häuser Hansaallee')).toBe(false)
  })

  it('is not fooled by a folder that ends in .md', () => {
    expect(isMarkdownNote('/v/notes.md/inside.txt')).toBe(false)
  })

  it('is not fooled by a name that merely contains md', () => {
    expect(isMarkdownNote('/v/readme')).toBe(false)
    expect(isMarkdownNote('/v/a.mdx')).toBe(false)
  })
})
