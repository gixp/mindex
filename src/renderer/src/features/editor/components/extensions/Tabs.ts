import { Node, mergeAttributes } from '@tiptap/core'
import type {
  JSONContent,
  MarkdownParseHelpers,
  MarkdownRendererHelpers,
  MarkdownToken
} from '@tiptap/core'

/** Fields our own tokenizer adds; MarkdownToken itself is marked's shape. */
interface CustomToken {
  body?: string
}

function toInlineContent(text: string, helpers: MarkdownParseHelpers): JSONContent[] {
  if (helpers.tokenizeInline) return helpers.parseInline(helpers.tokenizeInline(text))
  return text ? [{ type: 'text', text }] : []
}

/**
 * One pane of a `tabs` block. The label lives in an attribute (there is no
 * inline UI for renaming it in this pass — only its body is editable prose),
 * the same trade-off `Toggle`'s summary avoids by being real content instead.
 */
export const TabPanel = Node.create({
  name: 'tabPanel',
  content: 'inline*',

  addAttributes() {
    return { label: { default: 'Tab' } }
  },

  parseHTML() {
    return [
      {
        tag: 'div.tab-panel',
        getAttrs: (el) => ({ label: (el as HTMLElement).getAttribute('data-label') ?? 'Tab' })
      }
    ]
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        class: 'tab-panel',
        'data-label': String(node.attrs.label ?? 'Tab')
      }),
      0
    ] as never
  }
})

/**
 * `:::tabs` / `:::tab Label` / `:::` — a pill-switched set of panes.
 *
 * CommonMark has nothing like this, so the markdown form is invented for
 * this editor: the tokenizer only captures the raw blob between `:::tabs`
 * and the closing `:::` (block-level, one regex, same shape as every other
 * custom tokenizer in this file set); splitting that blob into panels
 * happens by hand in `parseMarkdown`, not in the tokenizer, because the
 * number of panels is unbounded and a single regex can't capture a variable
 * number of repeating groups.
 *
 * Rendering needs real interactivity (click a pill, switch the visible
 * panel) that a static `renderHTML` DOMOutputSpec can't express, so this
 * uses a NodeView. The NodeView's `contentDOM` is the panel container —
 * ProseMirror still mounts each `tabPanel` child through that child's own
 * `renderHTML`, exactly as it would without a NodeView, so panel bodies stay
 * fully editable; the NodeView only adds the pill row above them and toggles
 * which panel is visible. "Which panel is active" is closure state private
 * to this NodeView instance, never written to the document — switching tabs
 * must not dirty the note or appear in undo history.
 *
 * The very first paint (before any click) relies on `.tab-panel:not(:first-child)`
 * in globals.css, not on JS run after mount — `contentDOM` is still empty
 * the instant this factory returns (ProseMirror appends children right
 * after), so any `activeIndex` sync attempted here would run on an empty
 * list and accomplish nothing. Once a pill is clicked, JS fully owns
 * visibility via inline `display` from then on.
 */
export const Tabs = Node.create({
  name: 'tabs',
  group: 'block',
  content: 'tabPanel+',
  isolating: true,

  parseHTML() {
    return [{ tag: 'div[data-tabs]', contentElement: '.tabs-panels' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-tabs': '', class: 'tabs-block' }),
      ['div', { class: 'tabs-panels' }, 0]
    ] as never
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div')
      dom.className = 'tabs-block'
      dom.setAttribute('data-tabs', '')

      const pillsRow = document.createElement('div')
      pillsRow.className = 'tabs-pills'
      dom.appendChild(pillsRow)

      const contentDOM = document.createElement('div')
      contentDOM.className = 'tabs-panels'
      dom.appendChild(contentDOM)

      let activeIndex = 0
      let pills: HTMLButtonElement[] = []

      const setActive = (index: number): void => {
        activeIndex = index
        const panels = Array.from(contentDOM.children) as HTMLElement[]
        panels.forEach((panel, i) => {
          panel.style.display = i === activeIndex ? '' : 'none'
        })
        pills.forEach((pill, i) => pill.classList.toggle('active', i === activeIndex))
      }

      const rebuildPills = (current: typeof node): void => {
        pillsRow.innerHTML = ''
        pills = []
        current.forEach((panel, _offset, index) => {
          const pill = document.createElement('button')
          pill.type = 'button'
          pill.className = 'tabs-pill'
          pill.contentEditable = 'false'
          pill.textContent = String(panel.attrs.label ?? `Tab ${index + 1}`)
          // mousedown, not click: prevents the editor's selection from
          // collapsing into the pill row (which isn't editable content)
          // before the click handler below gets to run.
          pill.addEventListener('mousedown', (event) => event.preventDefault())
          pill.addEventListener('click', () => setActive(index))
          pillsRow.appendChild(pill)
          pills.push(pill)
        })
        if (activeIndex >= current.childCount) activeIndex = Math.max(0, current.childCount - 1)
        setActive(activeIndex)
      }

      rebuildPills(node)

      return {
        dom,
        contentDOM,
        update(updatedNode) {
          if (updatedNode.type.name !== 'tabs') return false
          const labels: string[] = []
          updatedNode.forEach((panel) => labels.push(String(panel.attrs.label ?? '')))
          const currentLabels = pills.map((pill) => pill.textContent ?? '')
          const sameShape =
            labels.length === currentLabels.length &&
            labels.every((label, i) => label === currentLabels[i])
          if (!sameShape) rebuildPills(updatedNode)
          else if (activeIndex >= labels.length) setActive(Math.max(0, labels.length - 1))
          return true
        }
      }
    }
  },

  markdownTokenizer: {
    name: 'tabs',
    level: 'block' as const,
    start: (src: string) => src.indexOf(':::tabs'),
    tokenize(src: string) {
      const m = /^:::tabs\n([\s\S]*?)\n:::[ \t]*(?:\n|$)/.exec(src)
      if (!m) return undefined
      return { type: 'tabs', raw: m[0], body: m[1] }
    }
  },

  parseMarkdown(rawToken: MarkdownToken, helpers: MarkdownParseHelpers) {
    const token = rawToken as MarkdownToken & CustomToken
    const body = token.body ?? ''
    const rawParts = body.split(/\n?:::tab /).filter((part) => part.length > 0)
    const panels: JSONContent[] = rawParts.map((part) => {
      const nl = part.indexOf('\n')
      const label = (nl === -1 ? part : part.slice(0, nl)).trim() || 'Tab'
      const text = nl === -1 ? '' : part.slice(nl + 1)
      return { type: 'tabPanel', attrs: { label }, content: toInlineContent(text, helpers) }
    })
    return {
      type: 'tabs',
      content:
        panels.length > 0 ? panels : [{ type: 'tabPanel', attrs: { label: 'Tab 1' }, content: [] }]
    }
  },

  renderMarkdown(node: { content?: JSONContent[] }, helpers: MarkdownRendererHelpers) {
    const panels = node.content ?? []
    const body = panels
      .map((panel) => {
        const label = panel.attrs?.label ?? 'Tab'
        const text =
          panel.content && panel.content.length > 0 ? helpers.renderChildren(panel.content) : ''
        return `:::tab ${label}\n${text}`
      })
      .join('\n')
    return `:::tabs\n${body}\n:::`
  }
})
