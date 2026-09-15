import { Node, mergeAttributes } from '@tiptap/core'
import type {
  JSONContent,
  MarkdownParseHelpers,
  MarkdownRendererHelpers,
  MarkdownToken
} from '@tiptap/core'

/** Fields our own tokenizer adds; MarkdownToken itself is marked's shape. */
interface CustomToken {
  summary?: string
  body?: string
}

function toInlineContent(text: string, helpers: MarkdownParseHelpers): JSONContent[] {
  if (helpers.tokenizeInline) return helpers.parseInline(helpers.tokenizeInline(text))
  return text ? [{ type: 'text', text }] : []
}

function renderInlineContent(
  node: JSONContent | undefined,
  helpers: MarkdownRendererHelpers
): string {
  return node?.content && node.content.length > 0 ? helpers.renderChildren(node.content) : ''
}

/**
 * The clickable title line of a `toggle`. Real inline content (not an atom's
 * attribute string) so it edits like any other line of prose — same
 * reasoning as `FootnoteDefinition`'s body.
 */
export const ToggleSummary = Node.create({
  name: 'toggleSummary',
  content: 'inline*',

  parseHTML() {
    return [{ tag: 'summary' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['summary', mergeAttributes(HTMLAttributes, { class: 'toggle-summary' }), 0]
  }
})

/**
 * The collapsible body of a `toggle`. Needs a marker class in its own
 * `renderHTML` because a bare `div` inside `<details>` isn't otherwise
 * distinguishable from the summary's sibling on parse.
 */
export const ToggleBody = Node.create({
  name: 'toggleBody',
  content: 'inline*',

  parseHTML() {
    return [{ tag: 'div.toggle-body' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { class: 'toggle-body' }), 0]
  }
})

/**
 * `<details><summary>title</summary>body</details>` — a toggle, and the same
 * node powers "Accordion" in the block picker (several of these back to
 * back). Native `<details>`/`<summary>` give expand/collapse for free with
 * zero JS, so this uses plain `renderHTML`, not a NodeView.
 *
 * Two required children in a fixed order (`toggleSummary toggleBody`), each
 * supplying its own single content hole — the same shape as
 * `@tiptap/extension-table`'s `Table` (content `tableRow+`) wrapping `TableRow`
 * (its own `0` hole rendered as `tr`). The parent never needs to juggle two
 * holes itself; ProseMirror renders each child through its own `renderHTML`
 * into the parent's one `0` hole, in document order.
 *
 * Expand/collapse state is not persisted — every toggle renders open. The
 * markdown form has no way to encode it (this is a UI nicety, not document
 * state), and letting the browser own `open` after mount avoids fighting the
 * user's click with a re-render that forces it back open.
 */
export const Toggle = Node.create({
  name: 'toggle',
  group: 'block',
  content: 'toggleSummary toggleBody',
  isolating: true,

  parseHTML() {
    return [{ tag: 'details' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['details', mergeAttributes(HTMLAttributes, { class: 'toggle-block', open: '' }), 0]
  },

  markdownTokenizer: {
    name: 'toggle',
    level: 'block' as const,
    start: (src: string) => src.indexOf('<details>'),
    tokenize(src: string) {
      const m =
        /^<details>\s*<summary>([\s\S]*?)<\/summary>\s*([\s\S]*?)\s*<\/details>[ \t]*(?:\n|$)/.exec(
          src
        )
      if (!m) return undefined
      return { type: 'toggle', raw: m[0], summary: m[1], body: m[2] }
    }
  },

  parseMarkdown(rawToken: MarkdownToken, helpers: MarkdownParseHelpers) {
    const token = rawToken as MarkdownToken & CustomToken
    return {
      type: 'toggle',
      content: [
        { type: 'toggleSummary', content: toInlineContent(token.summary ?? '', helpers) },
        { type: 'toggleBody', content: toInlineContent(token.body ?? '', helpers) }
      ]
    }
  },

  renderMarkdown(node: { content?: JSONContent[] }, helpers: MarkdownRendererHelpers) {
    const [summaryNode, bodyNode] = node.content ?? []
    const summaryText = renderInlineContent(summaryNode, helpers)
    const bodyText = renderInlineContent(bodyNode, helpers)
    return `<details>\n<summary>${summaryText}</summary>\n${bodyText}\n</details>`
  }
})
