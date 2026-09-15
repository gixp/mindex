import { useState } from 'react'
import type { CommentThreadView } from '@shared/comments'
import { useCommentsStore } from '@/features/comments/store'
import { SendButton } from '@/features/editor/components/CommentComposer'
import { Icon } from '@/ui/icon'
import { relTime } from '@/features/comments/lib/rel-time'
import { cn } from '@/ui/cn'

/**
 * One comment thread, rendered identically wherever it appears: as a row in
 * the sidebar, and inside the popover that opens when its highlighted passage
 * is clicked. Two hand-kept copies of this drifted apart within a day of
 * existing, which is why it is one component.
 */
export function CommentCard({
  path,
  thread
}: {
  path: string
  thread: CommentThreadView
}): JSX.Element {
  const reply = useCommentsStore((s) => s.reply)
  const setResolved = useCommentsStore((s) => s.setResolved)
  const setFocused = useCommentsStore((s) => s.setFocused)
  const focused = useCommentsStore((s) => s.focusedId === thread.id)
  const [draft, setDraft] = useState('')
  const [replying, setReplying] = useState(false)

  function send(): void {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    setReplying(false)
    void reply(path, thread.id, text)
  }

  const orphaned = thread.state === 'orphaned'
  // The newest message, so a thread with replies reports when it was last
  // touched rather than when it was opened.
  const lastActivity = relTime(thread.messages[thread.messages.length - 1]?.ts ?? thread.updatedAt)

  return (
    // Same fill as the composer in this sidebar, so a thread reads as a field
    // of this column rather than a card floating on top of it.
    //
    // Clicking anywhere on it points the note at this thread: its passage
    // scrolls into view and its highlight is drawn stronger.
    <div
      onClick={() => setFocused(thread.id)}
      className={cn(
        'rounded-[11px] p-2.5 transition-colors',
        focused ? 'bg-bg-3' : 'bg-bg-3',
        thread.resolved && 'opacity-55'
      )}
    >
      <div className="flex items-start gap-1.5">
        {/* The quote survives even when the text it described is gone — that is
            the difference between an orphaned comment and a lost one. */}
        <span
          className={cn(
            'min-w-0 flex-1 border-l-2 pl-1.5 text-[11.5px] leading-snug',
            orphaned
              ? 'border-amber-500/60 text-muted-foreground line-through decoration-muted-foreground/40'
              : 'border-accent-1 text-muted-foreground'
          )}
        >
          {thread.anchor.exact}
        </span>

        {orphaned ? (
          <span
            title="The text this comment was attached to is no longer in the note"
            className="shrink-0 pt-px text-[9px] font-semibold uppercase tracking-wider text-amber-400/80"
          >
            Orphaned
          </span>
        ) : null}

        {/* Up here rather than under the thread, so the reply field below can
            have the full width of the card. Resolving is the only action: it
            already takes a finished thread out of the way, which is what a
            delete button would have been for. */}
        <button
          type="button"
          title={thread.resolved ? 'Reopen' : 'Resolve'}
          onClick={() => void setResolved(path, thread.id, !thread.resolved)}
          className="inline-flex shrink-0 items-center text-muted-foreground transition-colors hover:text-foreground"
        >
          <Icon name={thread.resolved ? 'history' : 'check'} size={12} />
        </button>
      </div>

      <div className="mt-1.5 flex flex-col gap-1">
        {thread.messages.map((m) => (
          <div
            key={m.id}
            className="whitespace-pre-wrap text-[12.5px] leading-snug text-foreground"
          >
            {m.text}
          </div>
        ))}
      </div>

      {/* A field per thread would fill the column with empty boxes, so replying
          starts as a word and only becomes an input once asked for. Border
          lighter than the card behind it, so the field reads as sitting on the
          card rather than being cut out of it. */}
      {replying ? (
        <div className="mt-1.5 flex items-center gap-1 rounded-[9px] border border-bd-2 py-1 pl-2 pr-1">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setDraft('')
                setReplying(false)
                return
              }
              if (e.key !== 'Enter' || !draft.trim()) return
              e.preventDefault()
              send()
            }}
            placeholder="Reply…"
            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[12px] outline-none placeholder:text-muted-foreground/50"
          />
          <SendButton enabled={!!draft.trim()} title="Reply (Enter)" size="sm" onClick={send} />
        </div>
      ) : (
        // Reply and the timestamp share one line: the time is a footnote about
        // the thread, not worth a line of its own under every message.
        <div className="mt-1 flex items-baseline justify-between gap-2">
          <span className="shrink-0 text-[10px] text-muted-foreground/70">{lastActivity}</span>
          <button
            type="button"
            onClick={() => setReplying(true)}
            className="text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
          >
            Reply
          </button>
        </div>
      )}
    </div>
  )
}
