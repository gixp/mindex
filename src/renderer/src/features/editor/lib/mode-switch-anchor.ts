import type { Node as PMNode } from '@tiptap/pm/model'
import {
  blockIndexForOffset,
  computeDocBlocks,
  computeSourceBlocks,
  frontmatterLength
} from './block-spans'

/**
 * Keeping your place across a switch between the rendered note and its
 * markdown.
 *
 * The flip used to restore a scroll percentage, which is a guess dressed as an
 * answer: it is only correct while both renderings are the same height, and
 * they never are once a note has a table or a diagram in it. The caret was not
 * restored at all — you came back to roughly the right region of a document
 * with your cursor at the top.
 *
 * What travels instead is an **anchor**: which block you were in, what kind it
 * was, what it said, and how far into it you had got. The other side looks for
 * that block and says how sure it is.
 *
 * ## Saying how sure it is
 *
 * The grade is the point. A note can change between the two captures — the
 * assistant can write into it, a sync can land — and a resolver that always
 * returns a number cannot tell "I found your paragraph" from "I ran out of
 * document and stopped at the end". Callers restore the caret only when the
 * answer is good enough to deserve one, and fall back to scrolling when it is
 * not.
 */

export type AnchorConfidence = 'exact' | 'same-kind' | 'ordinal' | 'clamped'

/** How much a grade is worth, for callers deciding whether to trust it. */
const RANK: Record<AnchorConfidence, number> = {
  exact: 3,
  'same-kind': 2,
  ordinal: 1,
  clamped: 0
}

/** Whether a grade is good enough to move the caret rather than only scroll. */
export function isCaretWorthy(confidence: AnchorConfidence): boolean {
  return RANK[confidence] >= RANK['same-kind']
}

export interface BlockAnchor {
  blockIndex: number
  kind: string
  /** What the block said, for recognising it when the index has moved. */
  text: string
  /** How far into the block's own text the caret was. */
  offsetInBlock: number
}

export interface ResolvedPosition {
  /** Offset of the block's start, in the target representation. */
  blockStart: number
  blockEnd: number
  /** Where the caret goes: the block's start plus as much of the original
   *  offset as still fits. */
  point: number
  confidence: AnchorConfidence
}

/** Whitespace and case aside, is this the same text? */
function sameText(a: string, b: string): boolean {
  const norm = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase()
  const x = norm(a)
  const y = norm(b)
  if (x === '' && y === '') return true
  return x === y
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(value, hi))
}

/**
 * Grade a candidate block against the anchor.
 *
 * Ordered from strongest evidence to weakest: the same words is the best
 * possible answer, the same kind in the same position is a good one, the same
 * position alone is a guess, and off the end of the document is an admission.
 */
function grade(
  anchor: BlockAnchor,
  candidate: { kind: string; text: string } | null,
  inRange: boolean
): AnchorConfidence {
  if (!inRange || !candidate) return 'clamped'
  if (sameText(anchor.text, candidate.text)) return 'exact'
  if (anchor.kind === candidate.kind) return 'same-kind'
  return 'ordinal'
}

/**
 * Find the anchor's block among candidates.
 *
 * Its own index first, because a document that has not changed resolves there
 * and nothing else needs to happen. Only if the text does not match does it
 * look further, and then only at blocks of the same kind — a search across
 * every block would happily match an empty paragraph anywhere in the note.
 */
function locate(
  anchor: BlockAnchor,
  blocks: { kind: string; text: string }[]
): { index: number; inRange: boolean } {
  if (blocks.length === 0) return { index: -1, inRange: false }

  const atIndex = blocks[anchor.blockIndex]
  if (atIndex && sameText(anchor.text, atIndex.text)) {
    return { index: anchor.blockIndex, inRange: true }
  }

  // Only worth searching for a block that says something. An empty paragraph
  // matches every other empty paragraph, and jumping to the first of those is
  // worse than staying at the ordinal the caller came from.
  if (anchor.text.trim() !== '') {
    const found = blocks.findIndex((b) => b.kind === anchor.kind && sameText(anchor.text, b.text))
    if (found !== -1) return { index: found, inRange: true }
  }

  const inRange = anchor.blockIndex >= 0 && anchor.blockIndex < blocks.length
  return { index: clamp(anchor.blockIndex, 0, blocks.length - 1), inRange }
}

/** Where the caret was, taken from the rendered document. */
export function captureFromDoc(doc: PMNode, pos: number): BlockAnchor | null {
  const blocks = computeDocBlocks(doc)
  if (blocks.length === 0) return null
  const index = blocks.findIndex((b) => pos < b.end)
  const i = index === -1 ? blocks.length - 1 : index
  const block = blocks[i]!
  return {
    blockIndex: i,
    kind: block.kind,
    text: block.text,
    // `+1` for the block's own opening token: a position inside a paragraph
    // starts one past where the paragraph node does.
    offsetInBlock: Math.max(0, pos - (block.start + 1))
  }
}

/**
 * Where the caret was, taken from the markdown.
 *
 * `offset` is measured from the start of the whole source, frontmatter
 * included, because that is what CodeMirror reports.
 */
export function captureFromSource(source: string, offset: number): BlockAnchor | null {
  const blocks = computeSourceBlocks(source)
  if (blocks.length === 0) return null
  const bodyOffset = offset - frontmatterLength(source)
  const i = Math.max(0, blockIndexForOffset(blocks, bodyOffset))
  const block = blocks[i]!
  return {
    blockIndex: i,
    kind: block.kind,
    text: block.text,
    offsetInBlock: Math.max(0, bodyOffset - block.start)
  }
}

/** Where that anchor lands in the markdown. Offsets include frontmatter. */
export function resolveInSource(anchor: BlockAnchor, source: string): ResolvedPosition | null {
  const blocks = computeSourceBlocks(source)
  if (blocks.length === 0) return null
  const { index, inRange } = locate(anchor, blocks)
  const block = blocks[index]!
  const skip = frontmatterLength(source)
  const start = block.start + skip
  const end = block.end + skip
  const confidence = grade(anchor, block, inRange)
  return {
    blockStart: start,
    blockEnd: end,
    // Only as far in as the block actually goes. A caret 200 characters into a
    // paragraph that is now 20 characters long belongs at its end, not past it.
    point: clamp(start + anchor.offsetInBlock, start, end),
    confidence
  }
}

/** Where that anchor lands in the rendered document. */
export function resolveInDoc(anchor: BlockAnchor, doc: PMNode): ResolvedPosition | null {
  const blocks = computeDocBlocks(doc)
  if (blocks.length === 0) return null
  const { index, inRange } = locate(anchor, blocks)
  const block = blocks[index]!
  const confidence = grade(anchor, block, inRange)
  // Inside the block, not on it: `start` addresses the node itself, and a text
  // selection there would select the whole block rather than place a caret.
  const first = block.start + 1
  const last = Math.max(first, block.end - 1)
  return {
    blockStart: block.start,
    blockEnd: block.end,
    point: clamp(first + anchor.offsetInBlock, first, last),
    confidence
  }
}
