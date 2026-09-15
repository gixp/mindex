import { describe, it, expect } from 'vitest'
import type { NoteMeta, NoteTypeId } from '@shared/types'
import { buildGraph } from '@shared/graph'
import { computeLinkHealth } from './links'

/**
 * The graph and the Link Health report answer the same question — "does
 * anything point at this note?" — from the same index, and must never disagree
 * about it. They are computed by different code in different layers, so the
 * agreement needs a test rather than a comment.
 *
 * This lives on the main side because it is the only place that can see both:
 * `buildGraph` is in `shared/`, `computeLinkHealth` is in `main/`, and the
 * renderer is not allowed to import the latter.
 */

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

describe('buildGraph orphans agree with computeLinkHealth', () => {
  it('marks the same notes as the orphan report does', () => {
    const notes = [note('a.md', ['b']), note('b.md'), note('lonely.md'), note('self.md', ['self'])]
    const graphOrphans = buildGraph(notes)
      .nodes.filter((n) => n.orphan)
      .map((n) => n.relPath)
      .sort()
    const reported = computeLinkHealth(notes)
      .orphans.map((o) => o.relPath)
      .sort()
    expect(graphOrphans).toEqual(reported)
  })

  it('does not invent an orphan when the only inbound link came from a hidden file', () => {
    // CLAUDE.md is not drawn in the graph, but it does link — so `a` is not an
    // orphan, and Link Health does not call it one either. Reading "is linked"
    // off the drawn set instead of the whole vault is exactly how these two
    // drift apart.
    const notes = [note('a.md'), note('CLAUDE.md', ['a'])]
    expect(buildGraph(notes).nodes.find((n) => n.relPath === 'a.md')?.orphan).toBe(false)
    expect(computeLinkHealth(notes).orphans.map((o) => o.relPath)).not.toContain('a.md')
  })
})
