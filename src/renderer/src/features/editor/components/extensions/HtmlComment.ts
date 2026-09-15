import { Node, mergeAttributes } from '@tiptap/core'
import type { MarkdownToken } from '@tiptap/core'

/** Fields our own tokenizers add; MarkdownToken itself is marked's shape. */
interface CustomToken {
  value?: string
  raw?: string
}

/**
 * `<!-- ... -->` preserved verbatim.
 *
 * Not cosmetic. Every KANBAN.md in the vault stores task state inside HTML
 * comments — `<!-- id:t1 done:2026-05-28 -->` — so a serialiser that drops
 * comments deletes task identities and completion dates on the first
 * autosave. That was the most destructive finding of the round-trip run:
 * 16 files, all of them boards.
 *
 * The raw text is kept exactly as written (an atom, so it cannot be edited
 * into something malformed) and rendered invisibly, the way a comment behaves
 * in a preview.
 */
export const HtmlComment = Node.create({
  name: 'htmlComment',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,
  draggable: false,

  addAttributes() {
    return {
      // The full comment including delimiters, so serialisation is exact.
      raw: { default: '<!-- -->' }
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-html-comment]' }]
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-html-comment': String(node.attrs.raw ?? ''),
        class: 'html-comment',
        // Invisible in the editor but present in the document, so the round
        // trip stays lossless without showing the user machine metadata.
        style: 'display:none'
      })
    ]
  },

  renderText({ node }) {
    return String(node.attrs.raw ?? '')
  },

  markdownTokenizer: {
    name: 'htmlComment',
    level: 'inline' as const,
    start: (src: string) => src.indexOf('<!--'),
    tokenize(src: string) {
      const m = /^<!--[\s\S]*?-->/.exec(src)
      if (!m) return undefined
      return { type: 'htmlComment', raw: m[0], value: m[0] }
    }
  },

  parseMarkdown(rawToken: MarkdownToken) {
    const token = rawToken as MarkdownToken & CustomToken
    return { type: 'htmlComment', attrs: { raw: token.value ?? token.raw ?? '' } }
  },

  renderMarkdown(node: { attrs?: { raw?: string } }) {
    return node.attrs?.raw ?? ''
  }
})

/**
 * The same thing, for a comment that stands alone as its own block.
 *
 * A separate node because an extension registers exactly one tokenizer, and
 * an inline one never sees a comment that occupies a whole line. This is not
 * an edge case: `<!-- INDEX:START -->` / `<!-- INDEX:END -->` are the markers
 * the living index uses to delimit the region it regenerates inside
 * CLAUDE.md. Losing them breaks that feature, not just the text.
 */
export const HtmlCommentBlock = Node.create({
  name: 'htmlCommentBlock',
  group: 'block',
  atom: true,
  selectable: false,
  draggable: false,

  addAttributes() {
    return {
      raw: { default: '<!-- -->' }
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-html-comment-block]' }]
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-html-comment-block': String(node.attrs.raw ?? ''),
        class: 'html-comment-block',
        style: 'display:none'
      })
    ]
  },

  renderText({ node }) {
    return String(node.attrs.raw ?? '')
  },

  markdownTokenizer: {
    name: 'htmlCommentBlock',
    level: 'block' as const,
    start: (src: string) => src.indexOf('<!--'),
    tokenize(src: string) {
      const m = /^<!--[\s\S]*?-->[ \t]*(?:\n|$)/.exec(src)
      if (!m) return undefined
      const raw = m[0].trimEnd()
      return { type: 'htmlCommentBlock', raw: m[0], value: raw }
    }
  },

  parseMarkdown(rawToken: MarkdownToken) {
    const token = rawToken as MarkdownToken & CustomToken
    return {
      type: 'htmlCommentBlock',
      attrs: { raw: (token.value ?? token.raw ?? '').trimEnd() }
    }
  },

  renderMarkdown(node: { attrs?: { raw?: string } }) {
    return node.attrs?.raw ?? ''
  }
})
