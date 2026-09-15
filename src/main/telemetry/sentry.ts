import * as Sentry from '@sentry/electron/main'
import { app } from 'electron'
import { ensureAnalyticsIdentity } from '@main/settings/app-settings'
import { scrubDeep, scrubText } from './scrub'
import { crashReportsDsn } from '@main/config'

// Crash and error reporting.
//
// Runs in the main process only: `@sentry/electron` routes renderer events
// through here over IPC, which is what makes it work at all under the
// renderer's `connect-src` policy — the renderer never opens a socket itself.
//
// Empty DSN is a supported state, not a bug: local builds and forks run
// without one and every call below turns into a no-op.
const DSN = crashReportsDsn()

let started = false

/**
 * The anonymous install id, resolved in the background.
 *
 * It ties several reports from one machine together without identifying the
 * person — the same id the install record uses. It is deliberately NOT awaited
 * before `Sentry.init()`: that await was reading a file, which yielded, which
 * let Electron's `ready` fire first, and the SDK refuses to initialise after
 * that point. The result was that Sentry never started at all, in any build
 * ever shipped, while the code around it looked correct.
 *
 * `beforeSend` is the only place the id is needed, and by the time an event
 * exists this has long since resolved.
 */
let installId: string | undefined
let identityPromise: Promise<void> | null = null

export function initSentry(): void {
  if (started || !DSN) return
  started = true

  identityPromise ??= ensureAnalyticsIdentity()
    .then((identity) => {
      installId = identity.installId
    })
    .catch(() => {
      // A report without an install id is still worth having.
    })

  Sentry.init({
    dsn: DSN,
    release: `mindex@${app.getVersion()}`,
    environment: app.isPackaged ? 'production' : 'development',
    // Errors only. Performance tracing would sample real usage patterns, which
    // is a product-analytics question and belongs in PostHog behind consent.
    tracesSampleRate: 0,
    // Never attach the machine's IP or user agent to a report.
    sendDefaultPii: false,

    beforeSend(event) {
      if (installId) event.user = { id: installId }
      // Strip the OS username Electron puts in `server_name`.
      delete event.server_name
      return scrubDeep(event)
    },

    beforeBreadcrumb(crumb) {
      if (crumb.message) crumb.message = scrubText(crumb.message)
      if (crumb.data) crumb.data = scrubDeep(crumb.data)
      return crumb
    }
  })
}

/** Report a handled error. Safe to call with no DSN configured. */
export function captureError(error: unknown, context?: Record<string, unknown>): void {
  if (!started) return
  Sentry.captureException(error, context ? { extra: scrubDeep(context) } : undefined)
}
