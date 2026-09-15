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
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'hsl(var(--muted-foreground))',
    border: 'none'
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
