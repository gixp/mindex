import { useEffect, useState } from 'react'
import type { UpdateStatus } from '@shared/types'
import { api } from '@/platform/api'

/**
 * The live update state broadcast by the main process.
 *
 * Read once on mount and then kept current by the `updateStatus` event — the
 * initial read matters because the broadcast only fires on change, and a
 * window that opened after the launch check would otherwise sit on nothing
 * until the next five-minute poll.
 *
 * `null` until the first read resolves.
 */
export function useUpdateStatus(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null)

  useEffect(() => {
    let mounted = true
    void api()
      .update.getStatus()
      .then((r) => {
        if (mounted && r.ok && r.data) setStatus(r.data)
      })
    const off = api().on.updateStatus((s) => setStatus(s))
    return () => {
      mounted = false
      off()
    }
  }, [])

  return status
}
