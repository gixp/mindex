import { describe, it, expect } from 'vitest'
import { buildWikilinkIndex, normalizeLinkTarget, resolveWikilinkTarget } from './wikilink'

const notes = [
  { path: '/v/Projects/My Note.md', relPath: 'Projects/My Note.md', title: 'A Better Title' },
  { path: '/v/People/Ann.md', relPath: 'People/Ann.md', title: 'Ann' },
  { path: '/v/Assets/logo.png', relPath: 'Assets/logo.png', title: 'logo' }
]
const idx = buildWikilinkIndex(notes)

function resolve(raw: string): string | null {
  return resolveWikilinkTarget(raw, idx)
}

describe('normalizeLinkTarget', () => {
  it('drops an alias', () => {
    expect(normalizeLinkTarget('My Note|see this')).toBe('My Note')
  })
  it('drops an anchor', () => {
    expect(normalizeLinkTarget('My Note#Heading')).toBe('My Note')
  })
  it('drops both', () => {
    expect(normalizeLinkTarget('My Note#Heading|alias')).toBe('My Note')
  })
})

describe('resolveWikilinkTarget', () => {
  it('resolves a full relative path, with and without the extension', () => {
    expect(resolve('Projects/My Note.md')).toBe('/v/Projects/My Note.md')
    expect(resolve('Projects/My Note')).toBe('/v/Projects/My Note.md')
  })

  it('resolves a bare basename', () => {
    expect(resolve('My Note')).toBe('/v/Projects/My Note.md')
  })

  it('resolves case-insensitively', () => {
    // The rule `getBacklinks` used before this was case-sensitive, so this
    // link opened in the editor but never appeared in backlinks.
    expect(resolve('my note')).toBe('/v/Projects/My Note.md')
    expect(resolve('projects/my note')).toBe('/v/Projects/My Note.md')
  })

  it('resolves by title when the basename does not match', () => {
    expect(resolve('A Better Title')).toBe('/v/Projects/My Note.md')
  })

  it('resolves assets, not just markdown', () => {
    expect(resolve('logo.png')).toBe('/v/Assets/logo.png')
  })

  it('treats a target containing a slash as a path only', () => {
    // Otherwise a note merely *titled* "Projects/Nope" could answer a link
    // that clearly names a location.
    expect(resolve('Projects/Nope')).toBeNull()
  })

  it('returns null for a target nothing answers to', () => {
    expect(resolve('Does Not Exist')).toBeNull()
  })

  it('returns null for an empty or whitespace target', () => {
    expect(resolve('')).toBeNull()
    expect(resolve('   ')).toBeNull()
  })

  it('ignores the anchor and alias when resolving', () => {
    expect(resolve('My Note#Section|shown text')).toBe('/v/Projects/My Note.md')
  })

  it('prefers a path match over a title match', () => {
    const clashing = buildWikilinkIndex([
      { path: '/v/a.md', relPath: 'a.md', title: 'Zed' },
      { path: '/v/b.md', relPath: 'b.md', title: 'a' }
    ])
    expect(resolveWikilinkTarget('a', clashing)).toBe('/v/a.md')
  })
})
