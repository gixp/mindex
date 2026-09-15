import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { calloutMeta } from '@/platform/markdown/markdown'

const MARKER_RE = /^\[!(\w+)\]\s*(.*)$/

/**
 * Draws `> [!tip] Title` blockquotes as the same colored callout box the
 * read-only MarkdownPreview renderer already has, without a custom node type.
 *
 * The blockquote stays a plain, generically-round-tripped `blockquote` node
 * in the schema — only its *view* changes, via decorations: the marker
 * paragraph (`[!tip] Title`, isolated onto its own paragraph beforehand by
 * `isolateCalloutMarkerLines`, see lib/markdown.ts) is hidden and replaced
 * with a real title bar; the blockquote itself gets `.callout` classes. That
 * keeps markdown parsing/serialisation completely untouched — the one thing
 * this codebase is most careful never to regress (see noteExtensions' own
 * comment on `scripts/md-roundtrip.mjs`).
 */
function buildDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'blockquote') return
    const marker = node.firstChild
    if (!marker || marker.type.name !== 'paragraph') return
    const match = MARKER_RE.exec(marker.textContent)
    if (!match) return
    const meta = calloutMeta(match[1] ?? '')
    const title = (match[2] ?? '').trim() || meta.title

    decorations.push(
      Decoration.node(pos, pos + node.nodeSize, {
        class: `callout callout-${meta.kind}`
      })
    )

    const markerPos = pos + 1
    decorations.push(
      Decoration.node(markerPos, markerPos + marker.nodeSize, {
        class: 'callout-marker-line'
      })
    )
    decorations.push(
      Decoration.widget(
        markerPos,
        () => {
          const bar = document.createElement('div')
          bar.className = 'callout-title'
          const icon = document.createElement('i')
          icon.className = `codicon codicon-${meta.icon} ${meta.tint}`
          const label = document.createElement('span')
          label.textContent = title
          bar.append(icon, label)
          return bar
        },
        { side: -1 }
      )
    )
  })
  return DecorationSet.create(doc, decorations)
}

export const Callout = Extension.create({
  name: 'calloutDecorations',

  addProseMirrorPlugins() {
    const key = new PluginKey('calloutDecorations')
    return [
      new Plugin({
        key,
        state: {
          init: (_, { doc }) => buildDecorations(doc),
          apply: (tr, old) => (tr.docChanged ? buildDecorations(tr.doc) : old)
        },
        props: {
          decorations(state) {
            return key.getState(state)
          }
        }
      })
    ]
  }
})
