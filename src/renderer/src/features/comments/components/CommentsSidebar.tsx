import { useMemo, useState } from 'react'
import type { CommentThreadView } from '@shared/comments'
import { useUiStore } from '@/platform/app-settings'
import { useCommentsStore } from '@/features/comments/store'
import { CommentCard } from './CommentCard'
import { Icon } from '@/ui/icon'
import { ChromeButton } from '@/ui/chrome-button'
import { cn } from '@/ui/cn'

const EMPTY_THREADS: CommentThreadView[] = []

/**
 * The note's comments, as a column beside the note itself rather than a modal
 * over it.
 *
 * A modal was the wrong shape for this: reading a comment means reading the
 * sentence it is about, and a dialog covers exactly that. Preview only —
 * Source mode shows the raw markdown, where the highlights these threads pair
 * with do not exist.
 */
export function CommentsSidebar({ path }: { path: string }): JSX.Element {
  // Loaded by `NoteEditor`, which needs the same threads for the in-text
  // highlights — fetching them again here would just duplicate that request.
  //
  // The fallback is a shared constant, not a fresh `[]`: a new array on every
  // read is a new snapshot every render, which is an infinite loop as far as
  // `useSyncExternalStore` is concerned.
  const storePath = useCommentsStore((s) => s.path)
  const allThreads = useCommentsStore((s) => s.threads)
  const threads = storePath === path ? allThreads : EMPTY_THREADS
  const setOpen = useUiStore((s) => s.setCommentsOpen)
  const [showResolved, setShowResolved] = useState(false)

  const active = useMemo(() => threads.filter((t) => !t.resolved), [threads])
  const resolved = useMemo(() => threads.filter((t) => t.resolved), [threads])

  return (
    // The divider is drawn as a line rather than a border so it can stop short
    // of the bottom edge; a `border-l` always runs the full height.
    <aside
      className={cn(
        'relative flex h-full w-[280px] shrink-0 flex-col',
        "before:absolute before:left-0 before:top-0 before:bottom-4 before:w-px before:bg-border before:content-['']"
      )}
    >
      <div className="flex shrink-0 items-center gap-2 px-3 py-2.5">
        <span className="text-[12.5px] font-medium text-foreground">Comments</span>
        <span className="text-[11px] tabular-nums text-muted-foreground/70">{active.length}</span>
        <button
          type="button"
          title="Hide comments"
          onClick={() => setOpen(false)}
          className="ml-auto inline-flex items-center text-muted-foreground transition-colors hover:text-foreground"
        >
          <Icon name="close" size={12} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {threads.length === 0 ? (
          <div className="px-2 pt-6 text-center text-[11.5px] leading-relaxed text-muted-foreground/70">
            No comments yet.
            <br />
            Select some text and choose Comment.
          </div>
        ) : null}

        {active.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {active.map((t) => (
              <CommentCard key={t.id} path={path} thread={t} />
            ))}
          </div>
        ) : null}

        {/* The toggle belongs to the resolved group, so it sits directly on top
            of it rather than above the whole column — the live threads are
            what you came for and stay first. */}
        {resolved.length > 0 ? (
          <>
            <ChromeButton
              icon="history"
              label={`${showResolved ? 'Hide' : 'Show'} resolved (${resolved.length})`}
              iconSize={11}
              onClick={() => setShowResolved((v) => !v)}
              className="mt-1.5 w-full justify-start text-[11px]"
            />
            {showResolved ? (
              <div className="mt-1.5 flex flex-col gap-1.5">
                {resolved.map((t) => (
                  <CommentCard key={t.id} path={path} thread={t} />
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </aside>
  )
}
