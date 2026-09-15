import { Node, mergeAttributes } from '@tiptap/core'
import type { MarkdownToken } from '@tiptap/core'

/** Fields our own tokenizers add; MarkdownToken itself is marked's shape. */
interface CustomToken {
  source?: string
}

/**
 * The maths typesetter, fetched the first time a formula actually appears.
 *
 * It is four and a half megabytes and it was loaded at startup for everyone,
 * because this extension is part of the editor and the editor is the app. Most
 * notes contain no maths at all, and the ones that do can wait the moment it
 * takes to fetch — the source is shown meanwhile, which is what it would show
 * anyway if the formula did not parse.
 */
let katexPromise: Promise<typeof import('katex').default> | null = null
function loadKatex(): Promise<typeof import('katex').default> {
  katexPromise ??= import('katex').then((m) => m.default)
  return katexPromise
}

function renderKatex(el: HTMLElement, source: string, displayMode: boolean): void {
  // Shown until it arrives, and left in place if it never does.
  el.textContent = source
  void loadKatex()
    .then((katex) => {
      try {
        katex.render(source, el, { throwOnError: false, displayMode })
      } catch {
        el.textContent = source
      }
    })
    .catch(() => {})
}

/**
 * `$E = mc^2$` — inline math.
 *
 * Modelled as an atom, same reasoning as `Wikilink`: the LaTeX source is the
 * node's only state, not editable text, so there is no way to leave a
 * document with a half-typed, unbalanced `$`. To change a formula, delete
 * the node and retype it — the same edit model this editor already uses for
 * wikilinks, and simpler than building a dedicated editing popover for one
 * of ~20 new block types in this pass.
 *
 * KaTeX needs real DOM to render into (it produces a tree of nested spans,
 * not something a static `renderHTML` array can express), so this uses a
 * NodeView instead of `renderHTML`.
 */
export const InlineMath = Node.create({
  name: 'inlineMath',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return { source: { default: '' } }
  },

  parseHTML() {
    return [{ tag: 'span[data-inline-math]' }]
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-inline-math': String(node.attrs.source ?? ''),
        class: 'inline-math'
      })
    ]
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('span')
      dom.className = 'inline-math'
      dom.setAttribute('data-inline-math', String(node.attrs.source ?? ''))
      renderKatex(dom, String(node.attrs.source ?? ''), false)
      return { dom }
    }
  },

  renderText({ node }) {
    return `$${node.attrs.source ?? ''}$`
  },

  markdownTokenizer: {
    name: 'inlineMath',
    level: 'inline' as const,
    start: (src: string) => src.search(/\$[^$\n]/),
    tokenize(src: string) {
      const m = /^\$([^$\n]+)\$/.exec(src)
      if (!m) return undefined
      return { type: 'inlineMath', raw: m[0], source: m[1] }
    }
  },

  parseMarkdown(rawToken: MarkdownToken) {
    const token = rawToken as MarkdownToken & CustomToken
    return { type: 'inlineMath', attrs: { source: token.source ?? '' } }
  },

  renderMarkdown(node: { attrs?: { source?: string } }) {
    return `$${node.attrs?.source ?? ''}$`
  }
})

/**
 * ```
 * $$
 * E = mc^2
 * $$
 * ```
 * Block-level display math, same edit model as `InlineMath` (atom, delete +
 * retype to change). Accepts both the fenced multi-line form above and a
 * single-line `$$E = mc^2$$` for a quick equation.
 */
export const BlockMath = Node.create({
  name: 'blockMath',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return { source: { default: '' } }
  },

  parseHTML() {
    return [{ tag: 'div[data-block-math]' }]
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-block-math': String(node.attrs.source ?? ''),
        class: 'block-math'
      })
    ]
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div')
      dom.className = 'block-math'
      dom.setAttribute('data-block-math', String(node.attrs.source ?? ''))
      renderKatex(dom, String(node.attrs.source ?? ''), true)
      return { dom }
    }
  },

  renderText({ node }) {
    return `$$\n${node.attrs.source ?? ''}\n$$`
  },

  markdownTokenizer: {
    name: 'blockMath',
    level: 'block' as const,
    start: (src: string) => src.search(/^\$\$/m),
    tokenize(src: string) {
      const fenced = /^\$\$\n([\s\S]*?)\n\$\$[ \t]*(?:\n|$)/.exec(src)
      if (fenced) return { type: 'blockMath', raw: fenced[0], source: fenced[1] }
      const oneLine = /^\$\$([^\n]+)\$\$[ \t]*(?:\n|$)/.exec(src)
      if (oneLine) return { type: 'blockMath', raw: oneLine[0], source: oneLine[1] }
      return undefined
    }
  },

  parseMarkdown(rawToken: MarkdownToken) {
    const token = rawToken as MarkdownToken & CustomToken
    return { type: 'blockMath', attrs: { source: token.source ?? '' } }
  },

  renderMarkdown(node: { attrs?: { source?: string } }) {
    return `$$\n${node.attrs?.source ?? ''}\n$$`
  }
})
