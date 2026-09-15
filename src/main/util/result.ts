import type { IpcErrorCode, IpcResult } from '@shared/types'

/**
 * An error whose reason the renderer has to act on, not just display.
 *
 * `safe()` copies `code` onto the result so the other side can branch on it
 * without string-matching the message.
 */
export class CodedError extends Error {
  readonly code: IpcErrorCode

  constructor(code: IpcErrorCode, message: string) {
    super(message)
    this.name = 'CodedError'
    this.code = code
  }
}

/**
 * The file changed on disk after the caller read it. Carries both timestamps
 * so the UI can say *when*, rather than just that something happened.
 */
export class WriteConflictError extends CodedError {
  readonly expectedMtime: number
  readonly actualMtime: number

  constructor(expectedMtime: number, actualMtime: number) {
    super('WRITE_CONFLICT', 'File changed on disk since it was last read')
    this.name = 'WriteConflictError'
    this.expectedMtime = expectedMtime
    this.actualMtime = actualMtime
  }
}

export function ok<T>(data: T): IpcResult<T> {
  return { ok: true, data }
}

export function err<T>(error: unknown): IpcResult<T> {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error'
  const result: IpcResult<T> = { ok: false, error: message }
  if (error instanceof CodedError) result.code = error.code
  return result
}

export async function safe<T>(fn: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    return ok(await fn())
  } catch (e) {
    return err<T>(e)
  }
}
