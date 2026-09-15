import { Node, mergeAttributes } from '@tiptap/core'
import type { MarkdownToken } from '@tiptap/core'

/** Fields our own tokenizers add; MarkdownToken itself is marked's shape. */
interface CustomToken {
  src?: string
}

/**
 * `<video controls src="...">...</video>` — a video dropped or picked into
 * the note, saved into the vault's asset store by `saveVaultAsset` and
 * referenced by its relative path, the same convention `Wikilink` and the
 * built-in `Image` node use for portability across machines.
 *
 * A block atom rather than inline: a video is a standalone attachment, not a
 * word inside a sentence, and `insertContent` already knows how to lift a
 * block-group atom out of the current paragraph (proven by `Image`, which
 * this mirrors). The markdown form is literal `<video>` HTML rather than a
 * bespoke syntax — `@tiptap/markdown`'s raw-HTML tag whitelist already
 * tolerates `video`, and `lib/insert-file.ts`'s `fileToVideoMarkdown` already
 * emits exactly this shape, so this node's tokenizer/renderer just has to
 * agree with it.
 *
 * Needs a real `<video>` element to attach `controls`/playback to, not
 * something `renderHTML`'s static array can express — same reasoning as
 * `Math.ts`'s NodeView.
 */
export const Video = Node.create({
  name: 'video',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return { src: { default: '' } }
  },

  parseHTML() {
    return [
      {
        tag: 'video[src]',
        getAttrs: (el) => ({ src: (el as HTMLElement).getAttribute('src') ?? '' })
      }
    ]
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'video',
      mergeAttributes(HTMLAttributes, {
        src: String(node.attrs.src ?? ''),
        controls: 'true',
        class: 'video-embed'
      })
    ]
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('video')
      dom.controls = true
      dom.className = 'video-embed'
      dom.src = String(node.attrs.src ?? '')
      return { dom }
    }
  },

  renderText({ node }) {
    return `<video controls src="${node.attrs.src ?? ''}"></video>`
  },

  markdownTokenizer: {
    name: 'video',
    level: 'block' as const,
    start: (src: string) => src.search(/^<video\b/m),
    tokenize(src: string) {
      const m = /^<video\b[^>]*\bsrc="([^"]*)"[^>]*>[\s\S]*?<\/video>[ \t]*(?:\n|$)/.exec(src)
      if (!m) return undefined
      return { type: 'video', raw: m[0], src: m[1] }
    }
  },

  parseMarkdown(rawToken: MarkdownToken) {
    const token = rawToken as MarkdownToken & CustomToken
    return { type: 'video', attrs: { src: token.src ?? '' } }
  },

  renderMarkdown(node: { attrs?: { src?: string } }) {
    return `<video controls src="${node.attrs?.src ?? ''}"></video>`
  }
})

/**
 * `<audio controls src="...">...</audio>` — same shape and reasoning as
 * `Video` above, for `fileToAudioMarkdown`'s output.
 */
export const Audio = Node.create({
  name: 'audio',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return { src: { default: '' } }
  },

  parseHTML() {
    return [
      {
        tag: 'audio[src]',
        getAttrs: (el) => ({ src: (el as HTMLElement).getAttribute('src') ?? '' })
      }
    ]
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'audio',
      mergeAttributes(HTMLAttributes, {
        src: String(node.attrs.src ?? ''),
        controls: 'true',
        class: 'audio-embed'
      })
    ]
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('audio')
      dom.controls = true
      dom.className = 'audio-embed'
      dom.src = String(node.attrs.src ?? '')
      return { dom }
    }
  },

  renderText({ node }) {
    return `<audio controls src="${node.attrs.src ?? ''}"></audio>`
  },

  markdownTokenizer: {
    name: 'audio',
    level: 'block' as const,
    start: (src: string) => src.search(/^<audio\b/m),
    tokenize(src: string) {
      const m = /^<audio\b[^>]*\bsrc="([^"]*)"[^>]*>[\s\S]*?<\/audio>[ \t]*(?:\n|$)/.exec(src)
      if (!m) return undefined
      return { type: 'audio', raw: m[0], src: m[1] }
    }
  },

  parseMarkdown(rawToken: MarkdownToken) {
    const token = rawToken as MarkdownToken & CustomToken
    return { type: 'audio', attrs: { src: token.src ?? '' } }
  },

  renderMarkdown(node: { attrs?: { src?: string } }) {
    return `<audio controls src="${node.attrs?.src ?? ''}"></audio>`
  }
})
