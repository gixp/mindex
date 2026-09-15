import { useEffect, useMemo, useRef, useState } from 'react'
import type { GitHubRepoSummary } from '@shared/types'
import { api } from '@/platform/api'
import { looksLikeRepoRef } from '@shared/github-url'
import { cn } from '@/ui/cn'
import { Icon } from '@/ui/icon'

/**
 * One field that accepts three things: a clone URL, `owner/repo`, or the
 * beginning of a repository name you own.
 *
 * Pasting a URL was the only way to clone before this, which is fine right up
 * until the repository is yours — at which point you have to leave the app,
 * find it on GitHub, and copy an address you should never have had to see.
 *
 * The list is fetched once when the field is first focused, not on mount: a
 * user who is pasting a URL should not pay for a hundred-repository request
 * they will never look at.
 */

export function GitHubRepoPicker({
  value,
  onChange,
  onPick,
  signedIn,
  className,
  autoFocus
}: {
  value: string
  onChange(next: string): void
  onPick(repo: GitHubRepoSummary): void
  signedIn: boolean
  className?: string
  autoFocus?: boolean
}): JSX.Element {
  const [repos, setRepos] = useState<GitHubRepoSummary[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [openList, setOpenList] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  async function ensureLoaded(): Promise<void> {
    if (!signedIn || repos !== null || loading) return
    setLoading(true)
    try {
      const r = await api().github.listRepos()
      setRepos(r.ok && r.data ? r.data : [])
    } finally {
      setLoading(false)
    }
  }

  // Close on a click anywhere else — the list is a popup over the form, and
  // leaving it open while the user works below it would cover the fields.
  useEffect(() => {
    if (!openList) return
    const onDown = (e: MouseEvent): void => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpenList(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [openList])

  const matches = useMemo(() => {
    if (!repos) return []
    const q = value.trim().toLowerCase()
    // A pasted URL is not a search term — showing "no matches" underneath a
    // perfectly valid address reads as a rejection of it.
    if (looksLikeRepoRef(value)) return []
    if (!q) return repos.slice(0, 40)
    return repos.filter((r) => r.fullName.toLowerCase().includes(q)).slice(0, 40)
  }, [repos, value])

  const showList = openList && signedIn && (loading || matches.length > 0)

  return (
    <div ref={wrapRef} className="relative">
      <input
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setOpenList(true)
        }}
        onFocus={() => {
          setOpenList(true)
          void ensureLoaded()
        }}
        placeholder={
          signedIn
            ? 'Paste URL, owner/repo, or search your repos'
            : 'https://github.com/user/repo.git'
        }
        className={className}
      />

      {showList ? (
        <div className="absolute left-0 right-0 top-full z-dialog mt-1 max-h-[260px] overflow-y-auto rounded-[10px] border border-bd-2 bg-bg-2 py-1 shadow-s2">
          {loading ? (
            <div className="px-3 py-2 text-[12px] text-muted-foreground">Loading your repos…</div>
          ) : (
            matches.map((repo) => (
              <button
                key={repo.fullName}
                type="button"
                onClick={() => {
                  onPick(repo)
                  setOpenList(false)
                }}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-muted-foreground',
                  'transition-colors hover:bg-bg-3 hover:text-foreground',
                  '[&:hover_.codicon]:!text-foreground'
                )}
              >
                <Icon
                  name={repo.private ? 'lock' : 'repo'}
                  size={12}
                  className="shrink-0 codicon-inherit"
                />
                <span className="min-w-0 flex-1 truncate">{repo.fullName}</span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}
