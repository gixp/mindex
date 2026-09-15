import { Node, mergeAttributes } from '@tiptap/core'
import type { MarkdownToken } from '@tiptap/core'

/** Fields our own tokenizer adds; MarkdownToken itself is marked's shape. */
interface CustomToken {
  config?: string
}

interface ParsedChartConfig {
  type: string
  labels: string[]
  values: number[]
}

/**
 * Defensive JSON parse for the node's raw `config` attribute. Never throws —
 * a malformed edit (mid-typing, or hand-edited markdown) must render a
 * fallback in the NodeView, not break parsing/round-tripping, which is why
 * this parsing happens here rather than in `parseMarkdown`.
 */
function parseChartConfig(raw: string): ParsedChartConfig | null {
  try {
    const parsed = JSON.parse(raw) as { type?: unknown; labels?: unknown; values?: unknown }
    const labels = Array.isArray(parsed.labels) ? parsed.labels.map((l) => String(l)) : []
    const values = Array.isArray(parsed.values)
      ? parsed.values.map((v) => {
          const n = Number(v)
          return Number.isFinite(n) ? n : 0
        })
      : []
    const type = typeof parsed.type === 'string' ? parsed.type : 'bar'
    return { type, labels, values }
  } catch {
    return null
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg'

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {}
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag) as SVGElementTagNameMap[K]
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value))
  return el
}

function renderBarChart(container: HTMLElement, labels: string[], values: number[]): void {
  const width = 320
  const height = 140
  const padding = 24
  const gap = 8
  const n = Math.max(values.length, 1)
  const barWidth = Math.max((width - padding * 2 - gap * (n - 1)) / n, 4)
  const max = Math.max(...values, 1)

  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height + 20}`,
    width: '100%',
    height: 'auto',
    class: 'chart-svg'
  })

  values.forEach((v, i) => {
    const barHeight = Math.max((Math.max(v, 0) / max) * (height - padding), 1)
    const x = padding + i * (barWidth + gap)
    const y = height - barHeight

    svg.appendChild(
      svgEl('rect', {
        x,
        y,
        width: barWidth,
        height: barHeight,
        rx: 3,
        fill: 'hsl(var(--accent2))'
      })
    )

    const valueLabel = svgEl('text', {
      x: x + barWidth / 2,
      y: y - 4,
      'text-anchor': 'middle',
      'font-size': 10,
      fill: 'hsl(var(--foreground))'
    })
    valueLabel.textContent = String(v)
    svg.appendChild(valueLabel)

    const label = svgEl('text', {
      x: x + barWidth / 2,
      y: height + 14,
      'text-anchor': 'middle',
      'font-size': 10,
      fill: 'hsl(var(--muted-foreground))'
    })
    label.textContent = labels[i] ?? ''
    svg.appendChild(label)
  })

  container.appendChild(svg)
}

function renderLineChart(container: HTMLElement, labels: string[], values: number[]): void {
  const width = 320
  const height = 140
  const padding = 24
  const n = values.length
  if (n === 0) {
    container.textContent = 'No data'
    return
  }
  const max = Math.max(...values, 0)
  const min = Math.min(...values, 0)
  const range = max - min || 1
  const stepX = n > 1 ? (width - padding * 2) / (n - 1) : 0

  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height + 20}`,
    width: '100%',
    height: 'auto',
    class: 'chart-svg'
  })

  const points = values.map((v, i) => ({
    x: padding + i * stepX,
    y: height - padding - ((v - min) / range) * (height - padding * 2)
  }))

  svg.appendChild(
    svgEl('polyline', {
      points: points.map((p) => `${p.x},${p.y}`).join(' '),
      fill: 'none',
      stroke: 'hsl(var(--accent2))',
      'stroke-width': 2
    })
  )

  points.forEach((p, i) => {
    svg.appendChild(svgEl('circle', { cx: p.x, cy: p.y, r: 3, fill: 'hsl(var(--accent2))' }))
    const label = svgEl('text', {
      x: p.x,
      y: height + 14,
      'text-anchor': 'middle',
      'font-size': 10,
      fill: 'hsl(var(--muted-foreground))'
    })
    label.textContent = labels[i] ?? ''
    svg.appendChild(label)
  })

  container.appendChild(svg)
}

function renderPieChart(container: HTMLElement, labels: string[], values: number[]): void {
  const size = 140
  const radius = 60
  const cx = radius + 4
  const cy = size / 2
  const total = values.reduce((sum, v) => sum + Math.max(v, 0), 0) || 1
  const n = Math.max(values.length, 1)

  const svg = svgEl('svg', {
    viewBox: `0 0 ${size + 130} ${size}`,
    width: '100%',
    height: 'auto',
    class: 'chart-svg'
  })

  let angle = -Math.PI / 2
  const legend = svgEl('g', {})

  values.forEach((v, i) => {
    const frac = Math.max(v, 0) / total
    const nextAngle = angle + frac * Math.PI * 2
    const x1 = cx + radius * Math.cos(angle)
    const y1 = cy + radius * Math.sin(angle)
    const x2 = cx + radius * Math.cos(nextAngle)
    const y2 = cy + radius * Math.sin(nextAngle)
    const largeArc = nextAngle - angle > Math.PI ? 1 : 0
    const d = `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`
    const opacity = (0.3 + (0.65 * (i + 1)) / n).toFixed(2)

    svg.appendChild(
      svgEl('path', {
        d,
        fill: 'hsl(var(--accent2))',
        'fill-opacity': opacity,
        stroke: 'hsl(var(--background))',
        'stroke-width': 1
      })
    )

    const y = 16 + i * 16
    legend.appendChild(
      svgEl('rect', {
        x: size + 14,
        y: y - 9,
        width: 9,
        height: 9,
        rx: 2,
        fill: 'hsl(var(--accent2))',
        'fill-opacity': opacity
      })
    )
    const text = svgEl('text', {
      x: size + 28,
      y,
      'font-size': 10,
      fill: 'hsl(var(--foreground))'
    })
    text.textContent = `${labels[i] ?? ''} (${v})`
    legend.appendChild(text)

    angle = nextAngle
  })

  svg.appendChild(legend)
  container.appendChild(svg)
}

function renderChart(dom: HTMLElement, raw: string): void {
  const parsed = parseChartConfig(raw)
  if (!parsed) {
    dom.classList.add('block-config-error')
    dom.textContent = 'Invalid chart JSON'
    return
  }
  if (parsed.type === 'bar') {
    renderBarChart(dom, parsed.labels, parsed.values)
  } else if (parsed.type === 'line') {
    renderLineChart(dom, parsed.labels, parsed.values)
  } else if (parsed.type === 'pie') {
    renderPieChart(dom, parsed.labels, parsed.values)
  } else {
    dom.classList.add('block-config-error')
    dom.textContent = `Chart type '${parsed.type}' not yet supported`
  }
}

/**
 * ```chart
 * {"type":"bar","labels":["Mon","Tue"],"values":[3,7]}
 * ```
 *
 * Same edit model as `BlockMath`: an atom whose only state is the raw JSON
 * text, delete + retype (or re-run the slash command) to change it. The raw
 * string is kept verbatim in the schema/markdown layer and parsed only
 * defensively inside the NodeView, so a malformed edit can never break the
 * round trip or throw during `parseMarkdown`.
 */
export const Chart = Node.create({
  name: 'chart',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return { config: { default: '' } }
  },

  parseHTML() {
    return [{ tag: 'div[data-chart]' }]
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-chart': String(node.attrs.config ?? ''),
        class: 'chart-block'
      })
    ]
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div')
      dom.className = 'chart-block'
      const raw = String(node.attrs.config ?? '')
      dom.setAttribute('data-chart', raw)
      renderChart(dom, raw)
      return { dom }
    }
  },

  renderText({ node }) {
    return `\`\`\`chart\n${node.attrs.config ?? ''}\n\`\`\``
  },

  markdownTokenizer: {
    name: 'chart',
    level: 'block' as const,
    start: (src: string) => src.search(/^```chart\n/m),
    tokenize(src: string) {
      const m = /^```chart\n([\s\S]*?)\n```[ \t]*(?:\n|$)/.exec(src)
      if (!m) return undefined
      return { type: 'chart', raw: m[0], config: m[1] }
    }
  },

  parseMarkdown(rawToken: MarkdownToken) {
    const token = rawToken as MarkdownToken & CustomToken
    return { type: 'chart', attrs: { config: token.config ?? '' } }
  },

  renderMarkdown(node: { attrs?: { config?: string } }) {
    return `\`\`\`chart\n${node.attrs?.config ?? ''}\n\`\`\``
  }
})
