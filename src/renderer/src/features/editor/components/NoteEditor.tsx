import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useEditor, EditorContent } from '@tiptap/react'
// v3 moved the menu components into their own entry point.
import { BubbleMenu } from '@tiptap/react/menus'
import { useUiStore } from '@/platform/app-settings'
import { useVaultStore } from '@/platform/workspace'
import { useEditorStore } from '@/features/editor/store'
import { documentPathOf } from '@/platform/documents'
import { makeImageResolver } from '@/platform/markdown/asset-url'
import { prepareBodyForEditor } from '@/platform/markdown/markdown'
import { handleWikilinkClick } from '@/platform/markdown/wikilink'
import { noteExtensions } from './extensions'
import { setCommentHighlights } from './extensions/CommentHighlight'
import { CommentComposer, type PendingComment, type ViewingComment } from './CommentComposer'
import { PANEL_SURFACE } from '@/ui/surfaces'
import { useCommentsStore } from '@/features/comments/store'
import { selectionQuote } from '@/features/editor/lib/doc-text'
import { SelectionAssistant } from '@/features/ai/components/SelectionAssistant'
import { setAiThinking, clearAiThinking } from '@/features/editor/components/extensions/AiThinking'
import {
  setAiSuggestion,
  clearAiSuggestion
} from '@/features/editor/components/extensions/AiSuggestion'
import { InlineSuggestionBar } from '@/features/ai/components/InlineSuggestionBar'
import { changedSpan } from '@/features/ai/lib/changedSpan'
import { useAiProposalsStore } from '@/features/ai/store'
import { CONTEXT_LENGTH } from '@shared/comments'
import { SlashMenu, type SlashState } from './SlashMenu'
import { WikilinkMenu, type WikilinkState } from './WikilinkMenu'
import { BlockHandles } from './BlockHandles'
import { FindReplaceBar } from './FindReplaceBar'
import { useNoteFindReplace } from './useNoteFindReplace'
import { LinkPopover, type LinkPopoverState } from './LinkPopover'
import { Icon } from '@/ui/icon'
import { cn } from '@/ui/cn'
import { pasteShiftHeld } from '@/features/editor/lib/paste-shift-latch'
import { loneUrl } from '@/features/editor/lib/lone-url'
import { pushToast } from '@/platform/notifications'
import { api } from '@/platform/api'
import type { FileEdit } from '@shared/ai'
import { setLinkRequestHandler } from '@/features/editor/lib/active-note-editor'
import { BlockTypeSelector } from './BlockTypeSelector'
import {
  captureFromDoc,
  isCaretWorthy,
  resolveInDoc,
  type BlockAnchor
} from '@/features/editor/lib/mode-switch-anchor'

interface Props {
  body: string
  onChange: (next: string) => void
  /**
   * Which block the caret is in, reported as it moves.
   *
   * Handed up so a switch to source can land where this view left off. An
   * anchor rather than a position because the two views do not share a
   * coordinate system — see `lib/mode-switch-anchor.ts`.
   */
  onAnchor?: (anchor: BlockAnchor) => void
  /** Where the source view left off, to open on. */
  landingAnchor?: BlockAnchor | null
}

/**
 * The Notion-style note editor: one continuous WYSIWYG surface, no modes
 * inside it, no double-click-to-reveal-Markdown. What you see is the
 * document, and typing edits it directly.
 *
 * Markdown is the storage format, not the editing surface — the document
 * lives as a ProseMirror tree and is serialised back on every change. That
 * makes serialiser fidelity a data-safety property rather than a nicety, so
 * `scripts/md-roundtrip.mjs` measures it against the whole vault. Wikilinks
 * and HTML comments have their own nodes for exactly that reason; without
 * them, saving deleted them (see extensions/).
 */
export function NoteEditor({ body, onChange, onAnchor, landingAnchor }: Props): JSX.Element {
  const onAnchorRef = useRef(onAnchor)
  onAnchorRef.current = onAnchor
  const activePath = useEditorStore((s) => s.activePath)
  const vault = useVaultStore((s) => s.vault)
  const editorFontSize = useUiStore((s) => s.editorFontSize)
  const commentThreads = useCommentsStore((s) => s.threads)
  const focusedCommentId = useCommentsStore((s) => s.focusedId)
  const loadComments = useCommentsStore((s) => s.loadFor)
  // Comments are keyed by the file, not by the tab: a skill file is opened
  // through a virtual path but is a real file underneath, so it gets them
  // too. A tab with no file behind it does not.
  const commentPath = documentPathOf(activePath)
  const [pendingComment, setPendingComment] = useState<PendingComment | null>(null)
  const [viewingComment, setViewingComment] = useState<ViewingComment | null>(null)

  // The Markdown this editor last produced or was seeded with. Guards the
  // feedback loop: body prop → setContent → onUpdate → onChange → body prop.
  // Without it, opening a note would immediately mark it dirty and autosave a
  // re-serialised copy of a file the user never touched.
  const lastMarkdown = useRef(body)
  const hostRef = useRef<HTMLDivElement>(null)
  const [slash, setSlash] = useState<SlashState | null>(null)
  const [wikilink, setWikilink] = useState<WikilinkState | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [linkPopover, setLinkPopover] = useState<LinkPopoverState | null>(null)
  // The suggestion currently on offer in this editor, and where its bar sits.
  // Held here rather than in the proposal store because both facts are about
  // this view of this note — a second view of the same note has its own
  // positions and must not inherit these.
  const [offer, setOffer] = useState<{ kind: string; edit: FileEdit } | null>(null)
  // Where the controls are drawn: a slot inside the suggestion itself, found
  // once it has been laid out. Held as state so the portal re-runs when the
  // suggestion is replaced rather than pointing at a node that is gone.
  const [actionSlot, setActionSlot] = useState<HTMLElement | null>(null)
  const [applyState, setApplyState] = useState<'ready' | 'applying' | 'applied'>('ready')
  const [findFocusToken, setFindFocusToken] = useState(0)
  const editor = useEditor(
    {
      extensions: noteExtensions(),
      content: prepareBodyForEditor(body),
      // `contentType` tells Tiptap to run the Markdown parser rather than
      // treating the string as HTML.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...({ contentType: 'markdown' } as any),
      editorProps: {
        attributes: {
          class: 'ProseMirror note-editor focus:outline-none'
        },
        handlePaste(view, event) {
          const cd = event.clipboardData
          if (!cd) return false

          // Cmd/Ctrl+Shift+V: bypass every other rule (link detection
          // included) and insert the clipboard's plain text exactly as it
          // is — the explicit escape hatch for "no, really, just the text".
          if (pasteShiftHeld()) {
            const text = cd.getData('text/plain')
            if (!text) {
              pushToast('Nothing to paste as plain text — the clipboard has no text.')
              return true
            }
            event.preventDefault()
            const { from, to } = view.state.selection
            view.dispatch(view.state.tr.insertText(text, from, to).scrollIntoView())
            return true
          }

          // A URL pasted over a selection links the selection rather than
          // replacing it — pasting `https://example.com` onto "the docs"
          // gives "[the docs](https://example.com)", not a naked address
          // where readable text used to be. A selection already carrying a
          // link is re-pointed rather than left alone: pasting a new URL
          // onto linked text reads as "use this address instead".
          const { selection } = view.state
          if (!selection.empty) {
            const url = loneUrl(cd.getData('text/plain'))
            const linkType = view.state.schema.marks.link
            if (url && linkType) {
              event.preventDefault()
              view.dispatch(
                view.state.tr.addMark(selection.from, selection.to, linkType.create({ href: url }))
              )
              return true
            }
          }

          return false
        },
        handleClickOn(view, _pos, _node, _nodePos, event) {
          const target = event.target as HTMLElement | null
          if (target && handleWikilinkClick(target)) return true
          // A commented passage opens its own thread. The id comes off the
          // decoration `CommentHighlight` draws, so this needs no separate
          // hit-testing against anchor positions.
          //
          // Only for a bare click, though: selecting text also ends in a click,
          // and swallowing that one made already-commented text impossible to
          // select — so a second comment could never be added to it.
          const marked = view.state.selection.empty
            ? target?.closest<HTMLElement>('[data-comment-id]')
            : null
          const threadId = marked?.getAttribute('data-comment-id')
          if (!threadId && useCommentsStore.getState().focusedId) {
            // Clicked away from the passage — the emphasis was a pointer, not
            // a selection, so it goes back to an ordinary mark.
            useCommentsStore.getState().setFocused(null)
          }
          if (threadId && commentPath) {
            event.preventDefault()
            const box = marked!.getBoundingClientRect()
            setPendingComment(null)
            // One thread fits in a popover beside its sentence. Several do not:
            // stacking them turns a small card into a scrolling panel that
            // covers the very text they are about, so the column takes over.
            const threads = useCommentsStore.getState().threads
            const clicked = threads.find((t) => t.id === threadId)
            const sameQuote = clicked
              ? threads.filter((t) => t.anchor.exact === clicked.anchor.exact)
              : []
            // Same gesture as clicking the card: whichever way you arrive at a
            // thread, the note points at it.
            useCommentsStore.getState().setFocused(threadId)
            if (sameQuote.length > 1) {
              setViewingComment(null)
              useUiStore.getState().setCommentsOpen(true)
              return true
            }
            setViewingComment({ path: commentPath, threadId, rect: box })
            return true
          }
          const a = target?.closest('a')
          const href = a?.getAttribute('href')
          // Footnote refs/backrefs link to an in-document id (`#footnote-1`,
          // `#footnote-ref-1`) rather than navigating — jump to the matching
          // element instead of letting the browser try to follow a fragment
          // link inside a contenteditable surface.
          if (href?.startsWith('#footnote')) {
            event.preventDefault()
            const target2 = view.dom.querySelector(`#${CSS.escape(href.slice(1))}`)
            target2?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            return true
          }
          if (href && /^https?:/i.test(href)) {
            event.preventDefault()
            window.open(href, '_blank')
            return true
          }
          return false
        }
      },
      onUpdate({ editor: ed }) {
        const md = ed.getMarkdown()
        if (md !== lastMarkdown.current) {
          lastMarkdown.current = md
          onChange(md)
        }
        // A menu opened by the `+` button owns its own query, so document
        // changes must not overwrite or close it.
        setSlash((cur) => (cur?.trigger === 'button' ? cur : readSlashState(ed)))
        setWikilink(readWikilinkState(ed))
      },
      onSelectionUpdate({ editor: ed }) {
        setSlash((cur) => (cur?.trigger === 'button' ? cur : readSlashState(ed)))
        setWikilink(readWikilinkState(ed))
        // Which block the caret sits in, kept current so a mode switch has
        // something to carry over.
        const anchor = captureFromDoc(ed.state.doc, ed.state.selection.from)
        if (anchor) onAnchorRef.current?.(anchor)
      }
    },
    []
  )

  /**
   * Land on the block the source view was in.
   *
   * Once, on arrival — a dependency on the anchor would drag the caret back
   * every time this view reported its own position, which is every keystroke.
   *
   * Waits for the document to be seeded: the editor mounts empty and the body
   * arrives in the effect below, so resolving before that has one block to
   * choose from and always answers `clamped`.
   */
  const landedRef = useRef(false)
  useEffect(() => {
    if (!editor || landedRef.current || !landingAnchor) return
    if (editor.state.doc.childCount === 0) return
    landedRef.current = true
    const landing = resolveInDoc(landingAnchor, editor.state.doc)
    if (!landing) return
    const dom = editor.view.nodeDOM(landing.blockStart) as HTMLElement | null
    dom?.scrollIntoView({ block: 'center' })
    // A guess at the ordinal is worth scrolling to and not worth putting a
    // caret in: a caret is an instruction about where typing goes.
    if (isCaretWorthy(landing.confidence)) {
      editor.chain().setTextSelection(landing.point).focus().run()
    }
  }, [editor, landingAnchor, body])

  // Re-seed when the file changes underneath us (another tab, a Claude write,
  // an external edit). Comparing against `lastMarkdown` keeps the user's own
  // keystrokes from being clobbered by the value they just produced.
  useEffect(() => {
    if (!editor) return
    if (body === lastMarkdown.current) return
    lastMarkdown.current = body
    editor.commands.setContent(prepareBodyForEditor(body), {
      contentType: 'markdown',
      emitUpdate: false
    })
  }, [editor, body, activePath])

  // While the picker is open the handles must stay put: the pointer has left
  // the block to reach the menu, so the plugin would otherwise hide them and
  // the menu would look detached from anything.
  //
  // `lockDragHandle()` is NOT available here. That command lives on the
  // DragHandle *extension*, and `<DragHandle>` from the React package only
  // registers the ProseMirror *plugin* — calling it threw
  // "editor.commands.unlockDragHandle is not a function" and took the editor
  // down with it. The command is only sugar over this meta, which the plugin
  // itself reads, so setting it directly is both correct and dependency-free.
  useEffect(() => {
    if (!editor) return
    // Either picker counts: both take the pointer out of the block to reach a
    // menu, and both would otherwise watch the handles disappear underneath.
    editor.commands.setMeta('lockDragHandle', !!slash || !!wikilink)
  }, [editor, slash, wikilink])

  // Preview mode shares `editorFontSize` with the source editor (see
  // globals.css's `--editor-font-size`), but until now had no way to change
  // it itself — `Mod-=`/`Mod--`/`Mod-0` were claimed at the native Electron
  // menu level for app zoom (main/menu.ts), so `SourceEditor.tsx`'s own
  // font-size keymap never actually fired either. Both now use
  // `Mod-Shift-=`/`Mod-Shift--`/`Mod-Shift-0` instead. Scoped to this
  // editor's own DOM subtree so a split view with two notes open doesn't
  // have both respond to one keystroke.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return
      if (!hostRef.current?.contains(e.target as Node)) return
      if (e.key === '=' || e.key === '+') {
        e.preventDefault()
        useUiStore.getState().bumpEditorFontSize(1)
      } else if (e.key === '-') {
        e.preventDefault()
        useUiStore.getState().bumpEditorFontSize(-1)
      } else if (e.key === '0') {
        e.preventDefault()
        useUiStore.getState().setEditorFontSize(13)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  /**
   * Put the assistant's answer on offer at the passage it belongs to.
   *
   * Read from the store rather than passed in: the request resolves without a
   * value, and the newest proposal for this note is the one it just produced.
   * A proposal that failed has no wording to show, so it is left to the card,
   * which is the only place a reason and a retry can live.
   */
  function showOffer(range: { from: number; to: number; provider: string }): void {
    if (!editor || !commentPath) return
    const proposal = useAiProposalsStore
      .getState()
      .proposals.find((p) => p.status === 'ready' && p.edits.length === 1)
    const edit = proposal?.edits[0]
    if (!proposal || !edit) return

    const span = changedSpan(edit.before, edit.after)
    if (!span.added) return

    // The slot comes back from the call that made the suggestion. It used to be
    // hunted for in the page a frame later, which found the element that was
    // there *then* — and the editor replaces it on the next redraw, so the
    // controls ended up rendered into a node no longer on screen.
    const slot = setAiSuggestion(editor.view, { ...range, added: span.added })
    setApplyState('ready')
    setOffer({ kind: proposal.kind, edit })
    setActionSlot(slot)

    // Taken off the stack: the card would otherwise say the same thing a
    // second time, in the corner, which is the place this replaces.
    useAiProposalsStore.getState().discard(proposal.id)
  }

  const findReplace = useNoteFindReplace(editor, findOpen, () => setFindOpen(false))

  function applyLink(href: string): void {
    if (!editor) return
    const { from, to } = editor.state.selection
    const linkType = editor.state.schema.marks.link
    if (linkType) editor.view.dispatch(editor.state.tr.addMark(from, to, linkType.create({ href })))
    editor.commands.focus()
    setLinkPopover(null)
  }

  // Registered while this editor exists; the handler itself checks
  // `editor.isFocused` so a background tab's editor never answers for the
  // one actually on screen — `setLinkRequestHandler` only tracks "most
  // recently registered", not "currently focused" on its own.
  useEffect(() => {
    if (!editor) return
    setLinkRequestHandler(() => {
      if (!editor.isFocused) return false
      const { selection } = editor.state
      if (selection.empty) return false
      let rect: DOMRect
      try {
        const start = editor.view.coordsAtPos(selection.from)
        const end = editor.view.coordsAtPos(selection.to)
        rect = new DOMRect(
          Math.min(start.left, end.left),
          start.top,
          Math.abs(end.left - start.left),
          end.bottom - start.top
        )
      } catch {
        return false
      }
      const existingHref = editor.getAttributes('link')['href']
      setLinkPopover({ rect, initialHref: typeof existingHref === 'string' ? existingHref : '' })
      return true
    })
    return () => setLinkRequestHandler(null)
  }, [editor])

  // Same scoping as the font-size shortcut above: only while this note's own
  // subtree has focus, so a split view doesn't open two bars from one keypress.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'f') return
      if (!hostRef.current?.contains(e.target as Node)) return
      e.preventDefault()
      setFindOpen(true)
      // Bumped unconditionally — a second Cmd+F while already open is how you
      // ask to search again, not a no-op.
      setFindFocusToken((n) => n + 1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Images are stored as vault-relative paths; the renderer needs the
  // mindex-asset: URL the main process can serve.
  useEffect(() => {
    if (!editor || !vault?.root) return
    const resolve = makeImageResolver(activePath, vault.root)
    for (const img of Array.from(editor.view.dom.querySelectorAll<HTMLImageElement>('img[src]'))) {
      const src = img.getAttribute('src') ?? ''
      const next = resolve(src)
      if (next !== src) img.setAttribute('src', next)
    }
  }, [editor, activePath, vault?.root, body])

  // Comments are per note, so they reload whenever the open file changes.
  //
  // Keyed by the file behind the tab, which for a skill is not the tab's own
  // path.
  useEffect(() => {
    if (!commentPath) return
    void loadComments(commentPath)
  }, [commentPath, loadComments])

  // Highlights are pushed into the plugin rather than read from the store by
  // it: decorations only recompute inside a transaction, so the update has to
  // arrive as one. `body` is a dependency because a re-render from an external
  // change replaces the document the decorations were measured against.
  useEffect(() => {
    if (!editor) return
    setCommentHighlights(
      editor.view,
      commentThreads
        // A resolved thread stops marking its passage: the point of resolving
        // is that the text no longer needs attention. If another comment is
        // still open on the same words it draws its own highlight, so the mark
        // survives exactly as long as something unresolved is attached to it.
        .filter((t) => t.state === 'anchored' && !t.resolved)
        .map((t) => ({
          id: t.id,
          quote: t.anchor.exact,
          occurrence: t.anchor.occurrence ?? 0
        })),
      pendingComment
        ? { quote: pendingComment.quote.exact, occurrence: pendingComment.quote.occurrence }
        : null,
      focusedCommentId
    )
  }, [editor, commentThreads, pendingComment, focusedCommentId, body])

  // Bring the focused thread's passage on screen. The decoration carries the
  // thread id, so the element can be found directly instead of translating an
  // anchor back into coordinates.
  useEffect(() => {
    if (!editor || !focusedCommentId) return
    const raf = requestAnimationFrame(() => {
      const el = editor.view.dom.querySelector(
        `[data-comment-id="${CSS.escape(focusedCommentId)}"]`
      )
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    return () => cancelAnimationFrame(raf)
  }, [editor, focusedCommentId, commentThreads])

  return (
    // min-h-full (not h-full): still fills a short note's pane, but a long
    // one's overflowing content now grows the box instead of spilling past
    // a fixed height — otherwise a sibling rendered after this (the stats
    // line) lands wherever the old fixed height ended, not after the real
    // content.
    <div ref={hostRef} className="relative min-h-full">
      <EditorContent
        editor={editor}
        className="note-editor-host"
        // `EditorContent`'s `style` prop lands on this wrapper, not on the
        // `.ProseMirror` element Tiptap mounts inside it — a `font-size` set
        // here is inherited, but `.ProseMirror`'s own base rule (globals.css)
        // has a real font-size of its own, which always wins over an
        // inherited value regardless of the ancestor's inline style. A custom
        // property sidesteps that: it inherits down to `.ProseMirror`
        // untouched, and the base rule reads it via `var(...)`.
        style={{ '--editor-font-size': `${editorFontSize}px` } as CSSProperties}
      />

      {editor ? (
        <BlockHandles
          editor={editor}
          onRequestMenu={(anchor) =>
            setSlash({
              from: editor.state.selection.from,
              query: '',
              rect: anchor,
              trigger: 'button'
            })
          }
        />
      ) : null}

      {editor ? <SlashMenu editor={editor} state={slash} onClose={() => setSlash(null)} /> : null}
      {editor ? (
        <WikilinkMenu editor={editor} state={wikilink} onClose={() => setWikilink(null)} />
      ) : null}

      {findOpen ? <FindReplaceBar controller={findReplace} focusToken={findFocusToken} /> : null}

      {linkPopover ? (
        <LinkPopover
          state={linkPopover}
          onSubmit={applyLink}
          onClose={() => setLinkPopover(null)}
        />
      ) : null}

      {editor ? (
        <BubbleMenu
          editor={editor}
          // The block picker's surface exactly — plain `--card`, a hairline
          // and a soft shadow. Not the composer's raised fill: this toolbar
          // sits over the note the way the "+" menu does, and the lighter
          // shade made it read as a different class of object.
          // Above the block handles: both float over the note, and the "+"
          // and drag grip sit in the left gutter the toolbar reaches into
          // when a selection starts near the beginning of a line.
          style={{ ...PANEL_SURFACE, zIndex: 40 }}
          className="flex items-center gap-0.5 rounded-[10px] p-1"
        >
          {/* What the block *is*, before what the words are. Turning a
              paragraph into a code block used to mean deleting it, typing
              `/code` and pasting it back — `/` only fires at the start of an
              empty line. */}
          <BlockTypeSelector editor={editor} />
          {/* Straight to this block's markdown. The anchor the switch lands on
              is the one this view has been reporting all along, so the source
              opens on the block under the caret rather than at the top. */}
          <button
            type="button"
            title="View this block in the markdown"
            aria-label="View this block in the markdown"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void useUiStore.getState().setEditorViewMode('edit')}
            className="inline-flex h-7 w-7 items-center justify-center rounded-8 text-c-2 transition-colors hover:bg-bg-3 hover:text-c-1"
          >
            <Icon name="markdown" size={13} className="codicon-inherit" />
          </button>
          <span className="mx-0.5 h-4 w-px bg-border" />
          <FormatButton editor={editor} mark="bold" icon="bold" label="Bold" />
          <FormatButton editor={editor} mark="italic" icon="italic" label="Italic" />
          <FormatButton editor={editor} mark="strike" icon="strikethrough" label="Strikethrough" />
          <FormatButton editor={editor} mark="code" icon="code" label="Inline code" />
          {/* Only for a real note: a comment is anchored to a vault-relative
              path, which a skill file or a type definition does not have. */}
          {commentPath ? (
            <>
              <span className="mx-1 h-4 w-px bg-border" />
              <SelectionAssistant
                getAnchor={() => {
                  const { from, to } = editor.state.selection
                  if (from === to) return null
                  return selectionQuote(editor.state.doc, from, to, CONTEXT_LENGTH)
                }}
                onRun={(transformId, anchor, provider) => {
                  // Light the passage up before the request goes. The range is
                  // read now, while the selection is still the thing the person
                  // pointed at — a moment later the menu closing has already
                  // collapsed it.
                  const { from, to } = editor.state.selection
                  if (to <= from) return
                  setAiThinking(editor.view, { from, to }, provider)
                  // Drop the browser's own selection now that the passage is
                  // marked by our own decoration. The two were stacked: the
                  // native highlight paints its whole line box in its own
                  // colour, over the light travelling across the words, so the
                  // one thing meant to show which passage is being worked on
                  // was the thing hidden. The range was read a line above, so
                  // collapsing costs the request nothing. Same reasoning, and
                  // the same fix, as the Comment button below.
                  editor.commands.setTextSelection(to)
                  void useAiProposalsStore
                    .getState()
                    .requestTransform({ transformId, notePath: commentPath, anchor })
                    .then(() => {
                      clearAiThinking(editor.view)
                      showOffer({ from, to, provider })
                    })
                }}
              />
              <span className="mx-1 h-4 w-px bg-bd-2" />
              <button
                type="button"
                title="Comment on the selection"
                // Marks this as the control that opens the popover, so the
                // popover's own click-away handler does not treat pressing it as
                // "clicked outside" and close what this click is opening.
                data-comment-trigger=""
                onMouseDown={(e) => {
                  e.preventDefault()
                  if (!activePath) return
                  const { from, to } = editor.state.selection
                  if (from === to) return
                  const quote = selectionQuote(editor.state.doc, from, to, CONTEXT_LENGTH)
                  if (!quote.exact.trim()) return
                  let rect: DOMRect
                  try {
                    const start = editor.view.coordsAtPos(from)
                    const end = editor.view.coordsAtPos(to)
                    rect = new DOMRect(
                      Math.min(start.left, end.left),
                      start.top,
                      Math.abs(end.left - start.left),
                      end.bottom - start.top
                    )
                  } catch (err) {
                    // Swallowing this is what made a broken Comment button look
                    // like a dead one: no panel, no error, nothing to go on.
                    console.error('[mindex] could not place the comment popover', err)
                    return
                  }
                  setViewingComment(null)
                  setPendingComment({ path: commentPath, quote, rect })
                  // Drop the browser's own selection now that our decoration
                  // has taken over marking the passage. The two were stacked:
                  // the native highlight paints the whole line box — full
                  // line-height, and out to the end of the line rather than
                  // the end of the text — in its own colour, which is what
                  // made the mark look like a tall band instead of a fill
                  // around the words. The quote was captured above, so
                  // collapsing costs the composer nothing.
                  editor.commands.setTextSelection(editor.state.selection.to)
                }}
                className="inline-flex h-7 items-center gap-1.5 rounded-[7px] px-2 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Icon name="comment" size={13} />
                Comment
              </button>
            </>
          ) : null}
        </BubbleMenu>
      ) : null}

      {offer && editor && actionSlot
        ? createPortal(
            <InlineSuggestionBar
              state={applyState}
              onAccept={() => {
                setApplyState('applying')
                void api()
                  .ai.applyEdit({ kind: offer.kind, edit: offer.edit })
                  .then((r) => {
                    if (r.ok && r.data?.ok) {
                      // Said once, in its own colour, and then it goes. The
                      // write has landed and the editor is about to reload from
                      // disk, so the decoration has nothing left to describe.
                      setApplyState('applied')
                      setTimeout(() => {
                        clearAiSuggestion(editor.view)
                        setOffer(null)
                        setActionSlot(null)
                      }, 900)
                      return
                    }
                    setApplyState('ready')
                    pushToast(
                      r.ok && r.data && !r.data.ok && r.data.reason === 'conflict'
                        ? 'The note changed since this was suggested — try the rewrite again.'
                        : 'The change could not be applied.'
                    )
                  })
              }}
              onDismiss={() => {
                clearAiSuggestion(editor.view)
                setOffer(null)
                setActionSlot(null)
              }}
            />,
            actionSlot
          )
        : null}

      {commentPath ? (
        <CommentComposer
          pending={pendingComment}
          viewing={viewingComment}
          onClose={() => {
            setPendingComment(null)
            setViewingComment(null)
          }}
        />
      ) : null}
    </div>
  )
}

/**
 * The `/` menu opens only at the start of an empty-ish block, so typing a date
 * or a path mid-sentence never triggers it. Returns the query typed after the
 * slash together with the caret rectangle to anchor the menu to.
 */
function readSlashState(ed: { state: unknown; view: unknown }): SlashState | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editor = ed as any
  const { selection } = editor.state
  if (!selection.empty) return null
  const { $from } = selection
  const textBefore: string = $from.parent.textBetween(0, $from.parentOffset, '\n', '\n')
  const m = /^\/([\w-]*)$/.exec(textBefore)
  if (!m) return null
  const start = $from.start()
  let rect: DOMRect
  try {
    const coords = editor.view.coordsAtPos($from.pos)
    rect = new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top)
  } catch {
    return null
  }
  return { from: start, query: m[1] ?? '', rect, trigger: 'slash' }
}

/**
 * A `[[` waiting for a note name.
 *
 * Unlike the slash menu this fires mid-sentence — a link belongs inside a
 * sentence, and requiring it at the start of a block would make the feature
 * useless where it is actually wanted. The query stops at a closing bracket or
 * a newline so a finished link stops offering to be completed.
 */
function readWikilinkState(ed: { state: unknown; view: unknown }): WikilinkState | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editor = ed as any
  const { selection } = editor.state
  if (!selection.empty) return null
  const { $from } = selection
  const textBefore: string = $from.parent.textBetween(0, $from.parentOffset, '\n', '\n')
  const m = /\[\[([^\][\n]*)$/.exec(textBefore)
  if (!m) return null
  const query = m[1] ?? ''
  let rect: DOMRect
  try {
    const coords = editor.view.coordsAtPos($from.pos)
    rect = new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top)
  } catch {
    return null
  }
  // `from` is the first bracket: the caret, back past the query and both
  // brackets. That whole range is what a pick replaces.
  return { from: $from.pos - query.length - 2, query, rect }
}

function FormatButton({
  editor,
  mark,
  icon,
  label
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor: any
  mark: 'bold' | 'italic' | 'strike' | 'code'
  icon: string
  label: string
}): JSX.Element {
  const active = editor.isActive(mark)
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={(e) => {
        e.preventDefault()
        const chain = editor.chain().focus()
        if (mark === 'bold') chain.toggleBold().run()
        else if (mark === 'italic') chain.toggleItalic().run()
        else if (mark === 'strike') chain.toggleStrike().run()
        else chain.toggleCode().run()
      }}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-[7px] transition-colors',
        active ? 'bg-accent-1/[0.14] text-foreground' : 'text-muted-foreground hover:bg-accent'
      )}
    >
      <Icon name={icon} size={13} className={active ? 'codicon-blue' : undefined} />
    </button>
  )
}
