import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { PANEL_SURFACE } from '@/ui/surfaces'
import type { Editor } from '@tiptap/react'
import { Icon } from '@/ui/icon'
import { cn } from '@/ui/cn'
import { COMMANDS, type Command } from './slashCommands'
import { SlashMenuPreview } from './SlashMenuPreview'
import { EMOJI_LIST } from '@/features/editor/lib/emoji-data'

export interface SlashState {
  /** Where the `/` sits, so the typed text can be removed on pick. */
  from: number
  /** Query taken from the document; only meaningful for the `slash` trigger. */
  query: string
  /** Anchor rectangle in viewport coordinates. */
  rect: DOMRect
  /**
   * How the menu was opened. `slash` means the query lives in the document and
   * must be deleted when a command runs; `button` means nothing was typed, so
   * deleting anything would eat the user's content.
   */
  trigger: 'slash' | 'button'
}

const MENU_WIDTH = 236
const MENU_MAX_HEIGHT = 320

/**
 * The element picker: `/` at the start of a block, or the `+` in the gutter.
 *
 * When opened by `+` the query is held in local state instead of the document,
 * because there is no typed text to read — and, more importantly, nothing that
 * may be deleted afterwards.
 *
 * Rows are grouped under fixed category headers (`Command['group']`, in the
 * order `slashCommands.ts` defines them) and show only an icon and a label —
 * the one-line description that used to sit under each row now lives in
 * `SlashMenuPreview`, shown beside whichever row is active (hovered, or
 * highlighted via the keyboard). A category with no commands yet simply never
 * gets a header, so new block types can land one at a time without leaving a
 * placeholder gap in the menu.
 */
export function SlashMenu({
  editor,
  state,
  onClose
}: {
  editor: Editor
  state: SlashState | null
  onClose(): void
}): JSX.Element | null {
  const [active, setActive] = useState(0)
  const [typed, setTyped] = useState('')
  // 'emoji' swaps the row list to the emoji dataset instead of `COMMANDS` —
  // picking the "Emoji" row re-purposes the whole menu (search, keyboard
  // nav, preview flyout) rather than opening a separate component.
  const [subMenu, setSubMenu] = useState<'root' | 'emoji'>('root')
  const [previewAnchor, setPreviewAnchor] = useState<{ row: DOMRect; menu: DOMRect } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLButtonElement>(null)
  const fieldRef = useRef<HTMLInputElement>(null)

  const emojiCommands = useMemo<Command[]>(
    () =>
      EMOJI_LIST.map((e) => ({
        id: `emoji:${e.char}`,
        label: e.name,
        caption: e.name,
        glyph: e.char,
        group: 'Insert' as const,
        keywords: e.keywords,
        run: (ed: Editor) => ed.chain().focus().insertContent(e.char).run(),
        preview: () => <span className="text-[40px] leading-none">{e.char}</span>
      })),
    []
  )

  // Once a sub-menu is open, typing always filters locally — including for a
  // menu that started in `slash` mode, where the query would normally live
  // in the document. Leaving the document untouched while browsing emoji
  // means `state.query`/`state.from` (captured at open time) are still
  // exactly what should be deleted once a final pick is made.
  // Where the query lives. Opened by the `+` there is nothing in the document
  // to read, and a sub-menu always filters locally whatever opened it.
  const localQuery = subMenu !== 'root' || state?.trigger === 'button'
  const query = localQuery ? typed : (state?.query ?? '')
  const sourceList = subMenu === 'emoji' ? emojiCommands : COMMANDS

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sourceList
    return sourceList.filter((c) => c.label.toLowerCase().includes(q) || c.keywords.includes(q))
  }, [query, sourceList])

  useEffect(() => {
    setActive(0)
  }, [query])

  useEffect(() => {
    if (!state) {
      setTyped('')
      setSubMenu('root')
    }
  }, [state])

  // Keep the highlighted row in view when moving with the keyboard, and keep
  // the preview flyout anchored to it — hovering and arrowing through the
  // list both land on `active`, so both drive the same preview.
  useLayoutEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
    const row = activeRef.current?.getBoundingClientRect() ?? null
    const menu = listRef.current?.getBoundingClientRect() ?? null
    setPreviewAnchor(row && menu ? { row, menu } : null)
  }, [active, matches.length, state])

  // Clicking anywhere else dismisses the menu — including back into the
  // document, which is the common case: the user changes their mind and just
  // carries on typing somewhere. Bound on pointerdown rather than click so it
  // closes on press, before the editor moves the caret.
  useEffect(() => {
    if (!state) return
    function onDown(e: PointerEvent): void {
      const target = e.target as HTMLElement | null
      // Rows call `pick` on mousedown; ignore presses inside the menu itself
      // or the preview flyout beside it (e.g. a click on the Tabs demo).
      if (target?.closest('[data-slash-menu]')) return
      onClose()
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [state, onClose])

  // Focus follows the field into existence. The editor keeps its selection in
  // its own state, not in the DOM, so taking focus away costs nothing — every
  // command still runs against the block the caret was in.
  useEffect(() => {
    if (state && localQuery) fieldRef.current?.focus()
  }, [state, localQuery, subMenu])

  useEffect(() => {
    if (!state) return
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActive((i) => (i + 1) % Math.max(matches.length, 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((i) => (i - 1 + matches.length) % Math.max(matches.length, 1))
      } else if (e.key === 'Enter' && matches.length > 0) {
        e.preventDefault()
        pick(matches[active] ?? matches[0])
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (localQuery) {
        // The field takes the characters now. Catching them here as well would
        // type each one twice — and stealing them from a focused input is what
        // made a field impossible before.
      }
    }
    // Capture phase: ProseMirror handles keys on the editable itself, so a
    // bubbling listener would see Enter only after a paragraph was inserted.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  function pick(cmd: Command | undefined): void {
    if (!cmd || !state) return
    if (cmd.id === 'emoji-open') {
      setSubMenu('emoji')
      setTyped('')
      setActive(0)
      return
    }
    if (state.trigger === 'slash') {
      editor
        .chain()
        .focus()
        .deleteRange({ from: state.from, to: state.from + state.query.length + 1 })
        .run()
    } else {
      editor.chain().focus().run()
    }
    // Commands that ask for input resolve later, after their dialog closes;
    // the menu itself is done either way, so it closes now rather than
    // hanging around behind the modal.
    void Promise.resolve(cmd.run(editor)).catch(() => {})
    onClose()
  }

  // A menu that vanishes mid-word looks like a bug in the typing, not an
  // answer to it. With a field of its own there is somewhere to say "nothing" —
  // and the text is still there to be corrected.
  //
  // Typing after a `/` is different: that text is going into the document, and
  // holding a menu open over prose that merely starts with a slash would make
  // the menu the thing you have to dismiss.
  if (!state) return null
  if (matches.length === 0 && !localQuery) return null

  // Flip above the anchor when there is not enough room below, and never let
  // the menu run off the right edge.
  const spaceBelow = window.innerHeight - state.rect.bottom
  const flipUp = spaceBelow < MENU_MAX_HEIGHT + 16 && state.rect.top > spaceBelow
  const left = Math.min(state.rect.left, window.innerWidth - MENU_WIDTH - 12)
  const top = flipUp ? undefined : state.rect.bottom + 8
  const bottom = flipUp ? window.innerHeight - state.rect.top + 8 : undefined

  let lastGroup = ''

  return (
    <>
      <div
        ref={listRef}
        data-slash-menu=""
        style={{
          left,
          top,
          bottom,
          width: MENU_WIDTH,
          maxHeight: MENU_MAX_HEIGHT,
          ...PANEL_SURFACE
        }}
        className="slash-menu fixed z-dialog overflow-y-auto rounded-[12px] p-1.5"
      >
        {/* A field, not an echo of one.

            Typing already filtered this menu when it was opened by the `+`,
            but there was nothing to type *into*: keys were caught off the
            window and the result shown as a grey line at the top. So the menu
            looked like a list you could only point at, and the fastest way
            through it was invisible. The field is the same behaviour, said out
            loud, and it takes focus on open so the first keystroke lands. */}
        {localQuery ? (
          <input
            ref={fieldRef}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Search"
            spellCheck={false}
            className="mb-1 w-full rounded-9 bg-bg-3 px-2 py-1.5 text-12 text-foreground outline-none placeholder:text-c-2"
          />
        ) : query ? (
          <div className="px-2 pb-0.5 pt-1 text-[10px] text-muted-foreground">
            <span className="text-foreground">{query}</span>
          </div>
        ) : null}

        {matches.length === 0 ? (
          <div className="px-2 py-3 text-center text-12 text-muted-foreground">
            No block matches <span className="text-foreground">{query}</span>
          </div>
        ) : null}

        {matches.map((c, i) => {
          const header = subMenu === 'root' && c.group !== lastGroup && !query ? c.group : null
          lastGroup = c.group
          const isActive = i === active
          return (
            <div key={c.id}>
              {header ? (
                <div className="px-2 pb-1 pt-2.5 text-[9px] font-semibold uppercase tracking-[0.09em] text-c-2 first:pt-1">
                  {header}
                </div>
              ) : null}
              <button
                ref={isActive ? activeRef : undefined}
                type="button"
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(c)
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-[9px] px-1.5 py-[5px] text-left transition-colors',
                  isActive ? 'bg-bg-3' : 'hover:bg-bg-4'
                )}
              >
                <span
                  className={cn(
                    'flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] transition-colors',
                    isActive ? 'bg-bg-3' : 'bg-bg-3'
                  )}
                >
                  {c.glyph ? (
                    <span className="text-[10px] font-semibold leading-none text-muted-foreground">
                      {c.glyph}
                    </span>
                  ) : (
                    <Icon name={c.icon ?? 'circle'} size={13} />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">
                  {c.label}
                </span>
              </button>
            </div>
          )
        })}
      </div>

      <SlashMenuPreview
        command={matches[active] ?? null}
        rowRect={previewAnchor?.row ?? null}
        menuRect={previewAnchor?.menu ?? null}
      />
    </>
  )
}
