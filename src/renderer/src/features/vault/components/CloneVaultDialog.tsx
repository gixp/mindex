import { useEffect, useState, type ReactNode } from 'react'
import { ActionButton } from '@/ui/action-button'
import { StandardDialog } from '@/ui/StandardDialog'
import { useVaultStore } from '@/platform/workspace'
import { api } from '@/platform/api'
import { cn } from '@/ui/cn'
import { useGitHubAuth } from '@/features/git/lib/useGitHubAuth'
import { toCloneUrl } from '@shared/github-url'
import { GitHubRepoPicker } from '@/features/git/components/GitHubRepoPicker'
import { GitHubSignIn } from '@/features/git/components/GitHubSignIn'

interface Props {
  open: boolean
  onOpenChange(open: boolean): void
}

// Same field styling as the bug-report form, so every dialog in the app reads
// as one form language rather than each inventing its own inputs.
const inputCls =
  'w-full rounded-12 border border-bd-1 bg-transparent px-3 py-2 text-12.5 text-c-1 outline-none transition-colors placeholder:text-c-2/60 focus:border-bd-2'

function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: ReactNode
}): JSX.Element {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[12px] font-medium text-foreground">{label}</span>
        {hint ? <span className="text-[11px] text-muted-foreground/70">{hint}</span> : null}
      </div>
      {children}
    </div>
  )
}

function repoNameFromUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '')
  const last = trimmed.split(/[/:]/).pop() ?? ''
  return last.replace(/\.git$/i, '')
}

function shortPath(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, '~')
}

/**
 * Clone a remote repository and open it as a vault.
 *
 * The parent folder and the folder name are separate fields rather than one
 * editable full path: the parent comes from the native picker (there is no
 * sane way to type-check a path by hand), while the name is the one part
 * worth editing, and it defaults to the repository's own name.
 *
 * The first field takes a URL, `owner/repo`, or a search over the repositories
 * you own — signed in to GitHub, you should not have to go and look up the
 * address of something that is already yours. Signing in is offered, never
 * required: pasting a URL works exactly as it did before, including for hosts
 * that are not GitHub at all.
 */
export function CloneVaultDialog({ open, onOpenChange }: Props): JSX.Element {
  const cloneVault = useVaultStore((s) => s.cloneVault)
  const loading = useVaultStore((s) => s.loading)
  const storeError = useVaultStore((s) => s.error)

  const auth = useGitHubAuth(open)
  const signedIn = auth.state?.signedIn ?? false

  const [url, setUrl] = useState('')
  const [showSignIn, setShowSignIn] = useState(false)
  const [parentDir, setParentDir] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [touchedName, setTouchedName] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Clear whatever the last attempt left behind, so a stale error from a
  // previous clone never greets the next one.
  useEffect(() => {
    if (!open) return
    setError(null)
    setShowSignIn(false)
    useVaultStore.setState({ error: null })
  }, [open])

  const suggested = repoNameFromUrl(url)
  const folderName = touchedName ? name : suggested
  const destDir = parentDir && folderName ? `${parentDir}/${folderName}` : null
  const canSubmit = url.trim().length > 0 && !!destDir && !loading

  async function pickParent(): Promise<void> {
    const r = await api().vault.pickRootDialog()
    if (r.ok && r.data) setParentDir(r.data.root)
  }

  async function submit(): Promise<void> {
    if (!canSubmit || !destDir) return
    setError(null)
    await cloneVault(toCloneUrl(url), destDir)
    const err = useVaultStore.getState().error
    if (err) {
      setError(err)
      return
    }
    onOpenChange(false)
    setUrl('')
    setParentDir(null)
    setName('')
    setTouchedName(false)
  }

  return (
    <StandardDialog
      open={open}
      onOpenChange={onOpenChange}
      icon="repo-clone"
      title="Clone Git repository"
      width={520}
      height="auto"
    >
      <div className="space-y-4 overflow-y-auto">
        <Field label="Repository">
          <GitHubRepoPicker
            autoFocus
            value={url}
            onChange={setUrl}
            // Setting the URL is enough: the folder name is derived from it
            // by `repoNameFromUrl` for as long as the user has not typed one
            // of their own.
            onPick={(repo) => setUrl(repo.cloneUrl)}
            signedIn={signedIn}
            className={inputCls}
          />
          {!signedIn ? (
            showSignIn ? (
              <div className="pt-2">
                <GitHubSignIn auth={auth} />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowSignIn(true)}
                className="pt-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                Connect GitHub to search your own repositories
              </button>
            )
          ) : null}
        </Field>

        <Field label="Location">
          <div className="flex gap-2">
            <input
              value={parentDir ? shortPath(parentDir) : ''}
              readOnly
              placeholder="Choose a folder…"
              className={cn(inputCls, 'cursor-default')}
            />
            <ActionButton onClick={() => void pickParent()}>Browse…</ActionButton>
          </div>
        </Field>

        <Field label="Folder name">
          <input
            value={folderName}
            onChange={(e) => {
              setTouchedName(true)
              setName(e.target.value)
            }}
            placeholder={suggested || 'repository'}
            className={inputCls}
          />
        </Field>

        {destDir ? (
          <p className="text-[11px] text-muted-foreground/70">
            Clones into{' '}
            <span className="font-mono text-muted-foreground">{shortPath(destDir)}</span>
          </p>
        ) : null}

        {(error ?? storeError) ? (
          <p className="text-[12px] text-destructive">{error ?? storeError}</p>
        ) : null}

        <div className="flex items-center justify-end pt-1">
          <ActionButton tone="primary" disabled={!canSubmit} onClick={() => void submit()}>
            {loading ? 'Cloning…' : 'Clone'}
          </ActionButton>
        </div>
      </div>
    </StandardDialog>
  )
}
