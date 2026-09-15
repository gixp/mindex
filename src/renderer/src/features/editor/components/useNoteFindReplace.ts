import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import {
  clearSearchHighlight,
  setSearchCurrentIndex,
  setSearchQuery
} from './extensions/SearchHighlight'
import type { TextRange } from '@/features/editor/lib/doc-text'
import type { FindReplaceController } from './FindReplaceBar'

/**
 * Find/replace for the TipTap note editor. Matches are recomputed against the
 * live document on every query/case-sensitivity change and after every
 * replace — there is no incremental match-tracking through edits, which is
 * the same trade-off `CommentHighlight` already makes for the same reason:
 * a stale range surviving an edit is a worse bug than a cheap full re-scan.
 */
export function useNoteFindReplace(
  editor: Editor | null,
  open: boolean,
  onClose: () => void
): FindReplaceController {
  const [query, setQueryState] = useState('')
  const [replaceOpen, setReplaceOpen] = useState(false)
  const [replaceText, setReplaceText] = useState('')
  const [caseSensitive, setCaseSensitiveState] = useState(false)
  const rangesRef = useRef<TextRange[]>([])
  const [matchCount, setMatchCount] = useState(0)
  const [currentIndex, setCurrentIndex] = useState(-1)

  const rescan = useCallback(
    (q: string, cs: boolean, preferredIndex = 0) => {
      if (!editor) return
      // -1 first: the decoration builder only needs a real index once one is
      // known, and computing it requires the ranges this same call produces.
      const ranges = setSearchQuery(editor.view, q, cs, -1)
      rangesRef.current = ranges
      const nextIndex = ranges.length === 0 ? -1 : Math.min(preferredIndex, ranges.length - 1)
      setCurrentIndex(nextIndex)
      setMatchCount(ranges.length)
      if (nextIndex >= 0) {
        setSearchCurrentIndex(editor.view, ranges, nextIndex)
        scrollToRange(editor, ranges[nextIndex]!)
      }
    },
    [editor]
  )

  // Re-open resets to a clean slate; closing tears the highlight down so a
  // stale amber mark never survives past the bar that produced it.
  useEffect(() => {
    if (!editor) return
    if (!open) {
      clearSearchHighlight(editor.view)
      return
    }
    rescan(query, caseSensitive, 0)
    // Only re-run on open/editor identity — query/caseSensitive changes are
    // driven by their own setters below, not by this effect re-firing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, open])

  const setQuery = useCallback(
    (q: string) => {
      setQueryState(q)
      rescan(q, caseSensitive, 0)
    },
    [rescan, caseSensitive]
  )

  const setCaseSensitive = useCallback(
    (v: boolean) => {
      setCaseSensitiveState(v)
      rescan(query, v, 0)
    },
    [rescan, query]
  )

  const next = useCallback(() => {
    if (!editor || rangesRef.current.length === 0) return
    const nextIndex = (currentIndex + 1) % rangesRef.current.length
    setCurrentIndex(nextIndex)
    setSearchCurrentIndex(editor.view, rangesRef.current, nextIndex)
    scrollToRange(editor, rangesRef.current[nextIndex]!)
  }, [editor, currentIndex])

  const prev = useCallback(() => {
    if (!editor || rangesRef.current.length === 0) return
    const nextIndex = (currentIndex - 1 + rangesRef.current.length) % rangesRef.current.length
    setCurrentIndex(nextIndex)
    setSearchCurrentIndex(editor.view, rangesRef.current, nextIndex)
    scrollToRange(editor, rangesRef.current[nextIndex]!)
  }, [editor, currentIndex])

  const replaceOne = useCallback(() => {
    if (!editor || currentIndex < 0) return
    const range = rangesRef.current[currentIndex]
    if (!range) return
    editor.chain().focus().insertContentAt({ from: range.from, to: range.to }, replaceText).run()
    // The replacement text almost never still matches the query (that is the
    // point of replacing it), so a plain re-scan naturally lands on what was
    // the next match — no special-casing needed for "skip what I just fixed".
    rescan(query, caseSensitive, currentIndex)
  }, [editor, currentIndex, replaceText, query, caseSensitive, rescan])

  const replaceAll = useCallback(() => {
    if (!editor || rangesRef.current.length === 0) return
    const { state } = editor
    const tr = state.tr
    // Back to front: replacing later ranges first means earlier ones are
    // still at the positions this array already has, no position-mapping
    // needed for the ones still to come.
    for (let i = rangesRef.current.length - 1; i >= 0; i--) {
      const r = rangesRef.current[i]!
      tr.insertText(replaceText, r.from, r.to)
    }
    editor.view.dispatch(tr)
    editor.commands.focus()
    rescan(query, caseSensitive, 0)
  }, [editor, replaceText, query, caseSensitive, rescan])

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
    replaceAll,
    close
  }
}

function scrollToRange(editor: Editor, range: TextRange): void {
  try {
    const coords = editor.view.coordsAtPos(range.from)
    const dom = editor.view.dom
    const rect = dom.getBoundingClientRect()
    if (coords.top < rect.top || coords.bottom > rect.bottom) {
      const el = editor.view.domAtPos(range.from).node as Node
      const target = el instanceof HTMLElement ? el : el.parentElement
      target?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  } catch {
    // Coordinate lookup can fail for a position mid-transaction; the
    // highlight itself is still correct, only the scroll is skipped.
  }
}
