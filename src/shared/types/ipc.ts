/** The envelope every request between the two halves comes back in. */

export interface IpcResult<T> {
  ok: boolean
  data?: T
  error?: string
  /**
   * Machine-readable failure reason, set only by errors that the renderer has
   * to tell apart from a generic failure (see `IpcErrorCode`). Absent for
   * everything else — `error` alone stays the human-readable message.
   */
  code?: IpcErrorCode
}

/**
 * `WRITE_CONFLICT` — the file changed on disk since the caller last read it,
 * so the write was refused rather than silently overwriting someone else's
 * edit. The caller decides: overwrite anyway, or reload.
 *
 * `BAD_REQUEST` — the arguments did not match what the operation declares, so
 * nothing ran. This is a bug in the window or a build mismatch between the two
 * halves, never something a person did; it is a code rather than a plain
 * message so a caller can tell it apart from a genuine refusal.
 */
export type IpcErrorCode = 'WRITE_CONFLICT' | 'BAD_REQUEST'
