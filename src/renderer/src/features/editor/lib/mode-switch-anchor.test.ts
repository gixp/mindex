import { describe, expect, it } from 'vitest'
import { canonicalBlockKind, computeSourceBlocks, frontmatterLength } from './block-spans'
import {
  captureFromSource,
  isCaretWorthy,
  resolveInSource,
  type BlockAnchor
} from './mode-switch-anchor'

/**
 * Keeping your place when the editor flips between the note and its markdown.
 *
 * The old answer was a scroll percentage, which is only right while both
 * renderings are the same height. The test that matters here is the one with a
 * table in it: rendered, a table is many times taller than the pipes and dashes
 * it is written as, so a percentage taken on one side points somewhere else
 * entirely on the other. An anchor does not care how tall anything is.
 */

const NOTE = [
  '# Title',
  '',
  'The opening paragraph.',
  '',
  '| a | b |',
  '| - | - |',
  '| 1 | 2 |',
  '',
  'The paragraph after the table.',
  '',
  '```ts',
  'const value = 42',
  '```',
  '',
  'The last paragraph.'
].join('\n')

describe('computeSourceBlocks', () => {
  it('finds every top-level block, and only the top level', () => {
    const blocks = computeSourceBlocks(NOTE)
    expect(blocks.map((b) => b.kind)).toEqual([
      'heading',
      'paragraph',
      'table',
      'paragraph',
      'code',
      'paragraph'
    ])
  })

  it('reports offsets that actually address the source', () => {
    const blocks = computeSourceBlocks(NOTE)
    const code = blocks.find((b) => b.kind === 'code')!
    expect(NOTE.slice(code.start, code.end)).toContain('const value = 42')
  })

  it('keeps a list as one block rather than one per item', () => {
    // The rendered side has one list node too. Counting items here would put
    // the two sides permanently out of step.
    const blocks = computeSourceBlocks('- one\n- two\n- three\n')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.kind).toBe('list')
  })
})

describe('frontmatter', () => {
  const WITH_FM = ['---', 'title: A note', '---', '', 'Body text.'].join('\n')

  it('is measured, so body offsets line up with the rendered side', () => {
    // The length of the frontmatter *block*, not where the first word after it
    // starts — the blank line between them belongs to the body, and counting it
    // as preamble would shift every offset by one.
    const body = WITH_FM.slice(frontmatterLength(WITH_FM))
    expect(body).toContain('Body text.')
    expect(body).not.toContain('title:')
    expect(body).not.toContain('---')
  })

  it('is not counted as a block', () => {
    expect(computeSourceBlocks(WITH_FM).map((b) => b.kind)).toEqual(['paragraph'])
  })

  it('is not confused by a rule in the body', () => {
    expect(frontmatterLength('Just text\n\n---\n\nmore')).toBe(0)
  })
})

describe('canonicalBlockKind', () => {
  it('gives the two representations one vocabulary', () => {
    // ProseMirror's name on the left of each pair, mdast's on the right.
    expect(canonicalBlockKind('bulletList')).toBe(canonicalBlockKind('list'))
    expect(canonicalBlockKind('codeBlock')).toBe(canonicalBlockKind('code'))
    expect(canonicalBlockKind('horizontalRule')).toBe(canonicalBlockKind('thematicBreak'))
  })

  it('treats the drawn blocks as one kind', () => {
    // None of them takes a caret; each occupies one slot. For the purpose of
    // "which block was I in", that is all they are.
    expect(canonicalBlockKind('mermaid')).toBe('embed')
    expect(canonicalBlockKind('chart')).toBe('embed')
  })
})

describe('an anchor round-trips through the source', () => {
  it('lands in the same block, exactly', () => {
    const target = NOTE.indexOf('after the table')
    const anchor = captureFromSource(NOTE, target)!
    expect(anchor.kind).toBe('paragraph')
    expect(anchor.text).toBe('The paragraph after the table.')

    const back = resolveInSource(anchor, NOTE)!
    expect(back.confidence).toBe('exact')
    expect(NOTE.slice(back.blockStart, back.blockEnd)).toBe('The paragraph after the table.')
  })

  it('keeps how far into the block you were', () => {
    const target = NOTE.indexOf('after the table')
    const anchor = captureFromSource(NOTE, target)!
    const back = resolveInSource(anchor, NOTE)!
    expect(back.point).toBe(target)
  })

  /**
   * The bug this whole thing exists for.
   *
   * The table renders many times taller than it is written. Under the old
   * scroll-percentage the caret's position relative to the document's *height*
   * is what travelled, so a point just below a table came back somewhere in
   * the middle of it. The block index does not move.
   */
  it('is not fooled by a block that renders far taller than it is written', () => {
    const anchor = captureFromSource(NOTE, NOTE.indexOf('The last paragraph.'))!
    expect(anchor.blockIndex).toBe(5)

    const back = resolveInSource(anchor, NOTE)!
    expect(NOTE.slice(back.blockStart, back.blockEnd)).toBe('The last paragraph.')
    expect(back.confidence).toBe('exact')
  })
})

describe('the grade says how much to trust the answer', () => {
  const anchorTo = (text: string): BlockAnchor => captureFromSource(NOTE, NOTE.indexOf(text))!

  it('is exact when the block still says the same thing', () => {
    expect(resolveInSource(anchorTo('The opening paragraph.'), NOTE)!.confidence).toBe('exact')
  })

  it('finds a block that has moved, rather than trusting the index', () => {
    // A paragraph inserted above pushes everything down one. The words are
    // still there, so the anchor should follow them.
    const edited = NOTE.replace('# Title', '# Title\n\nSomething new.')
    const back = resolveInSource(anchorTo('The last paragraph.'), edited)!
    expect(edited.slice(back.blockStart, back.blockEnd)).toBe('The last paragraph.')
    expect(back.confidence).toBe('exact')
  })

  it('falls back to the same kind at the same place when the words changed', () => {
    const edited = NOTE.replace('The opening paragraph.', 'Rewritten entirely.')
    const back = resolveInSource(anchorTo('The opening paragraph.'), edited)!
    expect(back.confidence).toBe('same-kind')
    expect(edited.slice(back.blockStart, back.blockEnd)).toBe('Rewritten entirely.')
  })

  it('admits when it ran out of document', () => {
    const back = resolveInSource(anchorTo('The last paragraph.'), '# Only a heading\n')!
    expect(back.confidence).toBe('clamped')
  })

  it('does not chase an empty block, which would match anywhere', () => {
    const anchor: BlockAnchor = { blockIndex: 1, kind: 'paragraph', text: '', offsetInBlock: 0 }
    const back = resolveInSource(anchor, NOTE)!
    // Stays at the ordinal it came from rather than jumping to the first empty
    // paragraph it can find.
    expect(back.blockStart).toBe(computeSourceBlocks(NOTE)[1]!.start)
  })

  it('separates the grades worth a caret from the ones worth only a scroll', () => {
    expect(isCaretWorthy('exact')).toBe(true)
    expect(isCaretWorthy('same-kind')).toBe(true)
    expect(isCaretWorthy('ordinal')).toBe(false)
    expect(isCaretWorthy('clamped')).toBe(false)
  })
})

describe('the caret never lands outside its block', () => {
  it('stops at the end when the block has shrunk under it', () => {
    const anchor: BlockAnchor = {
      blockIndex: 0,
      kind: 'paragraph',
      text: 'a much longer paragraph than what is there now',
      offsetInBlock: 200
    }
    const back = resolveInSource(anchor, 'short\n')!
    expect(back.point).toBeLessThanOrEqual(back.blockEnd)
    expect(back.point).toBeGreaterThanOrEqual(back.blockStart)
  })

  it('has nothing to say about an empty document', () => {
    expect(captureFromSource('', 0)).toBeNull()
    const anchor: BlockAnchor = { blockIndex: 0, kind: 'paragraph', text: 'x', offsetInBlock: 0 }
    expect(resolveInSource(anchor, '')).toBeNull()
  })
})
