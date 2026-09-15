import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import type { NoteMeta } from '@shared/types'
import { PANEL_SURFACE } from '@/ui/surfaces'
import { Icon } from '@/ui/icon'
import { cn } from '@/ui/cn'
import { useVaultStore } from '@/platform/workspace'
import { noteLook } from '@/platform/presentation'

/**
 * Picking the note a `[[` link points at.
 *
 * Linking is what this app is for, and it was the hardest thing in it: you had
 * to know a note's exact title and type it from memory. The chat composer has
 * had a list-as-you-type for `@` all along, so referring to a note was easier
 * when talking to the assistant than when writing one.
 *
 * Built on the slash menu's machinery rather than the chat's, because the
 * problems here are the slash menu's problems: the popover has to follow the
 * caret through a scrolling document, and the keys have to be taken before
 * ProseMirror inserts a newline. The chat's list is pinned to a small fixed
 * box and consumes keys through the editor's own handler, neither of which
 * carries over.
 */

export interface WikilinkState {
  /** Document position of the first `[` — everything from here is replaced. */
  from: number
  /** What has been typed after the brackets. */
  query: string
  /** Anchor rectangle in viewport coordinates. */
  rect: DOMRect
}

const MENU_WIDTH = 300
const MENU_MAX_HEIGHT = 280
/** More than fits on screen is not a shortlist; the query is the filter. */
const MAX_ROWS = 8

export function WikilinkMenu({
  editor,
  state,
  onClose
}: {
  editor: Editor
  state: WikilinkState | null
  onClose(): void
}): JSX.Element | null {
  const notes = useVaultStore((s) => s.notes)
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const query = state?.query.toLowerCase() ?? ''

  const matches = useMemo(() => {
    // Same ranking the chat's mention list uses, so "find a note" behaves the
    // same wherever you are asked for one: name matches first, then the
    // shortest path, which is the least buried note of an equal match.
    const rows = notes.filter((n) => !n.isDirectory)
    const hit = query
      ? rows.filter(
          (n) => n.title.toLowerCase().includes(query) || n.relPath.toLowerCase().includes(query)
        )
      : rows
    return [...hit]
      .sort((a, b) => {
        const ap = a.title.toLowerCase().startsWith(query) ? 0 : 1
        const bp = b.title.toLowerCase().startsWith(query) ? 0 : 1
        return ap - bp || a.relPath.length - b.relPath.length
      })
      .slice(0, MAX_ROWS)
  }, [notes, query])

  useEffect(() => {
    setActive(0)
  }, [query])

  useLayoutEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  useEffect(() => {
    if (!state) return
    function onDown(e: PointerEvent): void {
      const target = e.target as HTMLElement | null
      if (target?.closest('[data-wikilink-menu]')) return
      onClose()
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [state, onClose])

  useEffect(() => {
    if (!state) return
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActive((i) => (i + 1) % Math.max(matches.length, 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((i) => (i - 1 + matches.length) % Math.max(matches.length, 1))
      } else if ((e.key === 'Enter' || e.key === 'Tab') && matches.length > 0) {
        e.preventDefault()
        pick(matches[active] ?? matches[0])
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    // Capture phase, for the same reason the slash menu uses it: ProseMirror
    // handles keys on the editable itself, so a bubbling listener would see
    // Enter only after a paragraph had already been inserted.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  function pick(note: NoteMeta | undefined): void {
    if (!note || !state) return
    // A real node, not the text `[[Title]]`.
    //
    // The wikilink node is only ever built by the markdown parser — there is
    // no input rule — so brackets typed into the document stay plain text, and
    // the markdown serialiser escapes them on the way back out. Inserting the
    // node is what makes this a link rather than four literal brackets.
    editor
      .chain()
      .focus()
      .deleteRange({ from: state.from, to: state.from + state.query.length + 2 })
      .insertContent({ type: 'wikilink', attrs: { target: targetFor(note), alias: null } })
      .insertContent(' ')
      .run()
    onClose()
  }

  if (!state) return null
  if (matches.length === 0) return null

  const spaceBelow = window.innerHeight - state.rect.bottom
  const flipUp = spaceBelow < MENU_MAX_HEIGHT + 16 && state.rect.top > spaceBelow
  const left = Math.min(state.rect.left, window.innerWidth - MENU_WIDTH - 12)
  const top = flipUp ? undefined : state.rect.bottom + 8
  const bottom = flipUp ? window.innerHeight - state.rect.top + 8 : undefined

  return (
    <div
      ref={listRef}
      data-wikilink-menu=""
      style={{ ...PANEL_SURFACE, left, top, bottom, width: MENU_WIDTH, maxHeight: MENU_MAX_HEIGHT }}
      className="fixed z-dialog overflow-y-auto p-1"
    >
      {matches.map((n, i) => {
        const base = n.relPath.split('/').pop() ?? n.relPath
        const look = noteLook(n.path, base, n.title)
        return (
          <button
            key={n.path}
            type="button"
            data-idx={i}
            // Pressed, not clicked: a click would land after the editor had
            // already moved the caret out from under the range being replaced.
            onMouseDown={(e) => {
              e.preventDefault()
              pick(n)
            }}
            onMouseEnter={() => setActive(i)}
            className={cn(
              'flex w-full items-center gap-2 rounded-8 px-2 py-1.5 text-left transition-colors',
              i === active ? 'bg-accent' : 'hover:bg-accent/50'
            )}
          >
            <Icon
              name={look.icon ?? 'file'}
              size={14}
              className={cn('shrink-0', look.colorClass ?? undefined)}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-12.5 text-c-1">{look.label}</span>
              {n.relPath !== base ? (
                <span className="block truncate text-10.5 text-c-2">{n.relPath}</span>
              ) : null}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * What goes inside the brackets.
 *
 * Vault-relative without the extension, which is what the resolver prefers and
 * what a person would have typed. A bare title would be ambiguous the moment
 * two folders hold a note with the same name.
 */
function targetFor(note: NoteMeta): string {
  return note.relPath.replace(/\.md$/i, '')
}
