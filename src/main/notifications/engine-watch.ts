import { addEngineListener } from '@main/agent-engine'
import { notifyEngineSyncComplete, notifyEngineJobFailed } from './service'

const TRACKED_FEATURES = new Set(['folder-context', 'living-index'])
const IDLE_DEBOUNCE_MS = 2_000
const FAILURE_RATE_LIMIT_MS = 30_000

let started = false

export function startEngineNotificationWatch(): () => void {
  if (started) return () => undefined
  started = true

  const inFlight = new Set<string>()
  let finishedSinceBusy = 0
  let idleTimer: NodeJS.Timeout | null = null
  let lastFailureNotifiedAt = 0

  const off = addEngineListener({
    kind: 'job',
    cb: (info) => {
      if (!TRACKED_FEATURES.has(info.feature)) return

      if (info.status === 'running') {
        inFlight.add(info.id)
        if (idleTimer) {
          clearTimeout(idleTimer)
          idleTimer = null
        }
        return
      }

      if (info.status === 'success' || info.status === 'failed' || info.status === 'cancelled') {
        const wasTracked = inFlight.delete(info.id)
        if (info.status === 'success' && wasTracked) finishedSinceBusy += 1

        if (info.status === 'failed') {
          const now = Date.now()
          if (now - lastFailureNotifiedAt > FAILURE_RATE_LIMIT_MS) {
            lastFailureNotifiedAt = now
            notifyEngineJobFailed(info.feature, info.errorMessage ?? 'job failed')
          }
        }

        if (inFlight.size === 0 && finishedSinceBusy > 0) {
          if (idleTimer) clearTimeout(idleTimer)
          idleTimer = setTimeout(() => {
            idleTimer = null
            if (inFlight.size === 0 && finishedSinceBusy > 0) {
              notifyEngineSyncComplete(finishedSinceBusy)
              finishedSinceBusy = 0
            }
          }, IDLE_DEBOUNCE_MS)
        }
      }
    }
  })

  return () => {
    off()
    if (idleTimer) clearTimeout(idleTimer)
    started = false
  }
}
