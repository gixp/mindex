import { app } from 'electron'
import { PostHog } from 'posthog-node'
import { ensureAnalyticsIdentity, getAppSettings } from '@main/settings/app-settings'
import { analyticsHost, analyticsKey } from '@main/config'

/**
 * Product analytics.
 *
 * Two rules shape this file, and both exist because of what Mindex is:
 *
 * 1. **Consent.** Unlike the install record, this is opt-out and off the
 *    moment the user says so. The audience picked a local-first notes app on
 *    purpose; silently measuring them would trade the product's whole claim
 *    for a funnel chart.
 * 2. **An allowlist, not a convention.** `EVENTS` below is the complete set of
 *    things that can ever be sent, and properties are whitelisted per event.
 *    A convention ("just don't send note content") survives exactly as long as
 *    nobody is in a hurry; a list that rejects unknown keys survives.
 *
 * Runs in the main process: `posthog-node` rather than `posthog-js`, since the
 * renderer's `connect-src` forbids it from calling out, and keys should not be
 * in the renderer bundle anyway.
 */

const KEY = analyticsKey()
const HOST = analyticsHost()

/**
 * Every event the app may send, with the properties allowed on each.
 *
 * The names are NOT new. Product telemetry existed before (commit 8aec597,
 * removed in 2306b1f) and installed builds are still reporting into this same
 * PostHog project. Inventing a parallel vocabulary — `app.launched` next to
 * `app_opened` — would split one metric across two unrelated series and make
 * the history worthless. Continuity beats tidier naming.
 */
export const EVENTS = {
  app_opened: ['os', 'arch', 'is_first_run'],
  app_closed: ['session_seconds'],
  vault_opened: ['note_count'],
  note_created: ['type'],
  search_used: []
  // `feature_used` and `chat_message_sent` were declared here and fired from
  // nowhere — graphs that are permanently empty are worse than absent ones,
  // because they read as "nobody does this". Removed rather than faked:
  //   * chat runs through a PTY-backed Claude session, where a "message" is
  //     keystrokes into a terminal, not an event main can observe;
  //   * `feature_used` had no defined meaning to attach to a call site.
  // Add either back the same day something real emits it.
} as const

export type EventName = keyof typeof EVENTS

let client: PostHog | null = null
let installId = ''
let enabled = false
let sessionStart = 0

/**
 * Whether the person has left this on.
 *
 * This was stubbed to always return true for the closed beta, which made the
 * switch in Settings cosmetic — a stored refusal changed nothing. Restored:
 * the control controls again. Shipping a switch that does not switch is the
 * thing that costs trust when somebody notices, and in a closed-source app
 * nobody can check the source to find out.
 *
 * Absent still means on, because that is what every existing install has on
 * disk and flipping them all off silently would be its own surprise. Asking
 * once, on first run, and defaulting to off until answered is the next step
 * and needs a screen, not a line here.
 */
async function isAllowed(): Promise<boolean> {
  return (await getAppSettings()).analytics?.enabled !== false
}

export async function initAnalytics(): Promise<void> {
  if (!KEY) return
  enabled = await isAllowed()
  if (!enabled) return

  const identity = await ensureAnalyticsIdentity()
  installId = identity.installId
  sessionStart = Date.now()
  client = new PostHog(KEY, {
    host: HOST,
    // Desktop sessions are long and quiet; flush on a short timer so a crash
    // does not swallow the last few events.
    flushAt: 5,
    flushInterval: 10_000
  })

  capture('app_opened', {
    os: process.platform,
    arch: process.arch,
    is_first_run: identity.isFirstRun
  })
}

/** Re-read consent after the user changes the setting, without a restart. */
export async function refreshAnalyticsConsent(): Promise<void> {
  const allowed = await isAllowed()
  if (allowed === enabled) return
  enabled = allowed
  if (!allowed) {
    await shutdownAnalytics()
    return
  }
  await initAnalytics()
}

/**
 * Send an event. Unknown names and unknown properties are dropped rather than
 * forwarded — the allowlist is the safety net, so it has to be enforced here
 * and not merely documented.
 */
export function capture(event: EventName, props: Record<string, unknown> = {}): void {
  if (!client || !enabled) return
  const allowed = EVENTS[event] as readonly string[] | undefined
  if (!allowed) return

  const properties: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(props)) {
    if (!allowed.includes(k)) continue
    // Only primitives cross the boundary: an object could carry anything.
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      properties[k] = v
    }
  }
  properties.app_version = app.getVersion()

  client.capture({ distinctId: installId, event, properties })
}

export async function shutdownAnalytics(): Promise<void> {
  if (!client) return
  if (sessionStart) {
    capture('app_closed', { session_seconds: Math.round((Date.now() - sessionStart) / 1000) })
  }
  const c = client
  client = null
  try {
    await c.shutdown()
  } catch {
    // Best effort on quit — never block the app from closing.
  }
}
