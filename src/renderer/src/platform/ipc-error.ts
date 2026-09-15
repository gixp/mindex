/**
 * Turning a failed bridge call into something a person can act on.
 *
 * One failure needs saying plainly: the window asks for an operation the
 * running app does not know. Electron answers "No handler registered for
 * 'x:y'", which reads as a bug in the feature. It is not — it means the two
 * halves are from different builds, which in development happens whenever the
 * window reloads on a change and the app process does not, because only the
 * window is rebuilt in place.
 *
 * Left raw, this costs an afternoon every time, because the feature looks
 * broken and the code that would prove otherwise is correct.
 *
 * The same split has a second, worse shape. A handler missing from the app
 * process at least answers; a channel missing from the *bridge* does not exist
 * as a function at all, so the window throws `x is not a function` and takes
 * the view down with it before any of this runs. `platform/api.ts` catches
 * that one and answers with the message below, so both halves of one problem
 * read the same way.
 */
export const STALE_BUILD_MESSAGE =
  'This needs a newer version of the app than the one running. Restart Mindex (in development: stop and start the dev server — only the window reloads on a change, not the app itself).'

export function describeIpcFailure(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  if (/No handler registered/i.test(raw)) return STALE_BUILD_MESSAGE
  return raw
}
