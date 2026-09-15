import { useEffect, useMemo, useState } from 'react'
import type { GitFileEntry, IpcResult } from '@shared/types'
import { useUiStore } from '@/platform/app-settings'
import { effectiveFileState, useGitStatusStore } from '@/features/git/store'
import { gitStateColor, gitStateLetter } from '@/features/git/lib/git-display'
import { StandardDialog } from '@/ui/StandardDialog'
import { ConfirmDialog } from '@/ui/ConfirmDialog'
import { EmptyState } from '@/ui/EmptyState'
import { Icon } from '@/ui/icon'
import { cn } from '@/ui/cn'
import { api } from '@/platform/api'
import { GitDiffView } from './GitDiffView'
import { PublishToGitHubDialog } from './PublishToGitHubDialog'

function isStaged(e: GitFileEntry): boolean {
  return !e.conflicted && e.indexState !== 'unmodified'
}
function isUnstaged(e: GitFileEntry): boolean {
  return !e.conflicted && e.worktreeState !== 'unmodified'
}

/** Same button as Context Management's: fills with its own edge on hover. */
const ACTION =
  'inline-flex h-[26px] shrink-0 items-center gap-1.5 rounded-8 border border-bd-1 px-2 text-11 font-medium text-c-2 transition-colors hover:bg-bg-3 hover:text-c-1 disabled:cursor-not-allowed disabled:opacity-30'

const ROW_BTN =
  'inline-flex h-6 w-6 items-center justify-center rounded-6 text-c-2 transition-colors hover:bg-bg-3 hover:text-c-1 disabled:cursor-not-allowed disabled:opacity-30'

/**
 * What is about to be committed, what is not, and one place to say why.
 *
 * It used to be four tabs — staged, changed, untracked, conflicted — which is
 * the one arrangement this screen cannot afford: committing is a comparison
 * between two of those lists, and tabs are exactly the device that makes two
 * lists impossible to compare. You staged something, the row vanished into a
 * tab you were not looking at, and the commit box told you a number instead of
 * showing you what it counted. Now both are on screen at once, one under the
 * other, and untracked files sit with the other unstaged changes because the
 * question they answer is the same one: is this going in.
 *
 * The header carries nothing but the title, as every window's does now. What
 * used to live up there has gone where it belongs: the branch and its two
 * network actions to a strip above the list, and automatic sync — a setting,
 * not a control — to Settings → Git, along with removing the repository,
 * which was a destructive button sitting between two everyday ones.
 */
export function SourceControlModal(): JSX.Element | null {
  const open = useUiStore((s) => s.sourceControlOpen)
  const setOpen = useUiStore((s) => s.setSourceControlOpen)
  const snapshot = useGitStatusStore((s) => s.snapshot)
  const refresh = useGitStatusStore((s) => s.refresh)

  const [selected, setSelected] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState<GitFileEntry | null>(null)
  const [publishOpen, setPublishOpen] = useState(false)

  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  // Memoised, not just defaulted: `?? []` builds a fresh array every render,
  // so the three groupings below would recompute on every keystroke in the
  // commit box — the whole list re-sorted while someone types a sentence.
  const files = useMemo(() => snapshot?.files ?? [], [snapshot])
  const staged = useMemo(() => files.filter(isStaged), [files])
  const unstaged = useMemo(() => files.filter(isUnstaged), [files])
  const conflicted = useMemo(() => files.filter((f) => f.conflicted), [files])

  async function run(fn: () => Promise<IpcResult<unknown>>): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const r = await fn()
      if (!r.ok) setError(r.error ?? 'Failed')
    } finally {
      setBusy(false)
    }
  }

  async function commit(): Promise<void> {
    if (!message.trim() || staged.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const r = await api().git.commit(message.trim())
      if (r.ok) setMessage('')
      else setError(r.error ?? 'Commit failed')
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  const branch = snapshot?.branch
  const isRepo = snapshot?.isRepo ?? false
  const gitAvailable = snapshot?.gitAvailable ?? true
  const nothingToShow = staged.length + unstaged.length + conflicted.length === 0
  /** Is there anything to lay a two-pane window out around? */
  const ready = gitAvailable && isRepo

  return (
    <>
      <StandardDialog
        open
        onOpenChange={setOpen}
        icon="source-control"
        title="Source Control"
        subtitle="What has changed in this vault since the last commit, and what is going into the next one."
        // A window is as big as it has something to say. With no repository —
        // or no git at all — there is one sentence and one button, and the
        // list and the diff beside it do not exist: opening a 1080-wide,
        // 640-tall window around them was absurd.
        width={ready ? 440 : 520}
        height={ready ? 640 : 'auto'}
        expanded={ready}
        rightSlotWidth={640}
        rightSlot={
          selected ? (
            <GitDiffView relPath={selected} />
          ) : (
            <EmptyState
              icon="git-compare"
              title="Nothing selected"
              hint="Pick a file to see what changed in it."
            />
          )
        }
      >
        {!gitAvailable ? (
          <SetupState
            mark="tools"
            title="Git isn't installed"
            body="Version history and publishing both run the git program, and this machine doesn't have it."
            actionIcon="link-external"
            actionLabel="Get git"
            onAction={() => window.open('https://git-scm.com/downloads', '_blank')}
            note="Install it and Mindex picks it up on its own — no restart."
          />
        ) : !isRepo ? (
          <SetupState
            mark="github"
            title="Connect to GitHub"
            body="Creates a repository for this vault and pushes the first commit."
            actionIcon="github"
            actionLabel="Set up syncing"
            onAction={() => setPublishOpen(true)}
            note="Everything is pushed except .mindex/ — chats, note history and comments stay on this machine."
          />
        ) : (
          <>
            {/* Where this vault stands against its remote, and the two
                actions that change that. A strip rather than header chrome:
                the branch is information the list is about, not a title. */}
            <div className="flex shrink-0 items-center gap-2 rounded-12 bg-bg-2 px-2.5 py-2">
              <Icon name="git-branch" size={12} className="shrink-0 codicon-muted" />
              <span className="min-w-0 flex-1 truncate font-mono text-11.5 text-c-1">
                {branch?.detached ? '(detached)' : (branch?.name ?? '—')}
              </span>
              {branch && branch.behind > 0 ? (
                <span className="shrink-0 text-11 tabular-nums text-amber-400">
                  {branch.behind} behind
                </span>
              ) : null}
              {branch && branch.ahead > 0 ? (
                <span className="shrink-0 text-11 tabular-nums text-accent-1">
                  {branch.ahead} ahead
                </span>
              ) : null}
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => api().git.pull())}
                title="Bring down what other people pushed"
                className={ACTION}
              >
                <Icon name="repo-pull" size={11} className="codicon-inherit" />
                Pull
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => api().git.push({ setUpstream: !branch?.upstream }))}
                title="Send your commits to the remote"
                className={ACTION}
              >
                <Icon name="repo-push" size={11} className="codicon-inherit" />
                Push
              </button>
            </div>

            <div className="tree-scroll min-h-0 flex-1 overflow-auto">
              {nothingToShow ? (
                <EmptyState
                  icon="check"
                  title="Nothing has changed"
                  hint="Every file in the vault matches the last commit."
                />
              ) : (
                <div className="flex flex-col gap-3">
                  {conflicted.length > 0 ? (
                    <Section
                      label="Conflicted"
                      dot="bg-red-400"
                      count={conflicted.length}
                      hint="Both sides changed these. Open one, fix it, then mark it resolved."
                    >
                      {conflicted.map((entry) => (
                        <FileRow
                          key={entry.path}
                          entry={entry}
                          busy={busy}
                          selected={selected === entry.path}
                          onSelect={() => setSelected(entry.path)}
                          actions={
                            <button
                              type="button"
                              disabled={busy}
                              title="Mark resolved"
                              onClick={() => void run(() => api().git.stage([entry.path]))}
                              className={ROW_BTN}
                            >
                              <Icon name="check" size={12} className="codicon-inherit" />
                            </button>
                          }
                        />
                      ))}
                    </Section>
                  ) : null}

                  <Section
                    label="Going into this commit"
                    dot="bg-emerald-400"
                    count={staged.length}
                    action={
                      staged.length > 0 ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void run(() => api().git.unstage(staged.map((f) => f.path)))
                          }
                          className={ACTION}
                        >
                          Unstage all
                        </button>
                      ) : null
                    }
                    empty="Nothing staged yet."
                  >
                    {staged.map((entry) => (
                      <FileRow
                        key={entry.path}
                        entry={entry}
                        busy={busy}
                        selected={selected === entry.path}
                        onSelect={() => setSelected(entry.path)}
                        actions={
                          <button
                            type="button"
                            disabled={busy}
                            title="Take it back out"
                            onClick={() => void run(() => api().git.unstage([entry.path]))}
                            className={ROW_BTN}
                          >
                            <Icon name="remove" size={12} className="codicon-inherit" />
                          </button>
                        }
                      />
                    ))}
                  </Section>

                  <Section
                    label="Left out"
                    dot="bg-amber-400"
                    count={unstaged.length}
                    action={
                      unstaged.length > 0 ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void run(() => api().git.stage(unstaged.map((f) => f.path)))
                          }
                          className={ACTION}
                        >
                          Stage all
                        </button>
                      ) : null
                    }
                    empty="Everything changed is staged."
                  >
                    {unstaged.map((entry) => (
                      <FileRow
                        key={entry.path}
                        entry={entry}
                        busy={busy}
                        selected={selected === entry.path}
                        onSelect={() => setSelected(entry.path)}
                        actions={
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              title="Throw the change away"
                              onClick={() => setConfirmDiscard(entry)}
                              className={ROW_BTN}
                            >
                              <Icon name="discard" size={12} className="codicon-inherit" />
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              title="Put it in the commit"
                              onClick={() => void run(() => api().git.stage([entry.path]))}
                              className={ROW_BTN}
                            >
                              <Icon name="add" size={12} className="codicon-inherit" />
                            </button>
                          </>
                        }
                      />
                    ))}
                  </Section>
                </div>
              )}
            </div>

            {error ? <p className="shrink-0 text-11 text-red-400">{error}</p> : null}

            <div className="shrink-0">
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="What changed, and why"
                rows={2}
                className="w-full resize-none rounded-12 border border-bd-1 bg-transparent px-2.5 py-2 text-12 text-c-1 outline-none transition-colors placeholder:text-c-2/60 focus:border-bd-2"
              />
              <button
                type="button"
                disabled={busy || !message.trim() || staged.length === 0}
                onClick={() => void commit()}
                title={
                  staged.length === 0
                    ? 'Stage something first — a commit records what is staged'
                    : undefined
                }
                className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-10 bg-accent-1 px-3 py-2 text-12.5 font-medium text-white transition-colors hover:bg-accent-1/90 disabled:cursor-not-allowed disabled:bg-bg-2 disabled:text-c-2 [&_.codicon::before]:!text-white"
              >
                <Icon name="check" size={12} />
                {staged.length > 0 ? `Commit ${staged.length}` : 'Commit'}
              </button>
            </div>
          </>
        )}
      </StandardDialog>

      <ConfirmDialog
        open={confirmDiscard !== null}
        title="Throw this change away?"
        message={
          <p>
            The change to <span className="font-mono text-foreground">{confirmDiscard?.path}</span>{' '}
            goes back to how it was at the last commit. This cannot be undone.
          </p>
        }
        confirmLabel="Discard"
        confirmIcon="discard"
        destructive
        onCancel={() => setConfirmDiscard(null)}
        onConfirm={() => {
          const entry = confirmDiscard
          setConfirmDiscard(null)
          if (!entry) return
          const untracked = entry.worktreeState === 'untracked'
          void run(() =>
            api().git.discard(untracked ? [] : [entry.path], untracked ? [entry.path] : [])
          )
        }}
      />

      <PublishToGitHubDialog open={publishOpen} onOpenChange={setPublishOpen} />
    </>
  )
}

/**
 * One group of files with a name, a count and its own bulk action.
 *
 * The name says what the group *means* rather than what git calls it —
 * "going into this commit" instead of "staged" — because the two lists only
 * make sense in relation to the commit button under them, and the git words
 * explain that relationship to people who already know it.
 */
function Section({
  label,
  dot,
  count,
  hint,
  action,
  empty,
  children
}: {
  label: string
  dot: string
  count: number
  hint?: string
  action?: React.ReactNode
  empty?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <div>
      <div className="flex items-center gap-2 pb-1">
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dot)} />
        <span className="text-11 font-medium uppercase tracking-wider text-c-2">{label}</span>
        <span className="text-11 tabular-nums text-c-2/70">{count}</span>
        {action ? <span className="ml-auto">{action}</span> : null}
      </div>
      {hint ? <p className="pb-1 text-11 leading-snug text-c-2/80">{hint}</p> : null}
      {count === 0 && empty ? (
        <p className="py-1 text-11 text-c-2/60">{empty}</p>
      ) : (
        <div className="flex flex-col">{children}</div>
      )}
    </div>
  )
}

function FileRow({
  entry,
  busy,
  selected,
  onSelect,
  actions
}: {
  entry: GitFileEntry
  busy: boolean
  selected: boolean
  onSelect(): void
  actions: React.ReactNode
}): JSX.Element {
  const state = effectiveFileState(entry)
  const name = entry.path.split('/').pop() ?? entry.path
  const folder = entry.path.slice(0, entry.path.length - name.length)
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      title={entry.path}
      className={cn(
        'flex min-w-0 cursor-pointer items-center gap-2 rounded-8 px-1.5 py-1.5 text-12 transition-colors',
        selected ? 'bg-bg-2' : 'hover:bg-bg-2'
      )}
    >
      <span
        className={cn('w-3 shrink-0 text-center text-10 font-semibold', gitStateColor(state))}
        title={state}
      >
        {gitStateLetter(state)}
      </span>
      {/* The name at full strength and the folder behind it: a list of long
          paths that all start the same way is unreadable, and the part that
          differs is at the end. */}
      <span className="min-w-0 flex-1 truncate font-mono">
        <span className="text-c-1">{name}</span>
        {folder ? <span className="text-c-2/60"> {folder.replace(/\/$/, '')}</span> : null}
      </span>
      <span className="flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
        {busy ? null : actions}
      </span>
    </div>
  )
}

/**
 * The window when there is nothing to show yet.
 *
 * Centred and given room, rather than a strip of text with a button pushed to
 * the right of it: this is the only thing on screen, and a layout that spends
 * a third of the width on empty space beside a sentence reads as an unfinished
 * row rather than an invitation.
 *
 * The mark, the headline, the sentence and the one action stack down the
 * middle in that order — which is the order they are read in — and the small
 * print sits under the action, where it answers "what will this actually do
 * to my files" for anyone who stops to ask.
 */
function SetupState({
  mark,
  title,
  body,
  actionIcon,
  actionLabel,
  onAction,
  note
}: {
  mark: string
  title: string
  body: string
  actionIcon: string
  actionLabel: string
  onAction(): void
  note: string
}): JSX.Element {
  return (
    <div className="flex flex-col items-center px-6 py-8 text-center">
      <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-r2 bg-bg-2">
        <Icon name={mark} size={22} className="codicon-muted" />
      </span>
      <h2 className="text-14 font-semibold text-c-1">{title}</h2>
      <p className="mt-1.5 max-w-[42ch] text-12 leading-relaxed text-c-2">{body}</p>
      <button
        type="button"
        onClick={onAction}
        className="mt-5 inline-flex h-8 items-center gap-1.5 rounded-10 bg-accent-1 px-3.5 text-12 font-medium text-white transition-colors hover:bg-accent-1/90 [&_.codicon::before]:!text-white"
      >
        <Icon name={actionIcon} size={12} />
        {actionLabel}
      </button>
      <p className="mt-5 max-w-[46ch] text-11 leading-relaxed text-c-2/70">{note}</p>
    </div>
  )
}
