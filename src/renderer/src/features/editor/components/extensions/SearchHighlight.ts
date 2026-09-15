import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorView } from '@tiptap/pm/view'
import { findQuoteRanges, type TextRange } from '@/features/editor/lib/doc-text'

interface SearchState {
  ranges: TextRange[]
  currentIndex: number
}

const EMPTY: SearchState = { ranges: [], currentIndex: -1 }

const searchHighlightKey = new PluginKey<SearchState>('mindex:searchHighlight')

/**
 * Highlights every match of the find-in-note query, with the current one
 * drawn stronger — same shape as `CommentHighlight`, decorations rather than
 * marks for the same reason: a match is never something that belongs in the
 * saved markdown.
 */
export const SearchHighlight = Extension.create({
  name: 'searchHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: searchHighlightKey,
        state: {
          init: () => EMPTY,
          apply: (tr, value) => (tr.getMeta(searchHighlightKey) as SearchState) ?? value
        },
        props: {
          decorations(state) {
            const { ranges, currentIndex } = searchHighlightKey.getState(state) ?? EMPTY
            if (ranges.length === 0) return DecorationSet.empty
            try {
              return build(state, ranges, currentIndex)
            } catch (err) {
              console.error('[mindex] search highlight failed', err)
              return DecorationSet.empty
            }
          }
        }
      })
    ]
  }
})

function build(state: EditorState, ranges: TextRange[], currentIndex: number): DecorationSet {
  const decorations = ranges.map((range, i) =>
    Decoration.inline(range.from, range.to, {
      class: i === currentIndex ? 'search-match search-match-current' : 'search-match'
    })
  )
  return DecorationSet.create(state.doc, decorations)
}

/** Recomputes every match for `query` against the live document and pushes the result in. */
export function setSearchQuery(
  view: EditorView,
  query: string,
  caseSensitive: boolean,
  currentIndex: number
): TextRange[] {
  const ranges = query ? findQuoteRanges(view.state.doc, query, { caseSensitive }) : []
  view.dispatch(view.state.tr.setMeta(searchHighlightKey, { ranges, currentIndex }))
  return ranges
}

/** Moves the "current match" pointer without re-searching — used by next/previous. */
export function setSearchCurrentIndex(
  view: EditorView,
  ranges: TextRange[],
  currentIndex: number
): void {
  view.dispatch(view.state.tr.setMeta(searchHighlightKey, { ranges, currentIndex }))
}

export function clearSearchHighlight(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(searchHighlightKey, EMPTY))
}
