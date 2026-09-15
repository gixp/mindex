import { app } from 'electron'
import * as Sentry from '@sentry/electron/main'
import type { BugReport } from '@shared/types'
import { getAppSettings } from '@main/settings/app-settings'
import { crashReportsDsn } from '@main/config'

/**
 * A bug report, typed by a person and sent because they pressed send.
 *
 * These used to go into a table of their own, which is why the app carried a
 * database client, an address, a key, and a schema — for one feature. That
 * client was removed on 2026-09-02: of the three jobs it did, two were already
 * being done better elsewhere (the release feed already publishes the version,
 * and the analytics event already carries the install id), and this was the
 * only one left holding it.
 *
 * Crash reporting is already configured, already has a place for reports a
 * human wrote, and already has the context that makes one useful — the version,
 * the platform, the breadcrumbs from the session it came out of. Sending here
 * means a report arrives attached to that rather than as a disconnected row.
 *
 * The category and the install id ride as tags, which is what they were for:
 * grouping, and matching a report against the same person's earlier one.
 */

export async function submitBugReport(report: BugReport): Promise<void> {
  if (!crashReportsDsn()) {
    throw new Error('Reporting is not configured in this build.')
  }

  const title = report.title?.trim() ?? ''
  const description = report.description?.trim() ?? ''
  if (!title && !description) {
    throw new Error('Please describe the issue before sending.')
  }

  const settings = await getAppSettings()
  const installId = settings.analytics?.installId ?? null

  // Title and description in one body: the feedback API takes a single
  // message, and splitting a report across a tag and a body would put half of
  // it where nobody reads prose.
  const message = title && description ? `${title}\n\n${description}` : title || description

  const id = Sentry.captureFeedback({
    message,
    email: report.email?.trim() || undefined,
    source: 'app',
    tags: {
      category: report.category,
      app_version: app.getVersion(),
      os: process.platform,
      ...(installId ? { install_id: installId } : {})
    }
  })

  // `captureFeedback` hands the report to the transport and returns an id
  // rather than waiting for delivery, so there is no status code to check. An
  // empty id is the one signal that nothing was accepted — an unconfigured or
  // shut-down client — and the person deserves to hear that rather than see a
  // success message for something that went nowhere.
  if (!id) {
    throw new Error('The report could not be sent. Please try again.')
  }

  // Flush before returning, so a person who reports a bug and immediately
  // quits does not lose it to the batching window.
  await Sentry.flush(3000).catch(() => undefined)
}
