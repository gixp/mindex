import { Node, mergeAttributes } from '@tiptap/core'
import type { MarkdownToken } from '@tiptap/core'
import { api } from '@/platform/api'

/** Fields our own tokenizers add; MarkdownToken itself is marked's shape. */
interface CustomToken {
  name?: string
  href?: string
}

function buildCard(kind: string, iconName: string, href: string, name: string): HTMLElement {
  const dom = document.createElement('span')
  dom.className = 'attachment-card'
  dom.setAttribute('data-kind', kind)
  dom.setAttribute('data-href', href)

  const icon = document.createElement('i')
  icon.className = `codicon codicon-${iconName} attachment-card-icon`
  dom.appendChild(icon)

  const label = document.createElement('span')
  label.className = 'attachment-card-label'
  label.textContent = name
  dom.appendChild(label)

  dom.addEventListener('click', () => {
    if (href) void api().files.reveal(href)
  })

  return dom
}

/**
 * `[📄 filename.pdf](path/to/file.pdf)` — a PDF attachment card.
 *
 * No PDF renderer exists in this project, so this is not an inline viewer:
 * it is a small clickable chip (icon + filename) that hands off to the OS
 * file browser via `api().files.reveal`, the same call `Editor.tsx`'s
 * `UnreadableFile` already uses for "Reveal in Finder".
 *
 * Modelled as an inline atom, not block, to match the markdown form: the
 * 📄-prefixed link text is what its tokenizer looks for, and that tokenizer
 * runs at the `inline` level (same phase as `Wikilink`/`Tag`) so the pattern
 * is recognised without requiring the whole line to itself — a `block`-group
 * node paired with an inline-level token would violate the schema, since
 * inline tokenizing only ever produces content for a paragraph's inline
 * array. The 📄 marker in the link TEXT (not just any `[text](href)`) is
 * what keeps this from swallowing ordinary links — see `Wikilink.ts` for the
 * same "atom carries the real state, not editable text" reasoning.
 */
export const PdfCard = Node.create({
  name: 'pdfCard',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      href: { default: '' },
      name: { default: '' }
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-pdf-card]' }]
  },

  renderHTML({ HTMLAttributes, node }) {
    const name = String(node.attrs.name ?? '')
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-pdf-card': String(node.attrs.href ?? ''),
        class: 'attachment-card',
        'data-kind': 'pdf'
      }),
      ['i', { class: 'codicon codicon-file-pdf attachment-card-icon' }],
      ['span', { class: 'attachment-card-label' }, name]
    ] as never
  },

  addNodeView() {
    return ({ node }) => {
      const href = String(node.attrs.href ?? '')
      const name = String(node.attrs.name ?? '')
      const dom = buildCard('pdf', 'file-pdf', href, name)
      dom.setAttribute('data-pdf-card', href)
      return { dom }
    }
  },

  renderText({ node }) {
    return `[📄 ${node.attrs.name ?? ''}](${node.attrs.href ?? ''})`
  },

  markdownTokenizer: {
    name: 'pdfCard',
    level: 'inline' as const,
    start: (src: string) => src.indexOf('[📄 '),
    tokenize(src: string) {
      const m = /^\[📄 ([^\]]+)\]\(([^)]+)\)/.exec(src)
      if (!m) return undefined
      return { type: 'pdfCard', raw: m[0], name: m[1], href: m[2] }
    }
  },

  parseMarkdown(rawToken: MarkdownToken) {
    const token = rawToken as MarkdownToken & CustomToken
    return { type: 'pdfCard', attrs: { href: token.href ?? '', name: token.name ?? '' } }
  },

  renderMarkdown(node: { attrs?: { href?: string; name?: string } }) {
    return `[📄 ${node.attrs?.name ?? ''}](${node.attrs?.href ?? ''})`
  }
})

/**
 * `[📎 filename.zip](path/to/file.zip)` — the same card, for any file type.
 * The 📎 marker (rather than 📄) is what lets its tokenizer coexist with
 * `PdfCard`'s without either misreading the other's links; see `PdfCard`
 * above for the full reasoning on shape and click behaviour.
 */
export const FileCard = Node.create({
  name: 'fileCard',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      href: { default: '' },
      name: { default: '' }
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-file-card]' }]
  },

  renderHTML({ HTMLAttributes, node }) {
    const name = String(node.attrs.name ?? '')
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-file-card': String(node.attrs.href ?? ''),
        class: 'attachment-card',
        'data-kind': 'file'
      }),
      ['i', { class: 'codicon codicon-file attachment-card-icon' }],
      ['span', { class: 'attachment-card-label' }, name]
    ] as never
  },

  addNodeView() {
    return ({ node }) => {
      const href = String(node.attrs.href ?? '')
      const name = String(node.attrs.name ?? '')
      const dom = buildCard('file', 'file', href, name)
      dom.setAttribute('data-file-card', href)
      return { dom }
    }
  },

  renderText({ node }) {
    return `[📎 ${node.attrs.name ?? ''}](${node.attrs.href ?? ''})`
  },

  markdownTokenizer: {
    name: 'fileCard',
    level: 'inline' as const,
    start: (src: string) => src.indexOf('[📎 '),
    tokenize(src: string) {
      const m = /^\[📎 ([^\]]+)\]\(([^)]+)\)/.exec(src)
      if (!m) return undefined
      return { type: 'fileCard', raw: m[0], name: m[1], href: m[2] }
    }
  },

  parseMarkdown(rawToken: MarkdownToken) {
    const token = rawToken as MarkdownToken & CustomToken
    return { type: 'fileCard', attrs: { href: token.href ?? '', name: token.name ?? '' } }
  },

  renderMarkdown(node: { attrs?: { href?: string; name?: string } }) {
    return `[📎 ${node.attrs?.name ?? ''}](${node.attrs?.href ?? ''})`
  }
})
