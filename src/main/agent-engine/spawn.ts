export const DEFAULT_ENGINE_TIMEOUT_MS = 120_000

/** True for ENOENT — the binary itself was not found. Shared with `git/spawn.ts`. */
export function isCliMissing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === 'ENOENT'
}
