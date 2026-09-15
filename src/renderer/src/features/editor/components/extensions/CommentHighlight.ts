import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorView } from '@tiptap/pm/view'
import { findQuoteRanges } from '@/features/editor/lib/doc-text'

export interface CommentHighlightSpec {
  id: string
  quote: string
  /** Which match of `quote` this comment owns. */
  occurrence: number
}

/** The passage being commented on right now, before the comment exists. */
export interface PendingHighlight {
  quote: string
  occurrence: number
}

interface HighlightState {
  specs: CommentHighlightSpec[]
  pending: PendingHighlight | null
  /** Drawn stronger than the rest, so clicking a thread shows you where it is. */
  focusedId: string | null
}

const EMPTY: HighlightState = { specs: [], pending: null, focusedId: null }

const commentHighlightKey = new PluginKey<HighlightState>('mindex:commentHighlight')

/**
 * Underlines the passages that carry comments, plus the one currently being
 * commented on.
 *
 * Decorations rather than marks on purpose: a mark would be part of the
 * document, which means it would be serialised into the user's markdown. The
 * whole point of comments here is that the note on disk stays exactly the note
 * they wrote — the comments live beside it, in `.mindex/comments/`.
 */
export const CommentHighlight = Extension.create({
  name: 'commentHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin<HighlightState>({
        key: commentHighlightKey,
        state: {
          init: () => EMPTY,
          apply: (tr, value) => (tr.getMeta(commentHighlightKey) as HighlightState) ?? value
        },
        props: {
          decorations(state) {
            const { specs, pending, focusedId } = commentHighlightKey.getState(state) ?? EMPTY
            if (specs.length === 0 && !pending) return DecorationSet.empty
            try {
              return build(state, specs, pending, focusedId)
            } catch (err) {
              // Highlights are a garnish; the editor is not. A bad range must
              // not be able to break typing, clicking or coordinate lookups.
              console.error('[mindex] comment highlight failed', err)
              return DecorationSet.empty
            }
          }
        }
      })
    ]
  }
})

function build(
  state: EditorState,
  specs: CommentHighlightSpec[],
  pending: PendingHighlight | null,
  focusedId: string | null
): DecorationSet {
  {
    const decorations: Decoration[] = []
    for (const spec of specs) {
      // Its own copy of the phrase, not every copy: highlighting them
      // all made two comments on the same words indistinguishable, and
      // lit up sentences nobody had commented on.
      const ranges = findQuoteRanges(state.doc, spec.quote)
      const range = ranges[spec.occurrence] ?? ranges[0]
      if (!range) continue
      decorations.push(
        Decoration.inline(range.from, range.to, {
          class: spec.id === focusedId ? 'comment-mark comment-mark-focused' : 'comment-mark',
          'data-comment-id': spec.id
        })
      )
    }
    if (pending) {
      const ranges = findQuoteRanges(state.doc, pending.quote)
      const range = ranges[pending.occurrence] ?? ranges[0]
      if (range) {
        decorations.push(Decoration.inline(range.from, range.to, { class: 'comment-mark-pending' }))
      }
    }
    return DecorationSet.create(state.doc, decorations)
  }
}

/**
 * Pushed in from outside rather than read from a store inside the plugin:
 * decorations only recompute when a transaction runs, so the update has to
 * arrive as one.
 */
export function setCommentHighlights(
  view: EditorView,
  specs: CommentHighlightSpec[],
  pending: PendingHighlight | null,
  focusedId: string | null
): void {
  view.dispatch(view.state.tr.setMeta(commentHighlightKey, { specs, pending, focusedId }))
}
