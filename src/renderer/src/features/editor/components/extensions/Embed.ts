import { Node, mergeAttributes } from '@tiptap/core'
import type { MarkdownToken } from '@tiptap/core'

/** Fields our own tokenizer adds; MarkdownToken itself is marked's shape. */
interface CustomToken {
  src?: string
  provider?: string
}

function toUrl(raw: string): URL | null {
  try {
    return new URL(raw)
  } catch {
    try {
      return new URL(`https://${raw}`)
    } catch {
      return null
    }
  }
}

/**
 * Turns a normal share URL from a known provider into its embeddable iframe
 * URL. Returns `null` for anything unrecognised so callers can fall back to
 * a plain link instead of inserting a broken iframe.
 */
export function resolveEmbedUrl(url: string): { embedSrc: string; provider: string } | null {
  const parsed = toUrl(url)
  if (!parsed) return null
  const host = parsed.hostname.replace(/^www\./, '')

  if (host === 'youtube.com' || host === 'm.youtube.com') {
    const id = parsed.searchParams.get('v')
    return id ? { embedSrc: `https://www.youtube.com/embed/${id}`, provider: 'youtube' } : null
  }
  if (host === 'youtu.be') {
    const id = parsed.pathname.slice(1).split('/')[0]
    return id ? { embedSrc: `https://www.youtube.com/embed/${id}`, provider: 'youtube' } : null
  }
  if (host === 'vimeo.com') {
    const id = parsed.pathname.slice(1).split('/')[0]
    return id && /^\d+$/.test(id)
      ? { embedSrc: `https://player.vimeo.com/video/${id}`, provider: 'vimeo' }
      : null
  }
  if (host === 'codepen.io') {
    const m = /^\/([^/]+)\/pen\/([^/]+)/.exec(parsed.pathname)
    return m ? { embedSrc: `https://codepen.io/${m[1]}/embed/${m[2]}`, provider: 'codepen' } : null
  }
  if (host === 'figma.com') {
    if (!/^\/(file|design)\//.test(parsed.pathname)) return null
    return {
      embedSrc: `https://www.figma.com/embed?embed_host=mindex&url=${encodeURIComponent(url)}`,
      provider: 'figma'
    }
  }
  if (host === 'open.spotify.com') {
    const m = /^\/([^/]+)\/([^/]+)/.exec(parsed.pathname)
    return m
      ? { embedSrc: `https://open.spotify.com/embed/${m[1]}/${m[2]}`, provider: 'spotify' }
      : null
  }
  return null
}

/**
 * `<iframe src="…"></iframe>` — a resolved embed from a known provider
 * (YouTube, Vimeo, CodePen, Figma, Spotify…). Same atom edit model as the
 * rest of this pass: the src is the node's only state, delete + retype to
 * change it.
 *
 * The markdown form only needs `src` back; `provider` is cosmetic (drives
 * nothing but is handy for future provider-specific chrome), so a round
 * trip that can't confidently re-derive it just stores `'embed'`.
 */
export const Embed = Node.create({
  name: 'embed',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: '' },
      provider: { default: 'embed' }
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-embed-src]' }]
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-embed-src': String(node.attrs.src ?? ''),
        'data-embed-provider': String(node.attrs.provider ?? 'embed'),
        class: 'embed'
      }),
      [
        'iframe',
        {
          src: String(node.attrs.src ?? ''),
          class: 'embed-iframe',
          frameborder: '0',
          allowfullscreen: 'true'
        }
      ]
    ] as never
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div')
      dom.className = 'embed'
      dom.setAttribute('data-embed-src', String(node.attrs.src ?? ''))
      dom.setAttribute('data-embed-provider', String(node.attrs.provider ?? 'embed'))

      const iframe = document.createElement('iframe')
      iframe.className = 'embed-iframe'
      iframe.src = String(node.attrs.src ?? '')
      iframe.setAttribute('frameborder', '0')
      iframe.setAttribute('allowfullscreen', 'true')
      dom.appendChild(iframe)

      return { dom }
    }
  },

  renderText({ node }) {
    return String(node.attrs.src ?? '')
  },

  markdownTokenizer: {
    name: 'embed',
    level: 'block' as const,
    start: (src: string) => src.search(/^<iframe\b/m),
    tokenize(src: string) {
      const m = /^<iframe\b[^>]*\bsrc="([^"]*)"[^>]*>[\s\S]*?<\/iframe>[ \t]*(?:\n|$)/.exec(src)
      if (!m) return undefined
      const embedSrc = m[1] ?? ''
      const resolved = resolveEmbedUrl(embedSrc)
      return { type: 'embed', raw: m[0], src: embedSrc, provider: resolved?.provider ?? 'embed' }
    }
  },

  parseMarkdown(rawToken: MarkdownToken) {
    const token = rawToken as MarkdownToken & CustomToken
    return { type: 'embed', attrs: { src: token.src ?? '', provider: token.provider ?? 'embed' } }
  },

  renderMarkdown(node: { attrs?: { src?: string } }) {
    return `<iframe src="${node.attrs?.src ?? ''}"></iframe>`
  }
})
