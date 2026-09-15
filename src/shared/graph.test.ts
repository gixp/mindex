import { describe, it, expect } from 'vitest'
import type { NoteMeta, NoteTypeId } from '@shared/types'
import { buildGraph, nodeRadius } from './graph'

function note(
  relPath: string,
  outgoingLinks: string[] = [],
  opts: { type?: NoteTypeId; title?: string; isDirectory?: boolean } = {}
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
    isDirectory: opts.isDirectory ?? false
  }
}

const ids = (nodes: { id: string }[]): string[] => nodes.map((n) => n.id).sort()

describe('buildGraph — nodes', () => {
  it('makes one node per markdown note', () => {
    const { nodes } = buildGraph([note('a.md'), note('b.md')])
    expect(ids(nodes)).toEqual(['/v/a.md', '/v/b.md'])
  })

  it('leaves out folders and assets', () => {
    const { nodes } = buildGraph([
      note('a.md'),
      note('dir', [], { isDirectory: true }),
      note('img.png', [], { type: 'asset' })
    ])
    expect(ids(nodes)).toEqual(['/v/a.md'])
  })

  it('leaves out whatever the tree is hiding', () => {
    // The graph draws the vault the user can see, so the caller passes the
    // tree's own hidden set rather than the graph re-deciding what counts.
    const notes = [note('a.md'), note('CLAUDE.md')]
    expect(ids(buildGraph(notes).nodes)).toEqual(['/v/CLAUDE.md', '/v/a.md'])
    const hidden = new Set(['/v/CLAUDE.md'])
    expect(ids(buildGraph(notes, { hidden }).nodes)).toEqual(['/v/a.md'])
  })
})

describe('buildGraph — links', () => {
  it('connects a resolved wikilink', () => {
    const { links } = buildGraph([note('a.md', ['b']), note('b.md')])
    expect(links).toEqual([{ source: '/v/a.md', target: '/v/b.md', kind: 'link' }])
  })

  it('drops a link nothing answers to', () => {
    const { links } = buildGraph([note('a.md', ['Nowhere'])])
    expect(links).toEqual([])
  })

  it('collapses a mutual link into one edge', () => {
    const { links } = buildGraph([note('a.md', ['b']), note('b.md', ['a'])])
    expect(links).toHaveLength(1)
  })

  it('collapses a link repeated in the same note', () => {
    const { links } = buildGraph([note('a.md', ['b', 'b']), note('b.md')])
    expect(links).toHaveLength(1)
  })

  it('ignores a self-link', () => {
    const { links } = buildGraph([note('a.md', ['a'])])
    expect(links).toEqual([])
  })

  it('drops an edge whose other end is hidden', () => {
    const notes = [note('a.md', ['CLAUDE']), note('CLAUDE.md')]
    const { links } = buildGraph(notes, { hidden: new Set(['/v/CLAUDE.md']) })
    expect(links).toEqual([])
  })
})

describe('buildGraph — degree', () => {
  it('counts distinct neighbours in either direction', () => {
    const { nodes } = buildGraph([
      note('hub.md', ['a', 'b']),
      note('a.md', ['hub']),
      note('b.md'),
      note('lonely.md')
    ])
    const by = new Map(nodes.map((n) => [n.relPath, n.degree]))
    expect(by.get('hub.md')).toBe(2)
    expect(by.get('a.md')).toBe(1)
    expect(by.get('lonely.md')).toBe(0)
  })
})

describe('buildGraph — scope', () => {
  const notes = [note('top.md', ['a/x']), note('a/x.md', ['a/y']), note('a/y.md'), note('b/z.md')]

  it('draws the whole vault when unscoped', () => {
    expect(ids(buildGraph(notes).nodes)).toEqual([
      '/v/a/x.md',
      '/v/a/y.md',
      '/v/b/z.md',
      '/v/top.md'
    ])
  })

  it('draws only what is under the folder', () => {
    expect(ids(buildGraph(notes, { scope: 'a' }).nodes)).toEqual(['/v/a/x.md', '/v/a/y.md'])
  })

  it('keeps an edge with both ends inside', () => {
    const { links } = buildGraph(notes, { scope: 'a' })
    expect(links).toEqual([{ source: '/v/a/x.md', target: '/v/a/y.md', kind: 'link' }])
  })

  it('drops an edge that leaves the folder', () => {
    // `top.md` links into `a`, but is not drawn — so the edge has nothing to
    // attach to. It is not a dead link, just one out of frame.
    const { links } = buildGraph(notes, { scope: 'a' })
    expect(links.some((l) => l.source === '/v/top.md' || l.target === '/v/top.md')).toBe(false)
  })

  it('does not match a folder by name prefix alone', () => {
    // `ab/` must not fall inside a scope of `a` — the separator is what makes
    // it containment rather than a shared prefix.
    const { nodes } = buildGraph([note('a/x.md'), note('ab/y.md')], { scope: 'a' })
    expect(ids(nodes)).toEqual(['/v/a/x.md'])
  })

  it('leaves the scoped folder itself out of the drawing', () => {
    const { nodes } = buildGraph([note('a/b/x.md')], {
      scope: 'a',
      folders: ['/v/a', '/v/a/b'],
      vaultRoot: '/v'
    })
    const folders = nodes.filter((n) => n.kind === 'folder').map((n) => n.relPath)
    expect(folders).toEqual(['a/b'])
  })
})

describe('nodeRadius', () => {
  const note = (degree: number): Parameters<typeof nodeRadius>[0] => ({
    kind: 'note',
    degree,
    childCount: 0
  })
  const folder = (childCount: number): Parameters<typeof nodeRadius>[0] => ({
    kind: 'folder',
    degree: 0,
    childCount
  })

  it('grows with how connected a note is', () => {
    expect(nodeRadius(note(0))).toBeLessThan(nodeRadius(note(1)))
    expect(nodeRadius(note(1))).toBeLessThan(nodeRadius(note(4)))
    expect(nodeRadius(note(4))).toBeLessThan(nodeRadius(note(50)))
  })

  it('grows sublinearly, so one hub cannot swallow its neighbourhood', () => {
    // Quadrupling the links must less than double the radius. Stated as a
    // ratio rather than a fixed bound so tuning the coefficient cannot
    // silently invalidate it.
    const leaf = nodeRadius(note(1))
    expect(nodeRadius(note(4))).toBeLessThan(leaf * 2)
    expect(nodeRadius(note(16))).toBeLessThan(nodeRadius(note(4)) * 2)
  })

  it('sizes a folder by what it holds, not by links', () => {
    expect(nodeRadius(folder(10))).toBeGreaterThan(nodeRadius(folder(1)))
    // A note's degree must not leak into a folder's size, or switching folders
    // on would resize every note on screen.
    expect(nodeRadius(folder(0))).toBe(nodeRadius(folder(0)))
  })
})

describe('buildGraph — folders', () => {
  const dir = (...parts: string[]): string => ['/v', ...parts].join('/')

  it('adds nothing when no folders are passed', () => {
    const { nodes } = buildGraph([note('a/x.md')])
    expect(nodes.every((n) => n.kind === 'note')).toBe(true)
  })

  it('joins a note to the folder holding it', () => {
    const { nodes, links } = buildGraph([note('a/x.md')], { folders: [dir('a')] })
    expect(ids(nodes)).toEqual(['/v/a', '/v/a/x.md'])
    expect(links).toEqual([{ source: '/v/a', target: '/v/a/x.md', kind: 'contains' }])
  })

  it('chains a nested folder up to its parent', () => {
    const { links } = buildGraph([note('a/b/x.md')], { folders: [dir('a'), dir('a', 'b')] })
    const contains = links.filter((l) => l.kind === 'contains')
    expect(contains).toContainEqual({ source: '/v/a/b', target: '/v/a/b/x.md', kind: 'contains' })
    expect(contains).toContainEqual({ source: '/v/a', target: '/v/a/b', kind: 'contains' })
  })

  it('leaves out a folder holding nothing that is drawn', () => {
    // `empty` has no notes under it at all, so drawing it would put a box on
    // the canvas that says nothing about the vault's links.
    const { nodes } = buildGraph([note('a/x.md')], { folders: [dir('a'), dir('empty')] })
    expect(ids(nodes)).not.toContain('/v/empty')
  })

  it('drops a folder left empty once its notes are hidden', () => {
    const notes = [note('a/x.md'), note('lonely/z.md')]
    const { nodes } = buildGraph(notes, {
      hidden: new Set(['/v/lonely/z.md']),
      folders: [dir('a'), dir('lonely')]
    })
    expect(ids(nodes)).toContain('/v/a')
    expect(ids(nodes)).not.toContain('/v/lonely')
  })

  it('counts direct children only', () => {
    const { nodes } = buildGraph([note('a/b/x.md'), note('a/y.md')], {
      folders: [dir('a'), dir('a', 'b')]
    })
    const a = nodes.find((n) => n.id === '/v/a')
    // `b` and `y.md` — not `x.md`, which belongs to `b`.
    expect(a?.childCount).toBe(2)
  })

  it('does not let containment change how connected a note looks', () => {
    const plain = buildGraph([note('a/x.md')])
    const withFolders = buildGraph([note('a/x.md')], { folders: [dir('a')] })
    const degreeOf = (g: typeof plain): number | undefined =>
      g.nodes.find((n) => n.id === '/v/a/x.md')?.degree
    expect(degreeOf(withFolders)).toBe(degreeOf(plain))
  })

  it('carries the folder name for its icon', () => {
    const { nodes } = buildGraph([note('Projects/x.md')], { folders: [dir('Projects')] })
    expect(nodes.find((n) => n.kind === 'folder')?.name).toBe('Projects')
  })

  it('gives a folder its vault-relative path', () => {
    // Load-bearing, not cosmetic: this is the key the tree stores a folder's
    // icon override under, so a folder whose relPath is wrong silently shows
    // the default icon instead of the one the user picked.
    const { nodes } = buildGraph([note('a/b/x.md')], {
      folders: [dir('a'), dir('a', 'b')],
      vaultRoot: '/v'
    })
    const rels = nodes
      .filter((n) => n.kind === 'folder')
      .map((n) => n.relPath)
      .sort()
    expect(rels).toEqual(['a', 'a/b'])
  })

  it('leaves the path absolute when no vault root is given', () => {
    // Nothing to strip is better than stripping the wrong thing — a caller
    // that forgets the root gets an unusable key, not a plausible wrong one.
    const { nodes } = buildGraph([note('a/x.md')], { folders: [dir('a')] })
    expect(nodes.find((n) => n.kind === 'folder')?.relPath).toBe('/v/a')
  })
})
