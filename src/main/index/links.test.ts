import { describe, it, expect } from 'vitest'
import type { NoteMeta, NoteTypeId } from '@shared/types'
import { computeBacklinks, computeLinkHealth } from './links'

function note(
  relPath: string,
  outgoingLinks: string[] = [],
  opts: { type?: NoteTypeId; title?: string } = {}
): NoteMeta {
  return {
    path: `/v/${relPath}`,
    relPath,
    title: opts.title ?? (relPath.split('/').pop() ?? relPath).replace(/\.md$/, ''),
    type: opts.type ?? 'untyped',
    frontmatter: {},
    tags: [],
    outgoingLinks,
    mtime: 0,
    size: 0,
    isDirectory: false
  }
}

describe('computeLinkHealth — dead links', () => {
  it('reports a link nothing answers to', () => {
    const { dead } = computeLinkHealth([note('a.md', ['Nowhere'])])
    expect(dead).toEqual([{ target: 'Nowhere', sources: ['a.md'] }])
  })

  it('does not report a link that resolves', () => {
    const { dead } = computeLinkHealth([note('a.md', ['b']), note('b.md')])
    expect(dead).toEqual([])
  })

  it('groups every source of the same dead target together', () => {
    const { dead } = computeLinkHealth([
      note('a.md', ['Ghost']),
      note('b.md', ['Ghost']),
      note('c.md', ['Other'])
    ])
    expect(dead[0]).toEqual({ target: 'Ghost', sources: ['a.md', 'b.md'] })
    expect(dead[1]).toEqual({ target: 'Other', sources: ['c.md'] })
  })

  it('resolves case-insensitively, so casing alone is not a dead link', () => {
    const { dead } = computeLinkHealth([note('a.md', ['my note']), note('My Note.md')])
    expect(dead).toEqual([])
  })
})

describe('computeLinkHealth — orphans', () => {
  it('reports a note nothing links to', () => {
    const { orphans } = computeLinkHealth([note('a.md', ['b']), note('b.md')])
    expect(orphans.map((o) => o.relPath)).toEqual(['a.md'])
  })

  it('does not count a self-link as being linked to', () => {
    // A note pointing at itself is still a note nothing else points at.
    const { orphans } = computeLinkHealth([note('a.md', ['a'])])
    expect(orphans.map((o) => o.relPath)).toEqual(['a.md'])
  })

  it('does not count a dead link as linking anything', () => {
    const { orphans } = computeLinkHealth([note('a.md', ['Ghost']), note('b.md')])
    expect(orphans.map((o) => o.relPath)).toEqual(['a.md', 'b.md'])
  })

  it('never calls a generated context file an orphan', () => {
    // Mindex writes these itself and nothing ever links to them; reporting
    // one per folder would drown the real findings.
    const { orphans } = computeLinkHealth([note('Projects/CLAUDE.md'), note('a.md', ['a.md'])])
    expect(orphans.map((o) => o.relPath)).not.toContain('Projects/CLAUDE.md')
  })

  it('never calls an asset an orphan', () => {
    const { orphans } = computeLinkHealth([note('Assets/logo.png', [], { type: 'asset' })])
    expect(orphans).toEqual([])
  })

  it('counts a note reached only by title as linked', () => {
    const { orphans } = computeLinkHealth([
      note('a.md', ['A Better Title']),
      note('b.md', [], { title: 'A Better Title' })
    ])
    expect(orphans.map((o) => o.relPath)).toEqual(['a.md'])
  })
})

describe('computeBacklinks', () => {
  it('finds a note linking by basename', () => {
    const notes = [note('a.md', ['b']), note('b.md')]
    expect(computeBacklinks(notes, '/v/b.md').map((n) => n.relPath)).toEqual(['a.md'])
  })

  it('finds a link that differs only in case', () => {
    // The behaviour this replaced missed exactly this.
    const notes = [note('a.md', ['MY NOTE']), note('My Note.md')]
    expect(computeBacklinks(notes, '/v/My Note.md').map((n) => n.relPath)).toEqual(['a.md'])
  })

  it('does not list a note as its own backlink', () => {
    const notes = [note('a.md', ['a'])]
    expect(computeBacklinks(notes, '/v/a.md')).toEqual([])
  })

  it('lists a note only once even with several links to the same target', () => {
    const notes = [note('a.md', ['b', 'b.md', 'B']), note('b.md')]
    expect(computeBacklinks(notes, '/v/b.md')).toHaveLength(1)
  })
})
