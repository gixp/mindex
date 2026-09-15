import { useCallback, useEffect, useState } from 'react'
import type { GitHubAuthState, GitHubDeviceCode } from '@shared/types'
import { api } from '@/platform/api'

export interface GitHubAuth {
  state: GitHubAuthState | null
  /** The code to type into github.com, while a device sign-in is in flight. */
  deviceCode: GitHubDeviceCode | null
  error: string | null
  busy: boolean
  signIn(): Promise<void>
  signOut(): Promise<void>
  refresh(): Promise<void>
}

/**
 * GitHub sign-in state, shared by the Publish and Clone dialogs.
 *
 * The device flow finishes in the browser, so completion arrives as a
 * `githubAuth` broadcast rather than from the `signIn()` call — which returns
 * as soon as there is a code to show. That is why this is a subscription and
 * not a promise: the answer comes from somewhere else, minutes later.
 */
export function useGitHubAuth(active = true): GitHubAuth {
  const [state, setState] = useState<GitHubAuthState | null>(null)
  const [deviceCode, setDeviceCode] = useState<GitHubDeviceCode | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const r = await api().github.authState()
    if (r.ok && r.data) setState(r.data)
  }, [])

  useEffect(() => {
    if (!active) return
    void refresh()
    return api().on.githubAuth((next) => {
      setState(next)
      // The code has been used; leaving it on screen would invite a second,
      // now-meaningless attempt.
      if (next.signedIn) setDeviceCode(null)
    })
  }, [active, refresh])

  const signIn = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await api().github.signIn()
      if (!r.ok) {
        setError(r.error ?? 'Could not start the GitHub sign-in')
        return
      }
      setDeviceCode(r.data ?? null)
    } finally {
      setBusy(false)
    }
  }, [])

  const signOut = useCallback(async () => {
    setBusy(true)
    try {
      const r = await api().github.signOut()
      if (r.ok && r.data) setState(r.data)
      setDeviceCode(null)
    } finally {
      setBusy(false)
    }
  }, [])

  return { state, deviceCode, error, busy, signIn, signOut, refresh }
}
