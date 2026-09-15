import { useEffect, useRef, useState } from 'react'
import { Compartment, EditorState } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import {
  EditorView,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { search } from '@codemirror/search'
import {
  HighlightStyle,
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  indentOnInput
} from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { useUiStore } from '@/platform/app-settings'
import { useEditorStore } from '@/features/editor/store'
import { fileToImageMarkdown, imageFilesFrom } from '@/features/editor/lib/insert-file'
import { FindReplaceBar } from './FindReplaceBar'
import { useSourceFindReplace } from './useSourceFindReplace'
import { CONTEXT_LENGTH, occurrenceAt } from '@shared/comments'
import { SelectionAssistant } from '@/features/ai/components/SelectionAssistant'
import { useAiProposalsStore } from '@/features/ai/store'
import { bodyOffset } from '@/features/editor/lib/bodyOffset'
import { sourcePolish } from '@/features/editor/lib/source-polish'
import { captureHistory, stateWithHistory } from '@/features/editor/lib/source-history'
import {
  captureFromSource,
  isCaretWorthy,
  resolveInSource,
  type BlockAnchor
} from '@/features/editor/lib/mode-switch-anchor'

const LINK_BLUE = 'rgb(96 165 250)' // tailwind accent-1
const linkHighlightStyle = HighlightStyle.define([
  { tag: t.link, color: LINK_BLUE, textDecoration: 'underline' },
  { tag: t.url, color: LINK_BLUE, textDecoration: 'underline' }
])

// Colours are CSS variables so the editor follows the app theme live (toggling
// the `.dark` class re-resolves them — no editor rebuild needed). The background
// is transparent so it inherits the themed container surface.
const baseTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'transparent',
    color: 'hsl(var(--foreground))'
  },
  '.cm-scroller': {
    fontFamily: '"JetBrains Mono", "Geist Mono", ui-monospace, Menlo, monospace',
    lineHeight: '1.55'
  },
  '.cm-content': {
    caretColor: 'hsl(var(--foreground))',
    padding: '12px 0'
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'hsl(var(--muted-foreground))',
    borderRight: '1px solid hsl(var(--border))',
    paddingRight: '6px'
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 14px',
    minWidth: '20px',
    textAlign: 'right'
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'hsl(var(--foreground) / 0.04)',
    color: 'hsl(var(--foreground) / 0.85)'
  },
  '.cm-activeLine': {
    backgroundColor: 'hsl(var(--foreground) / 0.035)'
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'hsl(var(--foreground))'
  },
  '&.cm-focused': {
    outline: 'none'
  },
  '&.cm-focused .cm-selectionBackground, ::selection, .cm-selectionBackground': {
    backgroundColor: 'hsl(var(--foreground) / 0.16)'
  },
  '.cm-selectionMatch': {
    backgroundColor: 'hsl(var(--foreground) / 0.1)'
  },
  // Find-in-note. Same amber `@codemirror/search` draws on its own decoration
  // classes, matching `.search-match`/`.search-match-current` in the note
  // editor (globals.css) so the two editing surfaces read as one feature.
  '.cm-searchMatch': {
    backgroundColor: 'rgb(251 191 36 / 0.35)',
    borderRadius: '2px'
  },
  '.cm-searchMatch-selected': {
    backgroundColor: 'rgb(251 191 36 / 0.75)'
  }
})

function fontSizeTheme(px: number) {
  return EditorView.theme({ '&': { fontSize: `${px}px` } })
}

interface Props {
  value: string
  onChange: (next: string) => void
  initialScrollPct?: number
  onScrollPct?: (pct: number) => void
  /**
   * Which block the caret is in, reported as it moves.
   *
   * Handed up so a switch to the rendered view can land where this one left
   * off. An anchor rather than an offset because the two views do not share a
   * coordinate system — see `lib/mode-switch-anchor.ts`.
   */
  onAnchor?: (anchor: BlockAnchor) => void
  /** Where the other view left off, to open on. */
  landingAnchor?: BlockAnchor | null
  /**
   * The undo history from the last time this buffer was in source mode.
   *
   * Flipping to the rendered view unmounts this editor, and an unmounted
   * CodeMirror takes its history with it — so a trip to preview and back left
   * you unable to undo anything you had typed before it. Handed out on
   * unmount and back in on mount, the stack survives the round trip.
   */
  historyState?: unknown
  onHistoryState?: (state: unknown) => void
  /**
   * Show the file without letting it be changed.
   *
   * For the files the editor opens but does not own — anything in the vault
   * that is not a note. Showing one is a small promise; editing it is a much
   * larger one, and half of that promise is worse than none because the missing
   * half is the half that loses work.
   */
  readOnly?: boolean
  /**
   * Extra CodeMirror extensions, applied once when the state is built.
   *
   * Used by the note type editor to colour `{{variables}}`. Passed in rather
   * than added here because a note is not a template: highlighting braces in
   * every open file would be wrong most of the time.
   */
  extraExtensions?: Extension[]
  /**
   * The note this buffer belongs to, when it is a note on disk.
   *
   * Present turns on the selection toolbar. Absent — the type editor, a skill
   * file — leaves it off, for the same reason the preview mode's toolbar hides
   * its own: a rewrite is anchored to a path inside the vault, and these have
   * none.
   */
  notePath?: string
}

export function SourceEditor({
  value,
  onChange,
  initialScrollPct = 0,
  onScrollPct,
  onAnchor,
  landingAnchor,
  historyState,
  onHistoryState,
  readOnly = false,
  extraExtensions,
  notePath
}: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  // Mirrors `viewRef` as state: the find/replace hook needs to re-render once
  // the view exists, which a ref alone never triggers.
  const [view, setView] = useState<EditorView | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  // Where the toolbar sits, or null when nothing is selected. Held as state
  // rather than read on render: the position comes from the editor's own
  // coordinate lookup, which only answers once the view exists.
  const [selAt, setSelAt] = useState<{ left: number; top: number } | null>(null)
  const [findFocusToken, setFindFocusToken] = useState(0)
  const fontSizeCompRef = useRef<Compartment>(new Compartment())
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onScrollPctRef = useRef(onScrollPct)
  onScrollPctRef.current = onScrollPct
  const onAnchorRef = useRef(onAnchor)
  onAnchorRef.current = onAnchor
  const onHistoryStateRef = useRef(onHistoryState)
  onHistoryStateRef.current = onHistoryState

  const lastEmittedRef = useRef(value)

  const editorFontSize = useUiStore((s) => s.editorFontSize)

  useEffect(() => {
    if (!containerRef.current) return

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.selectionSet || update.docChanged) {
        // Which block the caret sits in, kept current so a mode switch has
        // something to carry over. Computed from the document rather than
        // remembered, because an edit above the caret moves it.
        const head = update.state.selection.main.head
        const anchor = captureFromSource(update.state.doc.toString(), head)
        if (anchor) onAnchorRef.current?.(anchor)
      }
      if (update.selectionSet || update.docChanged || update.focusChanged) {
        const { from, to } = update.state.selection.main
        if (from === to) {
          setSelAt(null)
        } else {
          try {
            const start = update.view.coordsAtPos(from)
            // Screen coordinates, used as-is.
            //
            // These were measured against the editor's own content element and
            // then drawn inside the pane, which are two different origins the
            // moment the text is scrolled: the content element moves under the
            // scroller while the pane does not, so the toolbar was placed by
            // however far down the file the person had read — usually far
            // above the pane, where nothing is visible. `coordsAtPos` already
            // answers in screen coordinates, which is what a fixed element
            // wants, so there is nothing left to subtract.
            setSelAt(start ? { left: start.left, top: start.top - 38 } : null)
          } catch {
            setSelAt(null)
          }
        }
      }
      if (!update.docChanged) return
      const next = update.state.doc.toString()
      lastEmittedRef.current = next
      onChangeRef.current(next)
    })

    const bumpFontSize = (delta: number): boolean => {
      useUiStore.getState().bumpEditorFontSize(delta)
      return true
    }
    const resetFontSize = (): boolean => {
      useUiStore.getState().setEditorFontSize(13)
      return true
    }

    // Not Mod-=/Mod--/Mod-0: those accelerators are claimed at the native
    // Electron menu level for app-wide zoom (main/menu.ts's View menu) and
    // are matched before any renderer key handler — including this one —
    // ever runs, so the editor font size never actually changed.
    const fontSizeKeymap = keymap.of([
      { key: 'Mod-Shift-=', preventDefault: true, run: () => bumpFontSize(1) },
      { key: 'Mod-Shift-+', preventDefault: true, run: () => bumpFontSize(1) },
      { key: 'Mod-Shift--', preventDefault: true, run: () => bumpFontSize(-1) },
      { key: 'Mod-Shift-0', preventDefault: true, run: () => resetFontSize() }
    ])

    // Carries the undo stack from the last time this buffer was in source mode
    // — see lib/source-history.ts for why that needs a state rebuilt from JSON.
    const state = stateWithHistory(
      value,
      [
        ...(extraExtensions ?? []),
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        // Both, not just one: `readOnly` refuses edits, `editable` also stops
        // the caret and the editing affordances, so it reads as something being
        // shown rather than a field that silently swallows every keystroke.
        ...(readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
        // Hanging indents for wrapped lists, code and tables. Nothing in the
        // document changes — see lib/source-polish.ts.
        sourcePolish(),
        bracketMatching(),
        indentOnInput(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        syntaxHighlighting(linkHighlightStyle),
        // GFM, not bare CommonMark.
        //
        // `markdown()` on its own is CommonMark, which has no tables, no
        // strikethrough and no task lists — so none of them were in the syntax
        // tree, and none of them were highlighted or laid out. The rendered
        // view has parsed GFM all along (`remark-gfm`), so the two halves of
        // the editor disagreed about what the file even contained.
        markdown({ base: markdownLanguage }),
        EditorView.domEventHandlers({
          paste(event, view) {
            const imgs = imageFilesFrom(event.clipboardData)
            if (imgs.length === 0) return false
            event.preventDefault()
            void (async () => {
              const notePath = useEditorStore.getState().activePath
              for (const f of imgs) {
                const md = await fileToImageMarkdown(f, notePath)
                if (!md) continue
                const sel = view.state.selection.main
                view.dispatch({
                  changes: { from: sel.from, to: sel.to, insert: md },
                  selection: { anchor: sel.from + md.length }
                })
              }
            })()
            return true
          }
        }),
        EditorView.lineWrapping,
        fontSizeKeymap,
        // No `searchKeymap`/default panel — Cmd+F is handled by this
        // component's own listener below, driving the same `FindReplaceBar`
        // UI the note editor uses. `search()` alone is enough: it draws match
        // decorations off live search state regardless of whether its own
        // panel is ever opened.
        search(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        baseTheme,
        fontSizeCompRef.current.of(fontSizeTheme(useUiStore.getState().editorFontSize)),
        updateListener
      ],
      historyState
    )

    const view = new EditorView({ state, parent: containerRef.current })
    viewRef.current = view
    setView(view)
    lastEmittedRef.current = value

    const sc = view.scrollDOM
    // Land on the block the other view was in, when it handed one over.
    //
    // The scroll percentage below is the fallback, and it is only ever right
    // while both views are the same height — which they are not the moment a
    // note contains a table or a diagram. It is kept for the case where there
    // is no anchor at all: a file opened straight into source.
    const landing = landingAnchor ? resolveInSource(landingAnchor, value) : null
    if (landing) {
      requestAnimationFrame(() => {
        const point = Math.min(landing.point, view.state.doc.length)
        view.dispatch({
          // Only when the block was actually recognised. A guess at the
          // ordinal is worth scrolling to and not worth putting a caret in,
          // because a caret is an instruction about where typing goes.
          ...(isCaretWorthy(landing.confidence) ? { selection: { anchor: point } } : {}),
          effects: EditorView.scrollIntoView(point, { y: 'center' })
        })
        if (isCaretWorthy(landing.confidence)) view.focus()
      })
    } else if (initialScrollPct > 0) {
      requestAnimationFrame(() => {
        const max = sc.scrollHeight - sc.clientHeight
        if (max > 0) sc.scrollTop = initialScrollPct * max
      })
    }
    const onScroll = (): void => {
      const max = sc.scrollHeight - sc.clientHeight
      onScrollPctRef.current?.(max > 0 ? sc.scrollTop / max : 0)
    }
    sc.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      sc.removeEventListener('scroll', onScroll)
      // Hand the undo stack out before the view takes it with it. A flip to the
      // rendered view and back used to leave you unable to undo anything typed
      // before the trip.
      onHistoryStateRef.current?.(captureHistory(view.state))
      view.destroy()
      viewRef.current = null
      setView(null)
    }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: fontSizeCompRef.current.reconfigure(fontSizeTheme(editorFontSize))
    })
  }, [editorFontSize])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (lastEmittedRef.current === value) return
    const cur = view.state.doc.toString()
    if (cur === value) return
    view.dispatch({
      changes: { from: 0, to: cur.length, insert: value }
    })
    lastEmittedRef.current = value
  }, [value])

  const findReplace = useSourceFindReplace(view, findOpen, () => setFindOpen(false))

  // Scoped to `wrapperRef`, not `containerRef`: CM owns every child of
  // `containerRef` imperatively (`parent: containerRef.current` above), so
  // `FindReplaceBar` renders as a sibling of it instead — mixing React
  // children into a node CodeMirror also appends to directly is how the two
  // end up fighting over the same DOM node.
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'f') return
      if (!wrapperRef.current?.contains(e.target as Node)) return
      e.preventDefault()
      setFindOpen(true)
      setFindFocusToken((n) => n + 1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div ref={wrapperRef} className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {notePath && selAt ? (
        <div
          style={{ left: Math.max(4, selAt.left), top: Math.max(4, selAt.top) }}
          className="fixed z-dialog flex items-center rounded-r2 border border-bd-2 bg-bg-2 p-1 shadow-s2"
        >
          <SelectionAssistant
            getAnchor={() => {
              const view = viewRef.current
              if (!view) return null
              const { from, to } = view.state.selection.main
              if (from === to) return null
              const doc = view.state.doc.toString()

              // Source mode shows the frontmatter above the body, so an offset
              // here is not an offset into the note. A selection that starts
              // inside the frontmatter has no passage in the body to rewrite.
              const start = bodyOffset(doc)
              if (from < start) return null

              const body = doc.slice(start)
              return {
                exact: doc.slice(from, to),
                prefix: doc.slice(Math.max(start, from - CONTEXT_LENGTH), from),
                suffix: doc.slice(to, to + CONTEXT_LENGTH),
                // Counted within the body alone, which is the text the app
                // matches against — counting over the whole buffer would be
                // off by every copy that happens to sit in the frontmatter.
                occurrence: occurrenceAt(body, doc.slice(from, to), from - start)
              }
            }}
            onRun={(transformId, anchor) => {
              void useAiProposalsStore
                .getState()
                .requestTransform({ transformId, notePath, anchor })
            }}
          />
        </div>
      ) : null}
      {findOpen ? <FindReplaceBar controller={findReplace} focusToken={findFocusToken} /> : null}
    </div>
  )
}
