import { Node, mergeAttributes } from '@tiptap/core'
import type { MarkdownToken } from '@tiptap/core'

/** Fields our own tokenizer adds; MarkdownToken itself is marked's shape. */
interface CustomToken {
  config?: string
}

interface StatCardItem {
  label: string
  value: string
}

/**
 * Defensive JSON parse for the node's raw `config` attribute, mirroring
 * `Chart`'s `parseChartConfig` — never throws, so a malformed edit only ever
 * degrades the NodeView's rendering, not markdown parsing.
 */
function parseStatCards(raw: string): StatCardItem[] | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return null
    return parsed.map((item) => {
      const record = (item ?? {}) as { label?: unknown; value?: unknown }
      return {
        label: typeof record.label === 'string' ? record.label : String(record.label ?? ''),
        value: typeof record.value === 'string' ? record.value : String(record.value ?? '')
      }
    })
  } catch {
    return null
  }
}

function renderStatCards(dom: HTMLElement, raw: string): void {
  const items = parseStatCards(raw)
  if (!items) {
    dom.classList.add('block-config-error')
    dom.textContent = 'Invalid stat cards JSON'
    return
  }
  items.forEach((item) => {
    const card = document.createElement('div')
    card.className = 'stat-card'

    const value = document.createElement('div')
    value.className = 'stat-card-value'
    value.textContent = item.value

    const label = document.createElement('div')
    label.className = 'stat-card-label'
    label.textContent = item.label

    card.appendChild(value)
    card.appendChild(label)
    dom.appendChild(card)
  })
}

/**
 * ```stat-cards
 * [{"label":"Users","value":"1.2k"},{"label":"Revenue","value":"$42k"}]
 * ```
 *
 * Same edit model as `Chart`: an atom whose only state is the raw JSON
 * array text, kept verbatim through the schema/markdown layer and parsed
 * only defensively inside the NodeView.
 */
export const StatCards = Node.create({
  name: 'statCards',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return { config: { default: '' } }
  },

  parseHTML() {
    return [{ tag: 'div[data-stat-cards]' }]
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-stat-cards': String(node.attrs.config ?? ''),
        class: 'stat-cards-block'
      })
    ]
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div')
      dom.className = 'stat-cards-block'
      const raw = String(node.attrs.config ?? '')
      dom.setAttribute('data-stat-cards', raw)
      renderStatCards(dom, raw)
      return { dom }
    }
  },

  renderText({ node }) {
    return `\`\`\`stat-cards\n${node.attrs.config ?? ''}\n\`\`\``
  },

  markdownTokenizer: {
    name: 'statCards',
    level: 'block' as const,
    start: (src: string) => src.search(/^```stat-cards\n/m),
    tokenize(src: string) {
      const m = /^```stat-cards\n([\s\S]*?)\n```[ \t]*(?:\n|$)/.exec(src)
      if (!m) return undefined
      return { type: 'statCards', raw: m[0], config: m[1] }
    }
  },

  parseMarkdown(rawToken: MarkdownToken) {
    const token = rawToken as MarkdownToken & CustomToken
    return { type: 'statCards', attrs: { config: token.config ?? '' } }
  },

  renderMarkdown(node: { attrs?: { config?: string } }) {
    return `\`\`\`stat-cards\n${node.attrs?.config ?? ''}\n\`\`\``
  }
})
