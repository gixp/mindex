import { Node, mergeAttributes } from '@tiptap/core'
import type { MarkdownToken } from '@tiptap/core'

/** Fields our own tokenizer adds; MarkdownToken itself is marked's shape. */
interface CustomToken {
  source?: string
}

type MermaidApi = typeof import('mermaid').default

/**
 * Mermaid is one of the heaviest dependencies in the app, and most notes never
 * contain a diagram — so it is loaded on first use rather than bundled into
 * the editor's startup path. The promise is cached, so a note with twenty
 * diagrams still loads it once.
 */
let mermaidPromise: Promise<MermaidApi> | null = null

function loadMermaid(): Promise<MermaidApi> {
  mermaidPromise ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      // The app is dark-only (`globals.css` declares a single `:root` with
      // `color-scheme: dark`), so this does not need to react to a theme
      // switch — there isn't one.
      theme: 'dark',
      // Diagram source can arrive from a synced vault or be written by an
      // agent, so labels are treated as untrusted: no raw HTML, no scripts.
      securityLevel: 'strict',
      // Without this, a diagram that fails to parse makes Mermaid inject its
      // own error graphic straight into the document — outside this node,
      // where nothing would ever clean it up. We render our own instead.
      suppressErrorRendering: true
    })
    return mermaid
  })
  return mermaidPromise
}

/**
 * Every `render()` call needs an id that is unique for the whole document:
 * Mermaid uses it for the ids inside the generated SVG, and repeats make
 * arrow markers resolve against the wrong diagram.
 */
let renderSeq = 0

function showSource(dom: HTMLElement, message: string, source: string): void {
  dom.replaceChildren()
  const label = document.createElement('div')
  label.className = 'block-config-error'
  label.textContent = message
  const pre = document.createElement('pre')
  pre.className = 'mermaid-source'
  // The source is shown on failure on purpose: this node is an atom, so the
  // text is not visible anywhere in Preview once it stops rendering. Without
  // it, a typo would leave nothing on screen but an error line.
  pre.textContent = source
  dom.append(label, pre)
}

async function renderMermaid(dom: HTMLElement, source: string): Promise<void> {
  const trimmed = source.trim()
  if (!trimmed) {
    showSource(dom, 'Empty diagram', '')
    return
  }
  try {
    const mermaid = await loadMermaid()
    const { svg } = await mermaid.render(`mindex-mermaid-${++renderSeq}`, trimmed)
    // The NodeView may have been torn down while the import or the render was
    // in flight (tab closed, node deleted); writing into a detached element is
    // harmless but pointless.
    if (!dom.isConnected) return
    dom.innerHTML = svg
  } catch (e) {
    if (!dom.isConnected) return
    const message = e instanceof Error ? e.message : String(e)
    showSource(dom, message.split('\n')[0] ?? 'Could not render diagram', trimmed)
  }
}

/**
 * ```mermaid
 * flowchart TD
 *   A[Start] --> B[Done]
 * ```
 *
 * Same edit model as `Chart` and `BlockMath`: an atom whose only state is the
 * raw source text, kept verbatim through the markdown round trip and parsed
 * only inside the NodeView, so a half-typed diagram can never break parsing.
 *
 * Diagrams are longer than the other block types here, so "delete and retype"
 * is a poor way to change one — Source mode is the way to edit an existing
 * diagram in place.
 */
export const Mermaid = Node.create({
  name: 'mermaid',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return { source: { default: '' } }
  },

  parseHTML() {
    return [{ tag: 'div[data-mermaid]' }]
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-mermaid': String(node.attrs.source ?? ''),
        class: 'mermaid-block'
      })
    ]
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div')
      dom.className = 'mermaid-block'
      const source = String(node.attrs.source ?? '')
      dom.setAttribute('data-mermaid', source)
      void renderMermaid(dom, source)
      return { dom }
    }
  },

  renderText({ node }) {
    return `\`\`\`mermaid\n${node.attrs.source ?? ''}\n\`\`\``
  },

  markdownTokenizer: {
    name: 'mermaid',
    level: 'block' as const,
    start: (src: string) => src.search(/^```mermaid\s*$/m),
    tokenize(src: string) {
      const m = /^```mermaid[ \t]*\n([\s\S]*?)\n```[ \t]*(?:\n|$)/.exec(src)
      if (!m) return undefined
      return { type: 'mermaid', raw: m[0], source: m[1] }
    }
  },

  parseMarkdown(rawToken: MarkdownToken) {
    const token = rawToken as MarkdownToken & CustomToken
    return { type: 'mermaid', attrs: { source: token.source ?? '' } }
  },

  renderMarkdown(node: { attrs?: { source?: string } }) {
    return `\`\`\`mermaid\n${node.attrs?.source ?? ''}\n\`\`\``
  }
})
