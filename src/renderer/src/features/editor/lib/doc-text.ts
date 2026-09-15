import type { Node as PmNode } from '@tiptap/pm/model'

/**
 * Locating a comment's quote inside the rendered document.
 *
 * Comment anchors are captured against the **markdown on disk** — that is the
 * text agents and external editors change, so it has to be the source of
 * truth. The editor, meanwhile, holds a ProseMirror tree where the markdown
 * syntax is gone (`**bold**` is a mark, `# Heading` is a node type). There is
 * no shared coordinate system between the two, so rather than maintaining an
 * offset map that would have to survive every edit, the quote is simply looked
 * up by its text.
 *
 * A quote that spans a formatting boundary (`say **this** loudly`, selected
 * whole) exists in the markdown with the asterisks and in the document
 * without them, so it will not be found. That case degrades to "no highlight",
 * never to a wrong highlight — the comment itself is unaffected, since it
 * lives against the markdown.
 */

export interface TextRange {
  from: number
  to: number
}

/**
 * Every position in `block` where its plain text run begins, so an offset
 * within `block.textContent` can be turned back into a document position.
 */
function textRuns(block: PmNode, blockPos: number): { offset: number; pos: number; len: number }[] {
  const runs: { offset: number; pos: number; len: number }[] = []
  let offset = 0
  block.descendants((node, pos) => {
    if (!node.isText || !node.text) return true
    // `pos` is relative to `block`; +1 steps inside the block node itself.
    runs.push({ offset, pos: blockPos + 1 + pos, len: node.text.length })
    offset += node.text.length
    return true
  })
  return runs
}

function offsetToPos(
  runs: { offset: number; pos: number; len: number }[],
  offset: number
): number | null {
  for (const run of runs) {
    if (offset >= run.offset && offset <= run.offset + run.len) {
      return run.pos + (offset - run.offset)
    }
  }
  return null
}

/**
 * Document ranges holding `quote`, searched one text block at a time.
 *
 * Per-block rather than across the whole document because a block boundary is
 * a real gap in the text — matching across one would produce a range that
 * spans structure the user never selected.
 *
 * `caseSensitive` defaults to true, matching every caller before this option
 * existed (comment anchors are captured verbatim, so a case-insensitive
 * lookup could resolve to the wrong occurrence of a word that appears both
 * capitalised and not). Find-in-note is the one caller that wants the other
 * default, and passes it explicitly.
 */
export function findQuoteRanges(
  doc: PmNode,
  quote: string,
  opts: { caseSensitive?: boolean } = {}
): TextRange[] {
  if (!quote) return []
  const caseSensitive = opts.caseSensitive ?? true
  const needle = caseSensitive ? quote : quote.toLowerCase()
  const out: TextRange[] = []

  doc.descendants((node, pos) => {
    // Only leaf text blocks (paragraph, heading, list item content…); their
    // children are text and marks, not further blocks.
    if (!node.isTextblock) return true
    const content = node.textContent
    const haystack = caseSensitive ? content : content.toLowerCase()
    if (!haystack.includes(needle)) return false

    const runs = textRuns(node, pos)
    let at = haystack.indexOf(needle)
    while (at !== -1) {
      const from = offsetToPos(runs, at)
      const to = offsetToPos(runs, at + needle.length)
      // A block can hold inline atoms (wikilinks, math, tags) that contribute
      // no text, so an offset in `textContent` does not always map back to a
      // usable range. A degenerate one is dropped rather than handed to
      // ProseMirror, which throws on it and takes the whole view with it.
      if (from !== null && to !== null && to > from) out.push({ from, to })
      at = haystack.indexOf(needle, at + 1)
    }
    return false
  })

  return out
}

/**
 * The selection as plain text, plus what surrounds it — the raw material for a
 * new anchor. Main then locates this same text in the markdown file and
 * captures the anchor there.
 */
export function selectionQuote(
  doc: PmNode,
  from: number,
  to: number,
  contextLength: number
): { exact: string; prefix: string; suffix: string; occurrence: number } {
  const exact = doc.textBetween(from, to, '\n', '\n')
  const prefix = doc.textBetween(Math.max(0, from - contextLength), from, '\n', '\n')
  const suffix = doc.textBetween(to, Math.min(doc.content.size, to + contextLength), '\n', '\n')
  // Which copy of the phrase was selected. This index is the one thing both
  // coordinate systems agree on: main counts matches in the markdown file, the
  // editor counts them in the document, and for prose the two line up.
  const ranges = findQuoteRanges(doc, exact)
  const occurrence = Math.max(
    0,
    ranges.findIndex((r) => r.from === from)
  )
  return { exact, prefix, suffix, occurrence }
}
