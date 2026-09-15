import type { ReactNode, UIEvent } from 'react'

/**
 * The markdown editing surface: scroll container, gutters, and where the
 * properties panel, the text and the footer sit inside it.
 *
 * Extracted so the note editor and the skill-file editor are the *same*
 * layout rather than two versions of it. The copy that came before this
 * dropped the `px-16` gutter, so a skill file's properties started hard
 * against the panel edge while its text began a 4rem gutter in — the kind of
 * difference that only ever appears in a copy.
 *
 * Pure layout: every behaviour that differs between the two — image drops,
 * scroll tracking, what the footer counts — is passed in.
 */
export function EditorSurface({
  source,
  frontmatter,
  body,
  footer,
  comments,
  bodyRef,
  onScroll,
  onDragOverCapture,
  onDropCapture
}: {
  /** Rendered alone when set; the three below are the preview face. */
  source?: ReactNode
  frontmatter?: ReactNode
  body?: ReactNode
  footer?: ReactNode
  comments?: ReactNode
  bodyRef?: React.Ref<HTMLDivElement>
  onScroll?(e: UIEvent<HTMLDivElement>): void
  onDragOverCapture?(e: React.DragEvent<HTMLDivElement>): void
  onDropCapture?(e: React.DragEvent<HTMLDivElement>): void
}): JSX.Element {
  return (
    <div className="relative flex h-full min-h-0 flex-row">
      <div className="flex min-w-0 flex-1 flex-col">
        <div
          ref={bodyRef}
          className="min-h-0 flex-1 overflow-auto"
          onScroll={onScroll}
          onDragOverCapture={onDragOverCapture}
          onDropCapture={onDropCapture}
        >
          {source ?? (
            <>
              {/* Half the editor's own left/right gutter, deliberately: the
                  properties are a bordered card rather than a run of text, so
                  they are not trying to line up with the paragraphs below —
                  a card set in as far as the prose reads as a narrow column
                  of chrome rather than as a header for the note.

                  Inside the scroll container rather than pinned above it, so
                  it scrolls away with the rest of the document. */}
              {frontmatter ? <div className="px-8 pt-5">{frontmatter}</div> : null}
              {body}
              {footer ? <div className="px-16 pb-6 pt-4">{footer}</div> : null}
            </>
          )}
        </div>
      </div>
      {comments}
    </div>
  )
}

/** The counts under a document, in the one shape both editors use. */
export function EditorFooter({
  words,
  chars,
  tokens
}: {
  words: number
  chars: number
  tokens: number
}): JSX.Element {
  return (
    <div className="border-t border-border pt-2 text-[11px] tabular-nums text-muted-foreground">
      {words.toLocaleString()} words · {chars.toLocaleString()} chars · ~{tokens.toLocaleString()}{' '}
      tokens
    </div>
  )
}
