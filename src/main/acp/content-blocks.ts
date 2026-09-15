import path from 'node:path'

/**
 * A message as the protocol carries it, rather than as one long string.
 *
 * Attachments were pasted into the text as `@/absolute/path` lines and hoped
 * for. That is a guess dressed as a feature: whether those characters mean a
 * file is entirely up to the assistant reading them, and only one of the three
 * treats them as anything but words.
 *
 * The protocol has a block for exactly this and Mindex used none. A link block
 * carries the file's name and its address as data, so an assistant does not
 * have to recognise a convention to know a file was handed to it.
 *
 * Verified against the adapters on this machine rather than assumed: Claude's
 * turns a `file://` link into a named markdown link before the model sees it,
 * and Codex's accepts the block in its own schema. An adapter that does not is
 * no worse off than it was, because the text still says what was attached.
 */

export type PromptBlock =
  | { type: 'text'; text: string }
  | { type: 'resource_link'; name: string; uri: string; mimeType?: string }

/**
 * A file path as an address the protocol will accept.
 *
 * `uri` is validated as a URL at the far end, so a bare path is refused and a
 * path with a space in it has to be encoded. `pathToFileURL` is the only thing
 * that gets both right on every platform.
 */
export function fileLink(absPath: string): PromptBlock | null {
  const trimmed = absPath.trim()
  if (!trimmed || !path.isAbsolute(trimmed)) return null
  const name = path.basename(trimmed)
  if (!name) return null
  // Built by hand rather than with `pathToFileURL` so this stays a pure
  // function with no platform lookup — the shape is the same and the encoding
  // is the part that matters.
  const encoded = trimmed.split(path.sep).map(encodeURIComponent).join('/')
  // A POSIX path already begins with the separator, so encoding leaves a
  // leading slash; a Windows one starts at the drive and needs it added. Either
  // way the address has exactly three slashes after the scheme.
  const rooted = encoded.startsWith('/') ? encoded : `/${encoded}`
  return { type: 'resource_link', name, uri: `file://${rooted}` }
}

/**
 * The blocks for one turn: what was attached, then what was typed.
 *
 * Attachments lead because they are the subject the words are about — and
 * because a model reading in order should know what it is holding before it is
 * asked to do something with it.
 *
 * A path that is not absolute is dropped rather than guessed at. Everything
 * here comes from a file picker or the open editor, so a relative one means a
 * caller that has not resolved it, and inventing a root would be worse than
 * sending one fewer link.
 */
export function promptBlocks(text: string, attachments: string[] = []): PromptBlock[] {
  const links = attachments.map(fileLink).filter((b): b is PromptBlock => b !== null)
  const body = text.trim()
  // Never an empty prompt: an adapter given no blocks at all has nothing to
  // answer, and "here are three files" with no question is still a turn.
  if (!body && links.length === 0) return [{ type: 'text', text }]
  return body ? [...links, { type: 'text', text }] : links
}
