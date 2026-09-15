/**
 * What this build was configured with, and what is missing.
 *
 * Three integrations are configured by baking a value in at build time, and
 * each place that reads one used to decide on its own what to do when it was
 * blank. Most returned, silently, which is how a release shipped with several
 * features absent and nothing anywhere saying so.
 *
 * A blank value is not the defect — a build from a clone *should* have blank
 * values, and every one of these integrations is optional by design. The
 * defect is a build that looks complete and is not.
 *
 * What stops that now is the release pipeline, which refuses to publish when
 * any of these is empty. There was a card in the app's diagnostics saying the
 * same thing; it is gone. Once the pipeline cannot ship a build with a gap, a
 * released copy could never have anything to report — so that card only ever
 * spoke to someone building from a clone, in a screen written for everyone
 * else. The two places a gap is actually felt say so themselves, in their own
 * words: bug reporting and GitHub sign-in both refuse with a sentence.
 *
 * These are publishable keys, not credentials — analytics and crash-report
 * keys are meant to be visible in a client, and what protects the data is the
 * rules on the far end. That is why they can be baked into a bundle whose
 * source is published at all. It is not a reason to commit them to the
 * repository: they reach the build from the pipeline's own settings.
 *
 * There used to be a fourth, a database address and key. It is gone — see
 * main/feedback for where the last thing that needed it went.
 */

/** The value compiled in, or '' when the build was made without one. */
const BUILT_IN = {
  analyticsKey: process.env.MINDEX_POSTHOG_KEY ?? '',
  analyticsHost: process.env.MINDEX_POSTHOG_HOST ?? '',
  crashReportsDsn: process.env.MINDEX_SENTRY_DSN ?? '',
  githubClientId: process.env.MINDEX_GITHUB_CLIENT_ID ?? ''
} as const

/** Where analytics go when the build did not name a host. */
const ANALYTICS_HOST_FALLBACK = 'https://us.i.posthog.com'

export function analyticsKey(): string {
  return BUILT_IN.analyticsKey
}

export function analyticsHost(): string {
  return BUILT_IN.analyticsHost || ANALYTICS_HOST_FALLBACK
}

export function crashReportsDsn(): string {
  return BUILT_IN.crashReportsDsn
}

export function githubClientId(): string {
  return BUILT_IN.githubClientId
}
