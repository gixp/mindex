import { Node, mergeAttributes } from '@tiptap/core'
import type { MarkdownToken } from '@tiptap/core'

/** Fields our own tokenizer adds; MarkdownToken itself is marked's shape. */
interface CustomToken {
  label?: string
}

/**
 * `#project-x` — an inline tag, distinct from the vault's existing
 * frontmatter `tags: []` array (see `frontmatter.ts`, `indexer.ts`). Inline
 * tags are new; the picker command that inserts one (`slashCommands.tsx`)
 * also appends the tag to the current note's frontmatter, so search and the
 * tag index still see it — otherwise this would be a second, disconnected
 * tagging system living only inside note bodies.
 *
 * Same atom shape as `Wikilink`. A heading's `#` never reaches this
 * tokenizer: ATX headings are block-level and require a space after the
 * hashes, so `#tag` (no space) always falls through to a paragraph, and only
 * inline tokenizing — which this hooks into — ever sees it.
 */
export const Tag = Node.create({
  name: 'tag',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,
  draggable: false,

  addAttributes() {
    return { label: { default: '' } }
  },

  parseHTML() {
    return [{ tag: 'span[data-tag]' }]
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-tag': String(node.attrs.label ?? ''),
        class: 'inline-tag'
      }),
      `#${String(node.attrs.label ?? '')}`
    ]
  },

  renderText({ node }) {
    return `#${node.attrs.label ?? ''}`
  },

  markdownTokenizer: {
    name: 'tag',
    level: 'inline' as const,
    start: (src: string) => src.indexOf('#'),
    tokenize(src: string) {
      const m = /^#([\w-]+)/.exec(src)
      if (!m) return undefined
      return { type: 'tag', raw: m[0], label: m[1] }
    }
  },

  parseMarkdown(rawToken: MarkdownToken) {
    const token = rawToken as MarkdownToken & CustomToken
    return { type: 'tag', attrs: { label: token.label ?? '' } }
  },

  renderMarkdown(node: { attrs?: { label?: string } }) {
    return `#${node.attrs?.label ?? ''}`
  }
})
