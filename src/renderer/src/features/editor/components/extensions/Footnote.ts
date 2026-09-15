import { Node, mergeAttributes } from '@tiptap/core'
import type {
  JSONContent,
  MarkdownParseHelpers,
  MarkdownRendererHelpers,
  MarkdownToken
} from '@tiptap/core'

/** Fields our own tokenizers add; MarkdownToken itself is marked's shape. */
interface CustomToken {
  label?: string
  text?: string
}

/**
 * `[^1]` — a footnote reference.
 *
 * CommonMark/GFM footnotes (`[^1]` + `[^1]: text`) have no built-in support in
 * this editor's markdown parser (`marked`), so both halves are custom nodes,
 * same shape as `Wikilink.ts`. The ref is a small atom: its label is the only
 * state, and clicking it jumps to the matching `footnoteDefinition` (wired in
 * `NoteEditor.tsx`'s `handleClickOn`, alongside the existing wikilink/link
 * click handling).
 *
 * The bail-out in `tokenize` matters: a line that begins `[^1]: text` must be
 * left for `FootnoteDefinition`'s block-level tokenizer, not swallowed here
 * as a reference immediately followed by a stray colon.
 */
export const FootnoteRef = Node.create({
  name: 'footnoteRef',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,
  draggable: false,

  addAttributes() {
    return { label: { default: '' } }
  },

  parseHTML() {
    return [{ tag: 'sup[data-footnote-ref]' }]
  },

  renderHTML({ HTMLAttributes, node }) {
    const label = String(node.attrs.label ?? '')
    return [
      'sup',
      mergeAttributes(HTMLAttributes, {
        id: `footnote-ref-${label}`,
        'data-footnote-ref': label,
        class: 'footnote-ref'
      }),
      ['a', { href: `#footnote-${label}` }, label]
    ] as never
  },

  renderText({ node }) {
    return `[^${node.attrs.label ?? ''}]`
  },

  markdownTokenizer: {
    name: 'footnoteRef',
    level: 'inline' as const,
    start: (src: string) => src.search(/\[\^[^\]]+\]/),
    tokenize(src: string) {
      const m = /^\[\^([^\]]+)\]/.exec(src)
      if (!m) return undefined
      if (src.slice(m[0].length).startsWith(':')) return undefined
      return { type: 'footnoteRef', raw: m[0], label: m[1] }
    }
  },

  parseMarkdown(rawToken: MarkdownToken) {
    const token = rawToken as MarkdownToken & CustomToken
    return { type: 'footnoteRef', attrs: { label: token.label ?? '' } }
  },

  renderMarkdown(node: { attrs?: { label?: string } }) {
    return `[^${node.attrs?.label ?? ''}]`
  }
})

/**
 * `[^1]: the definition text` — a block on its own, collected wherever the
 * user places it (usually the end of the note). Unlike the ref, this carries
 * real editable inline content rather than a flat string attribute: a
 * footnote's text is prose, and prose should be editable like prose, not
 * updated through an attribute panel that doesn't exist.
 */
export const FootnoteDefinition = Node.create({
  name: 'footnoteDefinition',
  group: 'block',
  content: 'inline*',
  defining: true,

  addAttributes() {
    return { label: { default: '' } }
  },

  parseHTML() {
    return [{ tag: 'div[data-footnote-def]', contentElement: '.footnote-definition-body' }]
  },

  renderHTML({ HTMLAttributes, node }) {
    const label = String(node.attrs.label ?? '')
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        id: `footnote-${label}`,
        'data-footnote-def': label,
        class: 'footnote-definition'
      }),
      ['span', { class: 'footnote-definition-label', contenteditable: 'false' }, `${label}.`],
      ['div', { class: 'footnote-definition-body' }, 0],
      [
        'a',
        { href: `#footnote-ref-${label}`, class: 'footnote-backref', contenteditable: 'false' },
        '↩'
      ]
    ] as never
  },

  renderText({ node }) {
    return `[^${node.attrs.label ?? ''}]: ${node.textContent}`
  },

  markdownTokenizer: {
    name: 'footnoteDefinition',
    level: 'block' as const,
    start: (src: string) => src.search(/\[\^[^\]]+\]:/),
    tokenize(src: string) {
      const m = /^\[\^([^\]]+)\]:[ \t]?(.*)(?:\n|$)/.exec(src)
      if (!m) return undefined
      return { type: 'footnoteDefinition', raw: m[0], label: m[1], text: m[2] ?? '' }
    }
  },

  parseMarkdown(rawToken: MarkdownToken, helpers: MarkdownParseHelpers) {
    const token = rawToken as MarkdownToken & CustomToken
    const text = token.text ?? ''
    const content = helpers.tokenizeInline
      ? helpers.parseInline(helpers.tokenizeInline(text))
      : text
        ? [{ type: 'text', text }]
        : []
    return { type: 'footnoteDefinition', attrs: { label: token.label ?? '' }, content }
  },

  renderMarkdown(
    node: { attrs?: { label?: string }; content?: JSONContent[] },
    helpers: MarkdownRendererHelpers
  ) {
    const label = node.attrs?.label ?? ''
    const text = node.content && node.content.length > 0 ? helpers.renderChildren(node.content) : ''
    return `[^${label}]: ${text}`
  }
})
