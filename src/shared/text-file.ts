/** Any file in the vault, read as text. */
export interface TextFile {
  path: string
  /** Empty when `readable` is false — there was nothing safe to show. */
  content: string
  bytes: number
  /**
   * Whether this is text at all.
   *
   * False is an ordinary answer, not a failure: a vault holds images and
   * archives alongside its notes. Handing their bytes to a text editor
   * produces a screen of replacement characters, which looks exactly like a
   * corrupted file — so the editor offers Finder instead.
   */
  readable: boolean
  /** Why not, when it is not. */
  reason?: 'binary' | 'too-large'
}
