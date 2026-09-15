export interface QuietGateConfig {
  quietMs: number
  maxWaitMs: number
  pollMs: number
}

export interface QuietGate {
  markActivity(): void
  waitForQuiet(signal: AbortSignal): Promise<void>
}

/**
 * Waits until nothing relevant has changed for `quietMs` — so a burst of
 * changes (git pull, bulk import) settles into one wave instead of firing
 * the moment each individual timer happens to expire. Capped at `maxWaitMs`
 * so constant background activity can't starve a job indefinitely.
 */
export function createQuietGate(config: QuietGateConfig): QuietGate {
  let lastActivityAt = 0

  return {
    markActivity() {
      lastActivityAt = Date.now()
    },
    waitForQuiet(signal: AbortSignal): Promise<void> {
      const startedAt = Date.now()
      return new Promise((resolve, reject) => {
        if (signal.aborted) {
          reject(new Error('aborted'))
          return
        }
        const onAbort = (): void => {
          clearInterval(timer)
          reject(new Error('aborted'))
        }
        const timer = setInterval(() => {
          const quietFor = Date.now() - lastActivityAt
          const waitedFor = Date.now() - startedAt
          if (quietFor >= config.quietMs || waitedFor >= config.maxWaitMs) {
            clearInterval(timer)
            signal.removeEventListener('abort', onAbort)
            resolve()
          }
        }, config.pollMs)
        signal.addEventListener('abort', onAbort, { once: true })
      })
    }
  }
}
