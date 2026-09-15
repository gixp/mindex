import type { Node as PMNode } from '@tiptap/pm/model'
import { remarkInstance } from '@/platform/markdown/markdown'

/**
 * A document's top-level blocks, in whichever of the two forms it is currently
 * being edited.
 *
 * The editor shows a note two ways — rendered, and as the markdown behind it —
 * and until now switching between them threw away where you were. The old
 * approach kept a *scroll percentage*, which only works while both renderings
 * are the same height. They are not: a table, an image, a Mermaid diagram and
 * a callout are all far taller rendered than written, so the further down a
 * note you are, the further from your place the flip lands.
 *
 * Blocks are the unit that survives the trip. A paragraph is the third block in
 * both forms whatever either happens to look like, so "third block, 12
 * characters in" means the same thing on both sides.
 */

/** One top-level block of a markdown source, with where it sits in the text. */
export interface SourceBlock {
  /** Character offset of the block's first character. */
  start: number
  /** Character offset one past its last. */
  end: number
  kind: string
  /** The block's visible text, for recognising it again. */
  text: string
}

/**
 * The one name a block kind goes by.
 *
 * ProseMirror and mdast name the same things differently, and a few things
 * that differ in one are the same block in the other: three kinds of list are
 * one kind of list to a reader, and to anyone deciding whether they are still
 * in the block they started in.
 *
 * Without this the two sides could never agree, and every comparison across a
 * mode switch would fail on the name before it got to the content.
 */
export function canonicalBlockKind(typeName: string): string {
  switch (typeName) {
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
    case 'listItem':
    case 'list':
      return 'list'
    case 'codeBlock':
    case 'code':
      return 'code'
    case 'horizontalRule':
    case 'thematicBreak':
      return 'rule'
    case 'blockquote':
      return 'quote'
    case 'htmlBlock':
    case 'html':
      return 'html'
    case 'table':
      return 'table'
    // Everything Mindex draws with a node view is one kind as far as position
    // is concerned: a block you cannot put a caret inside, occupying one slot.
    case 'mermaid':
    case 'chart':
    case 'statCards':
    case 'customSvg':
    case 'excalidraw':
    case 'image':
    case 'video':
    case 'audio':
    case 'pdfCard':
    case 'fileCard':
    case 'embed':
      return 'embed'
    default:
      return typeName
  }
}

/** Every character of visible text under a node, in order. */
function mdastText(node: unknown): string {
  if (typeof node !== 'object' || node === null) return ''
  const n = node as { value?: unknown; children?: unknown }
  if (typeof n.value === 'string') return n.value
  if (Array.isArray(n.children)) return n.children.map(mdastText).join('')
  return ''
}

/**
 * How many characters of frontmatter sit above the body.
 *
 * The source view shows frontmatter as literal YAML at the top; the rendered
 * view does not show it as a block at all. Offsets have to be stated against
 * one origin or the trip across is off by the whole preamble, so every offset
 * here is measured from the start of the *body*.
 */
export function frontmatterLength(source: string): number {
  if (!source.startsWith('---')) return 0
  const end = source.indexOf('\n---', 3)
  if (end === -1) return 0
  const after = source.indexOf('\n', end + 1)
  return after === -1 ? source.length : after + 1
}

/**
 * The source's top-level blocks.
 *
 * Offsets are relative to the body, so they line up with the rendered
 * document's own block list — see `frontmatterLength`.
 */
export function computeSourceBlocks(source: string): SourceBlock[] {
  const skip = frontmatterLength(source)
  const body = source.slice(skip)
  const tree = remarkInstance.parse(body) as {
    children?: Array<{
      type: string
      position?: { start: { offset?: number }; end: { offset?: number } }
    }>
  }
  const blocks: SourceBlock[] = []
  for (const child of tree.children ?? []) {
    const start = child.position?.start.offset
    const end = child.position?.end.offset
    if (typeof start !== 'number' || typeof end !== 'number') continue
    blocks.push({
      start,
      end,
      kind: canonicalBlockKind(child.type),
      text: mdastText(child)
    })
  }
  return blocks
}

/** One top-level block of a rendered document, with its ProseMirror range. */
export interface DocBlock {
  /** Position of the block's own node. */
  start: number
  /** Position one past it. */
  end: number
  kind: string
  text: string
}

/**
 * The rendered document's top-level blocks.
 *
 * Only the top level: a list is one block, not one per item, which is what
 * makes it comparable with the source, where a list is one mdast node.
 */
export function computeDocBlocks(doc: PMNode): DocBlock[] {
  const blocks: DocBlock[] = []
  doc.forEach((node, offset) => {
    blocks.push({
      start: offset,
      end: offset + node.nodeSize,
      kind: canonicalBlockKind(node.type.name),
      text: node.textContent
    })
  })
  return blocks
}

/** The block containing `offset`, or the last one before it. */
export function blockIndexForOffset(
  blocks: { start: number; end: number }[],
  offset: number
): number {
  if (blocks.length === 0) return -1
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!
    if (offset < b.end) return i
  }
  return blocks.length - 1
}
