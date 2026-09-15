import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorView } from '@tiptap/pm/view'

/**
 * The passage the assistant is working on, lit up where it sits.
 *
 * The alternative was a card in a corner saying a rewrite was running, and it
 * answered the wrong question: what a person wants to see is not *that*
 * something is happening but *to what*. A mark on the words themselves says
 * both at once, and it cannot be missed the way a panel in the far corner of a
 * large window can.
 *
 * A decoration, not a mark — the same reason comments and search matches are
 * decorations. A mark would become part of the document and be written into
 * the person's markdown; this exists only while the editor is showing it.
 */

interface ThinkingState {
  from: number
  to: number
  /** Which assistant is at work, so the colour can be its own. */
  provider: string
}

const key = new PluginKey<ThinkingState | null>('mindex:aiThinking')

export const AiThinking = Extension.create({
  name: 'aiThinking',

  addProseMirrorPlugins() {
    return [
      new Plugin<ThinkingState | null>({
        key,
        state: {
          init: () => null,
          apply: (tr, value) => {
            const meta = tr.getMeta(key) as ThinkingState | null | undefined
            if (meta !== undefined) return meta
            // The document can change under a running rewrite — the person
            // keeps typing elsewhere — so the range is carried through each
            // edit rather than being left pointing at stale offsets.
            if (!value || !tr.docChanged) return value
            const from = tr.mapping.map(value.from)
            const to = tr.mapping.map(value.to)
            return to > from ? { ...value, from, to } : null
          }
        },
        props: {
          decorations(state) {
            const value = key.getState(state)
            if (!value || value.to <= value.from) return DecorationSet.empty
            try {
              return DecorationSet.create(state.doc, [
                Decoration.inline(value.from, value.to, {
                  class: 'ai-thinking',
                  'data-provider': value.provider
                })
              ])
            } catch {
              // A range that no longer fits the document is not worth throwing
              // over; the rewrite it belongs to will finish or fail regardless.
              return DecorationSet.empty
            }
          }
        }
      })
    ]
  }
})

export function setAiThinking(
  view: EditorView,
  range: { from: number; to: number },
  provider: string
): void {
  view.dispatch(view.state.tr.setMeta(key, { ...range, provider }))
}

export function clearAiThinking(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(key, null))
}
