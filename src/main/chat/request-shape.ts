import type { RequestShape, RequestOutput } from '@shared/chat'

/**
 * Turning the composer's three rows into the words that carry them.
 *
 * The rule this file exists to obey: **a setting is something we say to the
 * assistant, unless the provider gives a real handle for it.** Scope has one
 * handle — Mindex's own vault tools refuse outside it (`mcp/scope.ts`) — and
 * the sentence here is what tells the assistant *why* a refusal happened
 * rather than leaving it to guess. Everything else is only the sentence.
 *
 * It lives in the app half rather than the window for two reasons. This is
 * where a message is finally assembled, beside the standing rules it will sit
 * next to; and it is reachable by a test without a DOM, which the window's
 * copy was not.
 *
 * ## The one rule worth keeping
 *
 * Every value at its ordinary setting produces **nothing at all**. The common
 * message is exactly the message that was typed, with no preamble, no blank
 * lines, and no instruction the person did not ask for.
 */

/** Bigger than this and a file name stops being a name. */
const MAX_NAME = 80

export const MIN_WORDS = 10
export const MAX_WORDS = 5000

export function clampWords(n: number | undefined): number {
  if (!Number.isFinite(n)) return 200
  return Math.min(MAX_WORDS, Math.max(MIN_WORDS, Math.round(n as number)))
}

/** The folder a note lives in, vault-relative. Empty at the root. */
export function folderOf(relPath: string): string {
  const at = relPath.lastIndexOf('/')
  return at === -1 ? '' : relPath.slice(0, at)
}

/** A note's name without its extension, safe to build a file name from. */
function baseName(relPath: string): string {
  const last = relPath.slice(relPath.lastIndexOf('/') + 1)
  const dot = last.lastIndexOf('.')
  const stem = dot > 0 ? last.slice(0, dot) : last
  return stem.slice(0, MAX_NAME).trim()
}

/** The file extensions the second half of the Output list asks for. */
const FORMATS: Partial<Record<RequestOutput, { ext: string; what: string }>> = {
  docx: { ext: 'docx', what: 'a Word document' },
  xlsx: { ext: 'xlsx', what: 'an Excel spreadsheet' },
  pdf: { ext: 'pdf', what: 'a PDF' },
  md: { ext: 'md', what: 'a markdown file' }
}

function scopeLine(shape: RequestShape, note: string): string | null {
  const kind = shape.scope?.kind ?? 'vault'
  if (kind === 'vault' || !note) return null
  if (kind === 'note') {
    return (
      `Work from ${note} and anything attached to this message. The vault's own ` +
      `search and read tools will refuse anything else, so do not spend a turn trying.`
    )
  }
  const folder = folderOf(note)
  const where = folder || 'the vault root'
  return (
    `Work from the notes in ${where} and anything attached to this message. The ` +
    `vault's own search and read tools will refuse anything outside it.`
  )
}

function outputLine(shape: RequestShape, note: string): string | null {
  const output = shape.output ?? 'auto'
  if (output === 'auto') return null
  if (output === 'chat') {
    return 'Answer in the conversation. Do not write the answer into a note or a file.'
  }
  if (output === 'this-note') {
    return note ? `Write the answer into ${note} itself rather than in your reply.` : null
  }
  if (output === 'new-note') {
    return 'Put the answer in a new note in the vault rather than in your reply.'
  }

  // A format. Nothing here converts anything: the assistant writes the file
  // with its own tools, and knows these formats better than a writer this app
  // would have to keep working. What the sentence has to pin down is where the
  // file goes and what it is called, or the answer lands somewhere nobody
  // looks.
  const format = FORMATS[output]
  if (!format) return null
  const folder = note ? folderOf(note) : ''
  const where = folder ? `the ${folder} folder` : 'the vault root'
  const name = note ? baseName(note) : 'the answer'
  return (
    `Write the answer as ${format.what} using your own file tools. Save it in ` +
    `${where}, named after ${note ? `${name}` : 'what was asked for'}, ending in ` +
    `.${format.ext}. The file is the deliverable: when it is written, reply with ` +
    `where it went rather than repeating what is in it.`
  )
}

function lengthLine(shape: RequestShape): string | null {
  switch (shape.length ?? 'auto') {
    case 'auto':
      return null
    case 'sentence':
      return 'Answer in a single sentence.'
    case 'paragraph':
      return 'Answer in one paragraph.'
    case 'page':
      return 'Answer in about a page.'
    case 'words':
      return `Answer in about ${clampWords(shape.lengthWords)} words.`
    default:
      return null
  }
}

/**
 * The lines to put above a message, or an empty string when there are none.
 *
 * The note is vault-relative and is whatever was open when the message was
 * sent. Without one, the lines that would name a file are dropped rather than
 * guessed at: an instruction naming no file is worse than no instruction.
 */
export function buildRequestPreamble(shape: RequestShape | undefined, note: string): string {
  if (!shape) return ''
  const anchored = note.trim()
  return [scopeLine(shape, anchored), outputLine(shape, anchored), lengthLine(shape)]
    .filter((l): l is string => l !== null)
    .join('\n')
}

/** The message as it goes out: the instructions, then what was typed. */
export function withRequestShape(
  userText: string,
  shape: RequestShape | undefined,
  note: string
): string {
  const preamble = buildRequestPreamble(shape, note)
  return preamble ? `${preamble}\n\n${userText}` : userText
}
