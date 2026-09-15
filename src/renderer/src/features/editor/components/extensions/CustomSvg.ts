import { Node, mergeAttributes } from '@tiptap/core'
import type { MarkdownToken } from '@tiptap/core'
import { sanitizeNoteSvg } from '@/platform/markdown/sanitize-embedded-html'

/** Fields our own tokenizer adds; MarkdownToken itself is marked's shape. */
interface CustomToken {
  source?: string
}

/**
 * `<svg>…</svg>` markup, preserved verbatim and rendered live.
 *
 * Split out from `HtmlBlock` rather than folded into it because `svg` is
 * explicitly reserved there — a dedicated node gets its own icon/preview in
 * the block-type picker and its own centred, bordered presentation, instead
 * of looking like an arbitrary HTML dump.
 *
 * Same edit model as `HtmlBlock`/`BlockMath`: atom, delete + retype to change.
 */
export const CustomSvg = Node.create({
  name: 'customSvg',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return { source: { default: '' } }
  },

  parseHTML() {
    return [{ tag: 'div[data-custom-svg]' }]
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-custom-svg': String(node.attrs.source ?? ''),
        class: 'custom-svg'
      })
    ]
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div')
      dom.className = 'custom-svg'
      dom.setAttribute('data-custom-svg', String(node.attrs.source ?? ''))
      // Same reasoning as htmlBlock: a note's own characters, filtered
      // before they become nodes — see lib/sanitize-embedded-html.ts.
      dom.innerHTML = sanitizeNoteSvg(String(node.attrs.source ?? ''))
      return { dom }
    }
  },

  renderText({ node }) {
    return String(node.attrs.source ?? '')
  },

  markdownTokenizer: {
    name: 'customSvg',
    level: 'block' as const,
    start: (src: string) => src.search(/^<svg\b/m),
    tokenize(src: string) {
      const m = /^<svg\b[^>]*>[\s\S]*?<\/svg>[ \t]*(?:\n|$)/.exec(src)
      if (!m) return undefined
      return { type: 'customSvg', raw: m[0], source: m[0].trimEnd() }
    }
  },

  parseMarkdown(rawToken: MarkdownToken) {
    const token = rawToken as MarkdownToken & CustomToken
    return { type: 'customSvg', attrs: { source: token.source ?? '' } }
  },

  renderMarkdown(node: { attrs?: { source?: string } }) {
    return node.attrs?.source ?? ''
  }
})
