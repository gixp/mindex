import { useEffect, useRef, useState } from 'react'
import type { CommentThreadView } from '@shared/comments'
import { useCommentsStore } from '@/features/comments/store'
import { Icon } from '@/ui/icon'
import { CommentCard } from '@/features/comments/components/CommentCard'
import { cn } from '@/ui/cn'
import { PANEL_SURFACE, RAISED_SURFACE } from '@/ui/surfaces'

export interface PendingComment {
  path: string
  quote: { exact: string; prefix: string; suffix: string; occurrence: number }
  rect: DOMRect
}

/** An existing thread, opened by clicking the passage it is attached to. */
export interface ViewingComment {
  path: string
  threadId: string
  rect: DOMRect
}

/** Wide enough for a sentence of typing; the block picker's 236 is too narrow
 *  for prose, everything else here matches it. */
const WIDTH = 300

const SURFACE = RAISED_SURFACE

/**
 * The same control the chat composer in the right sidebar uses to send — same
 * size, radius, colours and press animation. Sending a comment and sending a
 * message are the same gesture, so they should not look like two different
 * buttons.
 */
/**
 * `md` sits in the compose box, `sm` in the tighter reply rows — a reply is a
 * smaller act than starting a thread, and the sidebar column has less width to
 * spend on it.
 */
export function SendButton({
  enabled,
  title,
  size = 'md',
  onClick
}: {
  enabled: boolean
  title: string
  size?: 'sm' | 'md'
  onClick(): void
}): JSX.Element {
  const small = size === 'sm'
  return (
    <button
      type="button"
      disabled={!enabled}
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn(
        'inline-flex shrink-0 items-center justify-center',
        small ? 'h-5 w-5 rounded-[6px]' : 'h-6 w-6 rounded-[8px]',
        'transition-[colors,transform] duration-100 ease-out active:scale-[0.94]',
        enabled ? 'bg-accent-1 hover:bg-[#3072f0] active:bg-accent-1/80' : 'cursor-default bg-bg-3'
      )}
    >
      <Icon
        name="arrow-up"
        size={small ? 10 : 12}
        className={cn('-translate-x-px', enabled ? 'codicon-on-fill' : 'text-muted-foreground')}
      />
    </button>
  )
}

/**
 * The card that appears over the passage you just selected, in place of the
 * formatting toolbar. It has two faces:
 *
 *  - **composing** — the empty box you type the comment into;
 *  - **added** — the comment as it now exists, still pinned to the same
 *    highlighted passage.
 *
 * It switches rather than closing on save, because vanishing would leave no
 * confirmation that anything happened, and the passage you were looking at is
 * exactly where you want to see the result. Reading and managing every thread
 * on the note is the sidebar's job, opened from "View comments".
 */
export function CommentComposer({
  pending,
  viewing,
  onClose
}: {
  pending: PendingComment | null
  viewing: ViewingComment | null
  onClose(): void
}): JSX.Element | null {
  const add = useCommentsStore((s) => s.add)
  // Read live from the store rather than captured at click time, so a reply
  // posted here appears without reopening the popover.
  const allThreads = useCommentsStore((s) => s.threads)
  const viewedThread = viewing ? (allThreads.find((t) => t.id === viewing.threadId) ?? null) : null
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<CommentThreadView | null>(null)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Reset unconditionally, including when `pending` clears: leaving `saved`
    // behind meant the next Comment click reopened the *previous* comment's
    // confirmation instead of an empty box.
    setText('')
    setError(null)
    setSaved(null)
    if (!pending) return
    const t = setTimeout(() => areaRef.current?.focus(), 20)
    return () => clearTimeout(t)
  }, [pending])

  const anchorRect = pending?.rect ?? viewing?.rect ?? null

  useEffect(() => {
    if (!anchorRect) return
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [anchorRect, onClose])

  // Clicking away dismisses the popover — but only while nothing has been
  // typed. Half a comment is not something to throw away because the pointer
  // landed elsewhere; that case waits for Escape.
  //
  // The check reads the live fields rather than React state: the reply box
  // belongs to `CommentCard`, which owns its own draft, so this component
  // cannot know about it any other way.
  useEffect(() => {
    if (!anchorRect) return
    function onPointerDown(e: MouseEvent): void {
      const target = e.target as Node | null
      if (target && panelRef.current?.contains(target)) return
      // The button that opens this popover is not "outside" it. React's
      // handler runs before this document-level one, so without this the
      // click that opens a new composer immediately closed it again — which
      // looked exactly like a dead button.
      if (target instanceof Element && target.closest('[data-comment-trigger]')) return
      const fields = panelRef.current?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        'input, textarea'
      )
      for (const field of fields ?? []) if (field.value.trim()) return
      onClose()
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [anchorRect, onClose])

  if (!anchorRect) return null

  async function submit(): Promise<void> {
    if (!pending) return
    const body = text.trim()
    if (!body || saving) return
    setSaving(true)
    const thread = await add(pending.path, pending.quote, body)
    setSaving(false)
    if (!thread) {
      // The usual cause is a selection that crosses formatting, so the exact
      // text does not exist in the markdown — say what to do about it.
      setError('Could not attach the comment here. Try selecting plain text.')
      return
    }
    setSaved(thread)
  }

  // Anchored under the passage, kept inside the window on the right edge.
  const left = Math.max(12, Math.min(anchorRect.left, window.innerWidth - WIDTH - 12))
  const style = { ...SURFACE, left, top: anchorRect.bottom + 8, width: WIDTH, zIndex: 55 }

  // Clicking a highlighted passage lands here: the thread it carries, shown
  // where it is anchored rather than in a panel somewhere else.
  // Clicking a highlighted passage lands here: the very same card the sidebar
  // shows, so a thread looks like one thing wherever you meet it. The panel
  // adds only what a floating surface needs — an opaque base, a border and a
  // shadow. `--card` under the card's own translucent fill composites to
  // exactly the colour it has in the sidebar.
  if (viewing) {
    if (!viewedThread) return null
    return (
      <div
        ref={panelRef}
        style={{
          left,
          top: anchorRect.bottom + 8,
          width: WIDTH,
          zIndex: 55,
          // The shared surface, not a fourth copy of these three lines.
          ...PANEL_SURFACE
        }}
        className="fixed overflow-hidden rounded-[11px]"
      >
        <CommentCard path={viewing.path} thread={viewedThread} />
      </div>
    )
  }

  if (saved) {
    const message = saved.messages[0]
    return (
      <div ref={panelRef} style={style} className="fixed rounded-[11px] pb-1 pl-2 pr-1 pt-1.5">
        <div className="flex items-center gap-1.5 px-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.09em] text-accent-1/80">
          <Icon name="check" size={11} className="codicon-blue" />
          Comment added
          {/* Dismissing is the only thing left to do here, so it is the close
              affordance every other panel uses, not a "Done" button. */}
          <button
            type="button"
            title="Close"
            aria-label="Close"
            onClick={onClose}
            className="-mr-0.5 -mt-0.5 ml-auto inline-flex h-5 w-5 items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:bg-bg-3 hover:text-foreground"
          >
            <Icon name="close" size={11} />
          </button>
        </div>

        <div className="mx-1.5 mt-1.5 border-l-2 border-accent-1 pl-2 text-[11.5px] leading-snug text-muted-foreground">
          {saved.anchor.exact}
        </div>

        <div className="px-1.5 pt-1.5 text-[12.5px] leading-snug text-foreground">
          {message?.text}
        </div>
      </div>
    )
  }

  if (!pending) return null

  return (
    <div ref={panelRef} style={style} className="fixed rounded-[11px] pb-1 pl-2 pr-1 pt-1.5">
      {/* No frame of its own: the panel around it *is* the field, with the
          send button inside — one input object, the way the chat composer in
          the right sidebar is built. */}
      <div>
        <textarea
          ref={areaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter is a newline — the same bargain every
            // message box in this app makes.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void submit()
            }
          }}
          rows={2}
          placeholder="Add a comment"
          className="w-full resize-none border-0 bg-transparent p-0 pr-1 text-[12.5px] leading-snug shadow-none outline-none placeholder:text-muted-foreground/50"
        />
        <div className="mt-1 flex justify-end">
          <SendButton
            enabled={!!text.trim() && !saving}
            title="Add comment (Enter)"
            onClick={() => void submit()}
          />
        </div>
      </div>

      {error ? <div className="px-1.5 pt-1 text-[11px] text-amber-400">{error}</div> : null}
    </div>
  )
}
