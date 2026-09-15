import { describe, expect, it } from 'vitest'
import { Schema } from '@tiptap/pm/model'
import { computeDocBlocks } from './block-spans'
import { captureFromDoc, resolveInDoc, resolveInSource } from './mode-switch-anchor'

/**
 * The crossing itself: an anchor taken on one side, resolved on the other.
 *
 * The round-trip within one representation is covered next door. What this
 * pins is the part that actually broke — a position captured in the rendered
 * document landing in the right place in the markdown, and back.
 *
 * The schema here is a hand-built minimum rather than the editor's real one.
 * Mounting that means instantiating every node view the app has — Mermaid,
 * Excalidraw, charts — under jsdom, which tests the extensions rather than
 * this. What these functions need from a document is its top-level children
 * and their text, and this provides exactly that.
 */

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*', toDOM: () => ['p', 0] },
    heading: {
      group: 'block',
      content: 'text*',
      attrs: { level: { default: 1 } },
      toDOM: () => ['h1', 0]
    },
    codeBlock: { group: 'block', content: 'text*', code: true, toDOM: () => ['pre', ['code', 0]] },
    bulletList: { group: 'block', content: 'listItem+', toDOM: () => ['ul', 0] },
    listItem: { content: 'paragraph+', toDOM: () => ['li', 0] },
    text: { group: 'inline' }
  }
})

const { paragraph, heading, codeBlock, bulletList, listItem } = schema.nodes
const text = (s: string): ReturnType<typeof schema.text> => schema.text(s)

/** The rendered form of the note used by the source-side tests next door. */
const doc = schema.node('doc', null, [
  heading!.create({ level: 1 }, text('Title')),
  paragraph!.create(null, text('The opening paragraph.')),
  paragraph!.create(null, text('The paragraph after the table.')),
  codeBlock!.create(null, text('const value = 42')),
  paragraph!.create(null, text('The last paragraph.'))
])

const SOURCE = [
  '# Title',
  '',
  'The opening paragraph.',
  '',
  'The paragraph after the table.',
  '',
  '```ts',
  'const value = 42',
  '```',
  '',
  'The last paragraph.'
].join('\n')

describe('computeDocBlocks', () => {
  it('reads the top level, in the source’s own vocabulary', () => {
    expect(computeDocBlocks(doc).map((b) => b.kind)).toEqual([
      'heading',
      'paragraph',
      'paragraph',
      'code',
      'paragraph'
    ])
  })

  it('counts a list as one block, matching the source side', () => {
    const listDoc = schema.node('doc', null, [
      bulletList!.create(null, [
        listItem!.create(null, paragraph!.create(null, text('one'))),
        listItem!.create(null, paragraph!.create(null, text('two')))
      ])
    ])
    const blocks = computeDocBlocks(listDoc)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.kind).toBe('list')
  })
})

describe('an anchor crosses from the rendered note to the markdown', () => {
  it('lands on the same words', () => {
    // The caret inside the last paragraph.
    const blocks = computeDocBlocks(doc)
    const last = blocks[4]!
    const anchor = captureFromDoc(doc, last.start + 1)!
    expect(anchor.text).toBe('The last paragraph.')

    const landed = resolveInSource(anchor, SOURCE)!
    expect(landed.confidence).toBe('exact')
    expect(SOURCE.slice(landed.blockStart, landed.blockEnd)).toBe('The last paragraph.')
  })

  it('carries how far into the block the caret was', () => {
    const blocks = computeDocBlocks(doc)
    // Eight characters into "The opening paragraph." — after "The open".
    const anchor = captureFromDoc(doc, blocks[1]!.start + 1 + 8)!
    expect(anchor.offsetInBlock).toBe(8)

    const landed = resolveInSource(anchor, SOURCE)!
    expect(SOURCE.slice(landed.point, landed.point + 3)).toBe('ing')
  })

  it('crosses a code block, whose text is identical on both sides', () => {
    const blocks = computeDocBlocks(doc)
    const anchor = captureFromDoc(doc, blocks[3]!.start + 1)!
    expect(anchor.kind).toBe('code')

    const landed = resolveInSource(anchor, SOURCE)!
    expect(landed.confidence).toBe('exact')
    expect(SOURCE.slice(landed.blockStart, landed.blockEnd)).toContain('const value = 42')
  })
})

describe('and back again, into the rendered note', () => {
  it('puts the caret inside the block rather than on it', () => {
    const anchor = captureFromDoc(doc, computeDocBlocks(doc)[1]!.start + 1)!
    const landed = resolveInDoc(anchor, doc)!
    // `blockStart` addresses the node; a selection there selects the whole
    // block instead of placing a caret in it.
    expect(landed.point).toBeGreaterThan(landed.blockStart)
    expect(landed.point).toBeLessThan(landed.blockEnd)
  })

  it('never lands past the end of a block that has shrunk', () => {
    const anchor = captureFromDoc(doc, computeDocBlocks(doc)[2]!.start + 1 + 25)!
    const shorter = schema.node('doc', null, [
      heading!.create({ level: 1 }, text('Title')),
      paragraph!.create(null, text('a')),
      paragraph!.create(null, text('b'))
    ])
    const landed = resolveInDoc(anchor, shorter)!
    expect(landed.point).toBeGreaterThanOrEqual(landed.blockStart)
    expect(landed.point).toBeLessThanOrEqual(landed.blockEnd)
  })

  it('says so when the document no longer has that block', () => {
    const anchor = captureFromDoc(doc, computeDocBlocks(doc)[4]!.start + 1)!
    const shorter = schema.node('doc', null, [heading!.create({ level: 1 }, text('Title'))])
    expect(resolveInDoc(anchor, shorter)!.confidence).toBe('clamped')
  })
})
