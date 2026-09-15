import { Node, mergeAttributes } from '@tiptap/core'
import type { MarkdownToken } from '@tiptap/core'
import { sanitizeNoteHtml } from '@/platform/markdown/sanitize-embedded-html'

/** Fields our own tokenizer adds; MarkdownToken itself is marked's shape. */
interface CustomToken {
  source?: string
}

/**
 * Tags claimed by other nodes in this same pass (`svg`, `video`, `audio`,
 * `details`/`summary` land as their own dedicated nodes elsewhere; `iframe`
 * is `Embed` in this file's own sibling). `htmlBlock` is the catch-all for
 * everything else, so it must decline these explicitly rather than relying
 * on registration order in `noteExtensions()`.
 */
const RESERVED_TAGS = new Set(['svg', 'video', 'audio', 'details', 'summary', 'iframe'])

/**
 * A single top-level raw HTML element (`<div>…</div>`, `<table>…</table>`,
 * a custom element, etc.), preserved verbatim and rendered live.
 *
 * Same edit model as `BlockMath`: an atom whose only state is the source
 * text, so there is no way to leave the document with unbalanced tags. To
 * change the markup, delete the node and re-run the picker.
 */
export const HtmlBlock = Node.create({
  name: 'htmlBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return { source: { default: '' } }
  },

  parseHTML() {
    return [{ tag: 'div[data-html-block]' }]
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-html-block': String(node.attrs.source ?? ''),
        class: 'html-block'
      })
    ]
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div')
      dom.className = 'html-block'
      dom.setAttribute('data-html-block', String(node.attrs.source ?? ''))
      // The note decides this markup, so it is filtered before it becomes
      // real nodes — see lib/sanitize-embedded-html.ts.
      dom.innerHTML = sanitizeNoteHtml(String(node.attrs.source ?? ''))
      return { dom }
    }
  },

  renderText({ node }) {
    return String(node.attrs.source ?? '')
  },

  markdownTokenizer: {
    name: 'htmlBlock',
    level: 'block' as const,
    start: (src: string) => src.search(/^<[a-zA-Z]/m),
    tokenize(src: string) {
      const m = /^<([a-zA-Z][\w-]*)\b[^>]*>[\s\S]*?<\/\1>[ \t]*(?:\n|$)/.exec(src)
      if (!m) return undefined
      const tag = m[1] ?? ''
      if (RESERVED_TAGS.has(tag.toLowerCase())) return undefined
      return { type: 'htmlBlock', raw: m[0], source: m[0].trimEnd() }
    }
  },

  parseMarkdown(rawToken: MarkdownToken) {
    const token = rawToken as MarkdownToken & CustomToken
    return { type: 'htmlBlock', attrs: { source: token.source ?? '' } }
  },

  renderMarkdown(node: { attrs?: { source?: string } }) {
    return node.attrs?.source ?? ''
  }
})
