import type { NoteTypeDef } from '@shared/note-types'
import { producesMarkdown, withNoteExtension } from '@shared/note-types'

/**
 * Where a captured note will actually land, worked out before it is written.
 *
 * The capture window used to show a title and a folder and then hand both to
 * the main process, which resolved them through the chosen type's filename
 * pattern. Nobody saw the result until the note existed — so a pattern that
 * produced no extension, or a name already taken, was discovered afterwards:
 * once as a file that was not a note, once as a four-second toast.
 *
 * This is the same resolution, done where it can still be corrected. It is
 * deliberately a *preview* and not the authority — `createNote` resolves the
 * path itself, from the same rules, and remains the thing that decides. Two
 * implementations of one rule would drift, which is why both sides call
 * `withNoteExtension` rather than each appending `.md` their own way.
 */

/** The same substitutions `computeRelativePath` makes, in the same order. */
function fillPattern(pattern: string, title: string): string {
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const datetime = `${date}-${pad(now.getHours())}${pad(now.getMinutes())}`
  return pattern
    .replace('{{title}}', sanitize(title))
    .replace('{{date}}', date)
    .replace('{{datetime}}', datetime)
}

/** The characters a filename cannot carry, replaced the way the writer does. */
function sanitize(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '-').trim()
}

/**
 * The vault-relative path a draft would be written to.
 *
 * `null` when there is nothing to resolve yet — an empty title, or a type the
 * vault does not define — which the window shows as nothing rather than as a
 * guess.
 */
export function draftPath(
  defs: NoteTypeDef[],
  typeId: string,
  title: string,
  folder: string
): string | null {
  const def = defs.find((d) => d.id === typeId)
  if (!def || !title.trim()) return null
  const base = folder.trim() || def.defaultFolder
  const name = fillPattern(def.filenamePattern, title)
  const joined = base ? `${base.replace(/\/+$/, '')}/${name}` : name
  return withNoteExtension(joined)
}

/**
 * The types a captured note can be filed as.
 *
 * Only those that write a markdown file. `asset` is a real type whose pattern
 * ends in `{{title}}` on purpose — an asset takes its extension from its own
 * name — and a captured passage has no such name, so filing one under it wrote
 * a file with no extension at all. The main process filters the same way before
 * the assistant ever sees the list; this is the same rule on the window, so the
 * picker cannot offer what the writer would refuse.
 */
export function fileableTypes(defs: NoteTypeDef[]): NoteTypeDef[] {
  return defs.filter((d) => producesMarkdown(d.filenamePattern))
}

/**
 * Whether what was handed in is nothing but an address.
 *
 * The window says which of the two things it is holding, because they are
 * handled differently — the page behind an address is fetched and read before
 * anything is written. The main process makes the same judgement for the same
 * reason (`ai/web-page.ts`); this one only decides what the window says, so a
 * disagreement at the margins costs a wrong label and nothing else.
 */
export function isLoneUrl(text: string): boolean {
  const trimmed = text.trim()
  if (/\s/.test(trimmed)) return false
  try {
    const url = new URL(trimmed)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * A source address as something short enough to sit on a chip.
 *
 * `new URL(...)` throws on anything that is not one, and this used to be called
 * bare inside render — so a source that did not parse took the whole window
 * down with it rather than showing a slightly worse chip.
 */
export function sourceLabel(source: string): string {
  try {
    return new URL(source).hostname
  } catch {
    return source.length > 40 ? `${source.slice(0, 39)}…` : source
  }
}
