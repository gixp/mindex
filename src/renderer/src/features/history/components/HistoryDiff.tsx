import { useEffect, useRef } from 'react'
import { MergeView } from '@codemirror/merge'
import { EditorView, lineNumbers } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent', color: 'hsl(var(--foreground))' },
  '.cm-scroller': {
    fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace',
    fontSize: '12px',
    lineHeight: '1.5'
  },
  /* The line between the two versions. The merge view lays its editors out
     side by side with nothing between them, so on one flat surface the old
     file's last column and the new file's line numbers read as one column of
     text. The right-hand editor carries it, since it is the one with a left
     edge to draw. */
  '&.cm-merge-b': {
    borderLeft: '1px solid hsl(var(--bd-2))'
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'hsl(var(--muted-foreground))',
    border: 'none'
  },
  /* The "N unchanged lines" band.
   *
   * The merge package ships one style for a light page and one for a dark page
   * and picks by the editor's own theme flag, which this view never sets — so a
   * near-white gradient was laid across a dark note. It gets the app's own
   * surface instead, which already knows which theme it is in, and flat rather
   * than a gradient: the gradient faded out top and bottom, which on this
   * background read as a smear rather than a control.
   *
   * The class is repeated to outweigh the package's own rule. Its light and
   * dark variants each carry two classes on the editor plus this one, and a
   * plain rule here carries one fewer and loses however it is ordered. `&light`
   * and `&dark` are not available to say it the other way round: those work
   * only in a base theme, and using them here threw on startup. */
  '.cm-collapsedLines.cm-collapsedLines.cm-collapsedLines': {
    background: 'hsl(var(--bg-3))',
    color: 'hsl(var(--c-2))',
    border: '1px solid hsl(var(--bd-2))',
    borderRadius: 'var(--r-4)',
    margin: '3px 0',
    padding: '4px 10px',
    fontSize: '11px'
  },
  '.cm-collapsedLines.cm-collapsedLines.cm-collapsedLines:hover': {
    background: 'hsl(var(--bg-4))',
    color: 'hsl(var(--c-1))'
  },
  /* The band is a control — clicking it opens the lines it is standing in for
     — and it said so with a pair of dotted marks that read as decoration. The
     app's own unfold mark says it instead, and says it once: the second mark
     at the far end was the same glyph a full row away from the click it
     describes. */
  '.cm-collapsedLines.cm-collapsedLines.cm-collapsedLines::before': {
    content: '"\\eb73"',
    fontFamily: 'codicon',
    fontSize: '13px',
    lineHeight: '1',
    marginInlineEnd: '8px',
    verticalAlign: '-2px'
  },
  '.cm-collapsedLines.cm-collapsedLines.cm-collapsedLines::after': {
    content: '""',
    marginInlineStart: '0'
  }
})

const readOnly = [
  lineNumbers(),
  markdown(),
  EditorView.lineWrapping,
  EditorView.editable.of(false),
  EditorState.readOnly.of(true),
  theme
]

interface HistoryDiffProps {
  oldText: string
  newText: string
}

export function HistoryDiff({ oldText, newText }: HistoryDiffProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const view = new MergeView({
      a: { doc: oldText, extensions: readOnly },
      b: { doc: newText, extensions: readOnly },
      parent: containerRef.current,
      gutter: true,
      highlightChanges: true,
      collapseUnchanged: { margin: 3, minSize: 6 }
    })
    return () => view.destroy()
  }, [oldText, newText])

  return <div ref={containerRef} className="h-full w-full overflow-auto" />
}
