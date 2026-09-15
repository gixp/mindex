import { useCallback, useEffect, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import type { EditorState } from '@codemirror/state'
import {
  SearchQuery,
  setSearchQuery,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll
} from '@codemirror/search'
import type { FindReplaceController } from './FindReplaceBar'

interface MatchRange {
  from: number
  to: number
}

function collectMatches(state: EditorState, query: SearchQuery): MatchRange[] {
  if (!query.valid) return []
  const out: MatchRange[] = []
  const cursor = query.getCursor(state)
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    out.push({ from: next.value.from, to: next.value.to })
  }
  return out
}

function indexOfSelection(state: EditorState, matches: MatchRange[]): number {
  const sel = state.selection.main
  return matches.findIndex((m) => m.from === sel.from && m.to === sel.to)
}

/**
 * Find/replace for the CodeMirror source editor — a thin controller over
 * `@codemirror/search`'s own programmatic API rather than its default panel
 * widget, so the source and note editors share the exact same
 * `FindReplaceBar` UI instead of the raw markdown surface looking like a
 * different app from the WYSIWYG one.
 *
 * Setting the query is enough to light up matches: `search()` (already in
 * `SourceEditor`'s extension list) draws its own highlight decorations off
 * live search state, with no separate call needed to make them appear.
 */
export function useSourceFindReplace(
  view: EditorView | null,
  open: boolean,
  onClose: () => void
): FindReplaceController {
  const [query, setQueryState] = useState('')
  const [replaceOpen, setReplaceOpen] = useState(false)
  const [replaceText, setReplaceTextState] = useState('')
  const [caseSensitive, setCaseSensitiveState] = useState(false)
  const [matchCount, setMatchCount] = useState(0)
  const [currentIndex, setCurrentIndex] = useState(-1)

  const dispatchQuery = useCallback(
    (q: string, replace: string, cs: boolean) => {
      if (!view) return
      const sq = new SearchQuery({ search: q, replace, caseSensitive: cs })
      view.dispatch({ effects: setSearchQuery.of(sq) })
      const matches = collectMatches(view.state, sq)
      setMatchCount(matches.length)
      setCurrentIndex(indexOfSelection(view.state, matches))
    },
    [view]
  )

  useEffect(() => {
    if (!view) return
    if (!open) {
      dispatchQuery('', '', caseSensitive)
      return
    }
    dispatchQuery(query, replaceText, caseSensitive)
    // Only re-run on open/view identity — the setters below own re-dispatch
    // for actual value changes, same split as the note editor's hook.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, open])

  const setQuery = useCallback(
    (q: string) => {
      setQueryState(q)
      dispatchQuery(q, replaceText, caseSensitive)
    },
    [dispatchQuery, replaceText, caseSensitive]
  )

  const setReplaceText = useCallback(
    (t: string) => {
      setReplaceTextState(t)
      dispatchQuery(query, t, caseSensitive)
    },
    [dispatchQuery, query, caseSensitive]
  )

  const setCaseSensitive = useCallback(
    (v: boolean) => {
      setCaseSensitiveState(v)
      dispatchQuery(query, replaceText, v)
    },
    [dispatchQuery, query, replaceText]
  )

  const refreshAfter = useCallback(
    (ran: boolean) => {
      if (!view || !ran) return
      const sq = new SearchQuery({ search: query, replace: replaceText, caseSensitive })
      const matches = collectMatches(view.state, sq)
      setMatchCount(matches.length)
      setCurrentIndex(indexOfSelection(view.state, matches))
    },
    [view, query, replaceText, caseSensitive]
  )

  const next = useCallback(() => {
    if (!view) return
    refreshAfter(findNext(view))
    view.focus()
  }, [view, refreshAfter])

  const prev = useCallback(() => {
    if (!view) return
    refreshAfter(findPrevious(view))
    view.focus()
  }, [view, refreshAfter])

  const replaceOne = useCallback(() => {
    if (!view) return
    refreshAfter(replaceNext(view))
    view.focus()
  }, [view, refreshAfter])

  const replaceAllMatches = useCallback(() => {
    if (!view) return
    refreshAfter(replaceAll(view))
    view.focus()
  }, [view, refreshAfter])

  const close = useCallback(() => {
    onClose()
  }, [onClose])

  return {
    query,
    setQuery,
    replaceOpen,
    setReplaceOpen,
    replaceText,
    setReplaceText,
    caseSensitive,
    setCaseSensitive,
    currentIndex,
    matchCount,
    next,
    prev,
    replaceOne,
    replaceAll: replaceAllMatches,
    close
  }
}
