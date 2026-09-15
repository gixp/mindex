import { useEffect, useMemo, useRef, useState } from 'react'
import type { GitHubOwner } from '@shared/types'
import { slugifyRepoName } from '@shared/github-url'
import { api } from '@/platform/api'
import { cn } from '@/ui/cn'
import { pickerOption } from '@/ui/picker-option'
import { useGitHubAuth } from '@/features/git/lib/useGitHubAuth'
import { useVaultStore } from '@/platform/workspace'
import { useGitStatusStore } from '@/features/git/store'
import { StandardDialog } from '@/ui/StandardDialog'
import { ActionButton } from '@/ui/action-button'
import { Icon } from '@/ui/icon'
import { Input } from '@/ui/input'
import { GitHubSignIn } from './GitHubSignIn'

/**
 * Publishing the open vault to a new GitHub repository.
 *
 * The name is checked against GitHub while the user types, because the
 * alternative is finding out it was taken *after* the vault has been turned
 * into a git repository — a state that is awkward to explain and annoying to
 * back out of.
 *
 * Private is the default, and deliberately so: a vault is someone's notes.
 * Making that choice for them in the other direction, once, silently, is not
 * a mistake they can take back.
 */

type NameCheck =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available' }
  | { kind: 'taken' }
  | { kind: 'error'; message: string }

export function PublishToGitHubDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange(open: boolean): void
}): JSX.Element {
  const auth = useGitHubAuth(open)
  const vault = useVaultStore((s) => s.vault)
  const refreshGit = useGitStatusStore((s) => s.refresh)

  const [owners, setOwners] = useState<GitHubOwner[]>([])
  const [ownersLoaded, setOwnersLoaded] = useState(false)
  const [owner, setOwner] = useState('')
  const [rawName, setRawName] = useState('')
  const [isPrivate, setIsPrivate] = useState(true)
  const [description, setDescription] = useState('')
  const [check, setCheck] = useState<NameCheck>({ kind: 'idle' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ htmlUrl: string; fullName: string } | null>(null)

  const name = useMemo(() => slugifyRepoName(rawName), [rawName])
  const signedIn = auth.state?.signedIn ?? false
  const authKnown = auth.state !== null

  // Seed the name from the vault folder — almost always what the user wants,
  // and it makes the common case a single click.
  useEffect(() => {
    if (!open) return
    // Left empty rather than seeded with the vault's name: a repository
    // name is public and permanent, and a field that arrives already filled
    // is a field people accept without reading.
    setRawName('')
    setError(null)
    setDone(null)
    setOwnersLoaded(false)
  }, [open, vault?.name])

  useEffect(() => {
    if (!open || !signedIn) return
    void api()
      .github.listOwners()
      .then((r) => {
        if (r.ok && r.data) {
          setOwners(r.data)
          setOwner((cur) => cur || (r.data?.[0]?.login ?? ''))
        }
        setOwnersLoaded(true)
      })
  }, [open, signedIn])

  // Debounced availability probe. The ref holds the request this effect
  // started, so an answer that arrives after the user has typed again is
  // dropped rather than shown against the wrong name.
  const probeRef = useRef(0)
  useEffect(() => {
    if (!open || !signedIn || !owner || !name) {
      setCheck({ kind: 'idle' })
      return
    }
    const id = ++probeRef.current
    setCheck({ kind: 'checking' })
    const timer = setTimeout(() => {
      void api()
        .github.checkName(owner, name)
        .then((r) => {
          if (probeRef.current !== id) return
          if (!r.ok) {
            setCheck({ kind: 'error', message: r.error ?? 'Could not check that name' })
            return
          }
          setCheck({ kind: r.data ? 'available' : 'taken' })
        })
    }, 400)
    return () => clearTimeout(timer)
  }, [open, signedIn, owner, name])

  async function publish(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const r = await api().github.publish({ owner, name, private: isPrivate, description })
      if (!r.ok || !r.data) {
        setError(r.error ?? 'Publishing failed')
        return
      }
      setDone({ htmlUrl: r.data.htmlUrl, fullName: r.data.fullName })
      await refreshGit()
    } finally {
      setBusy(false)
    }
  }

  const canPublish = signedIn && !!owner && !!name && check.kind === 'available' && !busy

  return (
    <StandardDialog
      open={open}
      onOpenChange={onOpenChange}
      icon="github"
      title="Publish to GitHub"
      subtitle="Sharing a vault needs a repository. Create one for it."
      width={520}
      height="auto"
    >
      <div className="flex flex-col gap-4">
        {done ? (
          <div className="rounded-[10px] border border-border bg-bg-3 p-4">
            <div className="flex items-center gap-2 text-[13px] font-medium text-foreground">
              <Icon name="check" size={14} className="text-emerald-400" />
              Published to {done.fullName}
            </div>
            {/* `window.open` rather than an IPC call: main's
                `setWindowOpenHandler` already routes it to the system
                browser, and `files.open` is `shell.openPath`, which does
                nothing useful with an https URL. */}
            <ActionButton
              size="sm"
              className="mt-3"
              onClick={() => window.open(done.htmlUrl, '_blank')}
            >
              Open on GitHub
            </ActionButton>
          </div>
        ) : !authKnown ? (
          // Whether this machine is signed in is a question for the main
          // process, and until it answers there is no honest thing to draw.
          // Drawing nothing meant the window opened at the height of an empty
          // box and then jumped to the height of a form — so it draws the
          // form's shape instead, at the form's height.
          <FormSkeleton />
        ) : !signedIn ? (
          <GitHubSignIn auth={auth} />
        ) : (
          <>
            <Field label="Owner">
              <div className="flex flex-col gap-1">
                {!ownersLoaded
                  ? // Two, because an account and one organisation is the
                    // common shape and the list has to occupy its height
                    // before it knows what is in it.
                    [0, 1].map((i) => <SkeletonBlock key={i} className="h-[38px]" />)
                  : null}
                {owners.map((o) => (
                  <button
                    key={o.login}
                    type="button"
                    onClick={() => setOwner(o.login)}
                    className={cn(
                      'flex items-center gap-2.5 rounded-12 border px-3 py-2 text-left text-[13px] transition-colors',
                      pickerOption(owner === o.login),
                      owner === o.login ? 'text-foreground' : 'text-muted-foreground'
                    )}
                  >
                    <Icon
                      name={o.kind === 'org' ? 'organization' : 'account'}
                      size={14}
                      className="codicon-inherit"
                    />
                    <span className="min-w-0 flex-1 truncate">{o.login}</span>
                    <Radio on={owner === o.login} />
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Repository name">
              {/* The answer sits in the field it is about, at the right edge,
                  the way a form tells you a field is wrong. Under the input it
                  was a separate line that moved as you typed. */}
              <div className="relative">
                <Input
                  value={rawName}
                  onChange={(e) => setRawName(e.target.value)}
                  placeholder="my-notes"
                  autoFocus
                  className="h-9 rounded-12 border-bd-1 px-3 pr-28 text-12.5 text-c-1 focus:border-bd-2"
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-11">
                  <NameStatus check={check} />
                </span>
              </div>
              <p className="mt-1 truncate text-11 text-c-2">
                {name ? (
                  <>
                    Will be created as <code className="text-c-1">{name}</code>
                  </>
                ) : (
                  'Letters, digits, dots, dashes and underscores.'
                )}
              </p>
            </Field>

            <Field label="Visibility">
              <div className="grid grid-cols-2 gap-2">
                <VisibilityCard
                  on={isPrivate}
                  onClick={() => setIsPrivate(true)}
                  title="Private"
                  hint="Only you and collaborators"
                />
                <VisibilityCard
                  on={!isPrivate}
                  onClick={() => setIsPrivate(false)}
                  title="Public"
                  hint="Anyone can see it"
                />
              </div>
            </Field>

            <Field label="Description (optional)">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this vault for?"
                rows={3}
                className="w-full resize-none rounded-12 border border-bd-1 bg-transparent px-3 py-2 text-12.5 text-c-1 outline-none transition-colors placeholder:text-c-2/60 focus:border-bd-2"
              />
            </Field>

            {/* Said before the button, not after: this is the step that puts
                the vault somewhere other people could reach. */}
            <p className="text-[11px] leading-relaxed text-muted-foreground/80">
              Everything in the vault is committed and pushed, except{' '}
              <code className="text-foreground">.mindex/</code> — chats, note history and comments
              stay on this machine.
            </p>

            {error ? <p className="text-[12px] text-red-400">{error}</p> : null}
          </>
        )}
      </div>

      {!done && signedIn ? (
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex h-8 items-center rounded-10 border border-bd-1 px-3 text-12 text-c-2 transition-colors hover:bg-bg-3 hover:text-c-1"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canPublish}
            onClick={() => void publish()}
            className="inline-flex h-8 items-center gap-1.5 rounded-10 bg-accent-1 px-3.5 text-12 font-medium text-white transition-colors hover:bg-accent-1/90 disabled:cursor-not-allowed disabled:bg-bg-2 disabled:text-c-2 [&_.codicon::before]:!text-white"
          >
            <Icon name={busy ? 'sync' : 'github'} size={12} />
            {busy ? 'Publishing…' : 'Publish'}
          </button>
        </div>
      ) : null}
    </StandardDialog>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div>
      <div className="mb-1.5 text-[12px] font-medium text-foreground">{label}</div>
      {children}
    </div>
  )
}

function Radio({ on }: { on: boolean }): JSX.Element {
  return (
    <span
      className={cn(
        'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border',
        on ? 'border-accent-1' : 'border-bd-2'
      )}
    >
      {on ? <span className="h-1.5 w-1.5 rounded-full bg-accent-1" /> : null}
    </span>
  )
}

function VisibilityCard({
  on,
  onClick,
  title,
  hint
}: {
  on: boolean
  onClick(): void
  title: string
  hint: string
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-start gap-2.5 rounded-12 border px-3 py-2 text-left transition-colors',
        pickerOption(on)
      )}
    >
      <div className="min-w-0 flex-1">
        <div className={cn('text-[13px]', on ? 'text-foreground' : 'text-muted-foreground')}>
          {title}
        </div>
        <div className="text-[11px] text-muted-foreground/70">{hint}</div>
      </div>
      <div className="pt-0.5">
        <Radio on={on} />
      </div>
    </button>
  )
}

function NameStatus({ check }: { check: NameCheck }): JSX.Element | null {
  if (check.kind === 'idle') return null
  if (check.kind === 'checking') {
    return <span className="shrink-0 text-muted-foreground/70">Checking…</span>
  }
  if (check.kind === 'available') {
    return (
      <span className="flex shrink-0 items-center gap-1 text-emerald-400">
        <Icon name="pass" size={11} className="codicon-inherit" />
        Available
      </span>
    )
  }
  if (check.kind === 'taken') {
    return <span className="shrink-0 text-amber-400">Already taken</span>
  }
  return <span className="shrink-0 text-red-400">{check.message}</span>
}

/**
 * A block standing in for something not loaded yet.
 *
 * Deliberately not animated into a shimmer: this is on screen for a fraction
 * of a second, and a moving thing that appears for a moment reads as a glitch
 * rather than as progress. It is here to hold a height, not to entertain.
 */
function SkeletonBlock({ className }: { className?: string }): JSX.Element {
  return <div className={cn('w-full rounded-12 bg-bg-2', className)} aria-hidden="true" />
}

/**
 * The form's shape before anything is known about the account.
 *
 * Matched to the real one field by field, so the window opens at the size it
 * will keep. Getting this wrong is worse than not having it: a placeholder
 * that is the wrong height produces the same jump it was added to remove.
 */
function FormSkeleton(): JSX.Element {
  return (
    <>
      <Field label="Owner">
        <div className="flex flex-col gap-1">
          <SkeletonBlock className="h-[38px]" />
          <SkeletonBlock className="h-[38px]" />
        </div>
      </Field>
      <Field label="Repository name">
        <SkeletonBlock className="h-9" />
        <div className="mt-1 h-[15px]" />
      </Field>
      <Field label="Visibility">
        <div className="grid grid-cols-2 gap-2">
          <SkeletonBlock className="h-[52px]" />
          <SkeletonBlock className="h-[52px]" />
        </div>
      </Field>
      <Field label="Description (optional)">
        <SkeletonBlock className="h-[74px]" />
      </Field>
      {/* Real text, not a grey block: it is true whatever the account turns
          out to be, and it is the one thing worth reading while waiting. */}
      <p className="text-11 leading-relaxed text-c-2/80">
        Everything in the vault is committed and pushed, except{' '}
        <code className="text-c-1">.mindex/</code> — chats, note history and comments stay on this
        machine.
      </p>
    </>
  )
}
