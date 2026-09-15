import { describe, expect, it } from 'vitest'
import { createSearchIndex, metaToDoc } from './search'
import type { NoteMeta } from '@shared/types'

/**
 * The index has covered note bodies all along; nothing in the window could
 * reach it. These pin the two things the window now depends on: that a search
 * for a phrase inside a note finds it, and that the result says the hit came
 * from the text — without which a note whose name has nothing to do with the
 * query looks, in a list of titles, like a result with no business being there.
 */

function note(relPath: string, title: string, tags: string[] = []): NoteMeta {
  return {
    path: `/vault/${relPath}`,
    relPath,
    title,
    type: 'untyped',
    frontmatter: {},
    tags,
    outgoingLinks: [],
    mtime: 0,
    size: 0,
    isDirectory: false
  } as NoteMeta
}

/** The same derivation `searchNotes` applies to MiniSearch's `match` data. */
function matchedField(match: Record<string, string[]> | undefined): 'title' | 'text' | 'tags' {
  const fields = new Set(Object.values(match ?? {}).flat())
  if (fields.has('title')) return 'title'
  if (fields.has('tags')) return 'tags'
  return 'text'
}

function indexed(): ReturnType<typeof createSearchIndex> {
  const search = createSearchIndex()
  search.add(
    metaToDoc(
      note('projects/atlas.md', 'Atlas'),
      'The migration is blocked on the vendor contract.'
    )
  )
  search.add(metaToDoc(note('people/dana.md', 'Dana Reyes'), 'Runs procurement.'))
  search.add(
    metaToDoc(note('notes/vendors.md', 'Suppliers', ['procurement']), 'Who we buy hardware from.')
  )
  return search
}

describe('searching a vault', () => {
  it('finds a note by a phrase in its text, not just its name', () => {
    // Nothing called "vendor contract" exists. This is the case no search box
    // in the app could answer.
    const hits = indexed().search('vendor contract')
    expect(hits.map((h) => h['path'])).toContain('/vault/projects/atlas.md')
  })

  it('says the hit came from the text', () => {
    const hit = indexed().search('vendor')[0]
    expect(matchedField(hit?.match)).toBe('text')
  })

  it('says the hit came from the name when it did', () => {
    const hit = indexed().search('Atlas')[0]
    expect(matchedField(hit?.match)).toBe('title')
  })

  it('says the hit came from a tag when only a tag matched', () => {
    // "procurement" is a tag on one note and body text on another; the tag
    // holder ranks first, because tags are boosted over the body.
    const hit = indexed().search('procurement')[0]
    expect(hit?.['path']).toBe('/vault/notes/vendors.md')
    expect(matchedField(hit?.match)).toBe('tags')
  })

  it('still matches a prefix, which is what typing feels like', () => {
    expect(indexed().search('migrat').length).toBeGreaterThan(0)
  })
})
