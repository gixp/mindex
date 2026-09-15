import { useEffect, useState } from 'react'
import type { SyncStatus } from '@shared/types'
import { api } from '@/platform/api'

/**
 * Automatic-sync state from the main process.
 *
 * Same shape as `useUpdateStatus`: read once on mount, then follow the
 * broadcast. The initial read matters because the engine only broadcasts on
 * change, and a window opened after a vault has settled would otherwise show
 * nothing until the next five-minute tick.
 */
export function useSyncStatus(): SyncStatus | null {
  const [status, setStatus] = useState<SyncStatus | null>(null)

  useEffect(() => {
    let mounted = true
    void api()
      .sync.status()
      .then((r) => {
        if (mounted && r.ok && r.data) setStatus(r.data)
      })
    const off = api().on.syncStatus((s) => setStatus(s))
    return () => {
      mounted = false
      off()
    }
  }, [])

  return status
}
