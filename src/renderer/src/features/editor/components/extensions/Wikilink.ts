import { Node, mergeAttributes } from '@tiptap/core'
import type { MarkdownToken } from '@tiptap/core'
import { resolveWikilink } from '@/platform/markdown/wikilink'
import { defaultFileIcon, noteLook } from '@/platform/presentation'
import { useVaultStore } from '@/platform/workspace'
import { useUiStore } from '@/platform/app-settings'

/** Fields our own tokenizer adds; MarkdownToken itself is marked's shape. */
interface CustomToken {
  target?: string
  alias?: string | null
}

/**
 * `[[target]]` and `[[target|alias]]` — Mindex's own link syntax.
 *
 * Without this node the Markdown serialiser treats the brackets as literal
 * text and escapes them, so a round-trip turns every wikilink in the vault
 * into `\[\[target\]\]`. The words survive, which makes the damage easy to
 * miss, but the link does not.
 *
 * Modelled as an inline atom: the target is an attribute, not editable text,
 * so a stray keystroke inside a link cannot produce half-broken syntax.
 *
 * `parseMarkdown` / `renderMarkdown` / `markdownTokenizer` sit at the top
 * level of the node config — that is where Tiptap's MarkdownManager reads
 * them from, the same way the built-in Table extension declares its own.
 */
export const Wikilink = Node.create({
  name: 'wikilink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      target: { default: '' },
      alias: { default: null }
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-wikilink]' }]
  },

  renderHTML({ HTMLAttributes, node }) {
    const target = String(node.attrs.target ?? '')
    const alias = node.attrs.alias ? String(node.attrs.alias) : null
    const display = alias || target.split('/').pop() || target

    // Same markup the read-only renderer produces (lib/markdown.ts): a chip
    // carrying the file-type icon, tinted by extension. Reproduced here rather
    // than simplified — the editor must not restyle links that already have a
    // look everywhere else in the app.
    const rawBase = target.split('/').pop() ?? target
    const lookupBase = /\.[A-Za-z0-9]+$/.test(rawBase) ? rawBase : `${rawBase}.md`
    // Resolve the link to a note first: a choice is stored against a path,
    // and a link carries a target. Without this step the chip showed the icon
    // for the file kind and ignored whatever the person had picked.
    const resolvedPath = resolveWikilink(target, useVaultStore.getState().notes)
    const fileIcon = resolvedPath
      ? (() => {
          const look = noteLook(resolvedPath, lookupBase)
          return { name: look.icon ?? 'file', color: look.colorClass }
        })()
      : defaultFileIcon(lookupBase)
    const wikilinkValue = alias ? `${target}|${alias}` : target

    const children: unknown[] = []
    if (useUiStore.getState().showFileIcons) {
      children.push([
        'i',
        { class: `codicon codicon-${fileIcon.name} ${fileIcon.color ?? ''} wikilink-icon` }
      ])
    }

    // The label is its own element: `text-overflow: ellipsis` needs a box to
    // clip, and a bare text node inside the flex chip gives it nothing.
    children.push(['span', { class: 'wikilink-label' }, display])

    return [
      'span',
      mergeAttributes(HTMLAttributes, { class: 'wikilink', 'data-wikilink': wikilinkValue }),
      ...children
    ] as never
  },

  renderText({ node }) {
    const target = String(node.attrs.target ?? '')
    const alias = node.attrs.alias ? String(node.attrs.alias) : null
    return alias ? `[[${target}|${alias}]]` : `[[${target}]]`
  },

  markdownTokenizer: {
    name: 'wikilink',
    level: 'inline' as const,
    start: (src: string) => src.indexOf('[['),
    tokenize(src: string) {
      const m = /^\[\[([^\][|]+)(?:\|([^\][]*))?\]\]/.exec(src)
      if (!m) return undefined
      return { type: 'wikilink', raw: m[0], target: m[1], alias: m[2] ?? null }
    }
  },

  parseMarkdown(rawToken: MarkdownToken) {
    const token = rawToken as MarkdownToken & CustomToken
    return {
      type: 'wikilink',
      attrs: { target: token.target ?? '', alias: token.alias ?? null }
    }
  },

  renderMarkdown(node: { attrs?: { target?: string; alias?: string | null } }) {
    const target = node.attrs?.target ?? ''
    const alias = node.attrs?.alias
    return alias ? `[[${target}|${alias}]]` : `[[${target}]]`
  }
})
