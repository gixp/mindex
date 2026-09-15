import { useEffect, useRef, useState } from 'react'
import { combineFrontmatterText, splitFrontmatterText } from './frontmatterText'

/**
 * The text Source mode is editing, and when it is re-read from the store.
 *
 * Source mode cannot simply render the store's body on every pass: the raw
 * buffer carries the frontmatter as literal YAML, and re-deriving it while
 * somebody is typing inside that block would reflow the line under their
 * caret. So the text is held here, and the question this hook exists to answer
 * is the narrow one — *when* is it stale.
 *
 * It used to be seeded once per file per mode, which left it wrong in three
 * ordinary situations: a tab that mounted before its file had been read (every
 * restored tab but the active one), a note edited in Preview and flipped back,
 * and a file that changed on disk underneath. Preview reads the store live and
 * was right in all three, so the two views simply disagreed.
 *
 * The rule now: the buffer records which body it reflects, and re-seeds
 * whenever the store moved away from it for any reason other than this
 * editor's own typing.
 */

type Frontmatter = Record<string, unknown>

export interface SourceBufferInput {
  path: string
  mode: 'edit' | 'preview'
  body: string
  frontmatter: Frontmatter | undefined
  /** The body, with any frontmatter block taken off it. */
  onBody(next: string): void
  /** Only called when the buffer actually holds a frontmatter block. */
  onFrontmatter(next: Frontmatter): void
}

export interface SourceBuffer {
  text: string
  change(next: string): void
}

export function useSourceBuffer({
  path,
  mode,
  body,
  frontmatter,
  onBody,
  onFrontmatter
}: SourceBufferInput): SourceBuffer {
  const [text, setText] = useState('')
  /** Which file and which body the text above reflects. */
  const syncedRef = useRef<{ path: string; body: string } | null>(null)
  const lastModeRef = useRef(mode)

  const onBodyRef = useRef(onBody)
  onBodyRef.current = onBody
  const onFrontmatterRef = useRef(onFrontmatter)
  onFrontmatterRef.current = onFrontmatter
  // Read at the moment of a seed, never depended on. See below.
  const frontmatterRef = useRef(frontmatter)
  frontmatterRef.current = frontmatter

  useEffect(() => {
    const entered = lastModeRef.current !== mode
    lastModeRef.current = mode
    if (mode !== 'edit') return

    // Entering Source is the one moment the frontmatter is re-read.
    //
    // Not on every change to it, deliberately. Saving replaces the note's meta
    // with whatever the main process serialised, and a value does not always
    // survive that round trip byte for byte — a date comes back as a different
    // string. Re-seeding on it would rewrite a line somebody may still have a
    // caret in. The panel that edits frontmatter by hand only exists in
    // Preview, so arriving here is when its result has to be picked up.
    const synced = syncedRef.current
    if (!entered && synced && synced.path === path && synced.body === body) return

    syncedRef.current = { path, body }
    setText(combineFrontmatterText(frontmatterRef.current ?? {}, body))
  }, [path, mode, body])

  function change(next: string): void {
    setText(next)
    const parsed = splitFrontmatterText(next)
    // Recorded before the store is told, so the value coming back around is
    // recognised as this editor's own and leaves the typed text alone.
    syncedRef.current = { path, body: parsed ? parsed.body : next }
    if (parsed) {
      onBodyRef.current(parsed.body)
      onFrontmatterRef.current(parsed.data)
    } else {
      onBodyRef.current(next)
    }
  }

  return { text, change }
}
