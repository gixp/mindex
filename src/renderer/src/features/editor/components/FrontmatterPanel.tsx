import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/ui/icon'
import { ChromeButton } from '@/ui/chrome-button'
import { api } from '@/platform/api'
import { cn } from '@/ui/cn'
import { openWikilink } from '@/platform/markdown/wikilink'
import { ALL_NOTE_TYPES, NOTE_TYPE_LABELS } from '@/features/editor/lib/note-types'
import type { NoteTypeId } from '@shared/types'

type Frontmatter = Record<string, unknown>

const HIDE_KEYS = new Set(['type', 'id'])

/**
 * Schema problems in this note's frontmatter, grouped by the property they
 * belong to. Advisory only — nothing here blocks a save, it just says which
 * value doesn't match what this note type declares.
 *
 * Validation lives in main (the Zod schemas are part of the type registry),
 * so this is an IPC round trip; debounced so typing in a value field doesn't
 * fire one per keystroke.
 */
function useFrontmatterIssues(relPath: string, frontmatter: Frontmatter): Map<string, string[]> {
  const [issues, setIssues] = useState<Map<string, string[]>>(new Map())

  useEffect(() => {
    if (Object.keys(frontmatter).length === 0) {
      setIssues(new Map())
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      void api()
        .notes.validateFrontmatter(relPath, frontmatter)
        .then((r) => {
          if (cancelled) return
          const next = new Map<string, string[]>()
          for (const issue of r.ok && r.data ? r.data.issues : []) {
            const sep = issue.indexOf(': ')
            const key = sep > 0 ? issue.slice(0, sep) : ''
            const message = sep > 0 ? issue.slice(sep + 2) : issue
            next.set(key, [...(next.get(key) ?? []), message])
          }
          setIssues(next)
        })
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [relPath, frontmatter])

  return issues
}

/**
 * A property whose value does not match what its note type declares.
 *
 * A badge rather than a line of text under the row: it belongs *to* the value
 * beside it, and as a full-width line below it read as a note about the whole
 * table. It also wrapped onto its own row while the value column had most of
 * the card free to its right.
 *
 * The mark takes the badge's own colour rather than a shade of its own —
 * `codicon-inherit` is what allows that; the base rule pins every icon grey
 * with `!important`, and `codicon-yellow` here was a *third* amber next to
 * two others.
 */
function IssueNote({ messages }: { messages: string[] | undefined }): JSX.Element | null {
  if (!messages || messages.length === 0) return null
  return (
    <span
      title={messages.join('\n')}
      className="inline-flex max-w-full shrink-0 items-center gap-1 rounded-6 bg-ic-amber/[0.12] px-1.5 py-px text-11 text-ic-amber"
    >
      <Icon name="warning" size={10} className="shrink-0 codicon-inherit" />
      <span className="truncate">{messages.join('; ')}</span>
    </span>
  )
}

/**
 * A collapsed-by-default disclosure, not a permanent row of colored badges.
 *
 * Frontmatter is metadata about a note, not something most reading sessions
 * need to see — the badge cards sat above every note whether anyone looked
 * at them or not. Labelled "Properties" rather than "Frontmatter": that name
 * is the on-disk YAML block, an implementation detail nobody reading a note
 * needs to know about.
 */
export function FrontmatterPanel({
  frontmatter,
  relPath,
  onChange,
  readOnly = false
}: {
  frontmatter: Frontmatter
  relPath: string
  onChange: (next: Frontmatter) => void
  readOnly?: boolean
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const issues = useFrontmatterIssues(relPath, frontmatter)
  // `null` means no draft row is showing. Kept separate from `frontmatter`
  // itself so a half-typed, not-yet-committed name/value is never mistaken
  // for a real property — the row only becomes one on commit.
  const [newRow, setNewRow] = useState<{ key: string; value: string } | null>(null)
  const newKeyRef = useRef<HTMLInputElement>(null)
  const newValueRef = useRef<HTMLInputElement>(null)
  const entries = Object.entries(frontmatter).filter(([k]) => !HIDE_KEYS.has(k))
  const type = String(frontmatter['type'] ?? 'note')
  const id = frontmatter['id'] ? String(frontmatter['id']) : null
  const count = 1 + (id ? 1 : 0) + entries.length

  // Commit only when focus actually leaves the pair — moving between the two
  // inputs is still being inside the row.
  function onNewRowBlur(e: React.FocusEvent<HTMLInputElement>): void {
    const next = e.relatedTarget as Node | null
    if (next && (next === newKeyRef.current || next === newValueRef.current)) return
    commitNewRow()
  }

  function commitNewRow(): void {
    const row = newRow
    setNewRow(null)
    if (!row) return
    const key = row.key.trim()
    if (!key) return
    // A name that collides with an existing property (case-insensitively —
    // YAML keys are case-sensitive, but two properties differing only in
    // case would be indistinguishable at a glance) replaces nothing; it's
    // just quietly not added, same as leaving the field empty.
    const taken = new Set(Object.keys(frontmatter).map((k) => k.toLowerCase()))
    if (taken.has(key.toLowerCase())) return
    onChange({ ...frontmatter, [key]: row.value })
  }

  return (
    // One bordered card holding the heading and the table, rather than a bare
    // heading with a boxed table under it: the two are one thing, and only the
    // table being boxed made the heading look like it belonged to the note
    // rather than to the properties.
    <div className="rounded-r2 border border-bd-2 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex shrink-0 items-center gap-1.5 text-[13px] text-foreground transition-colors"
        >
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={13} />
          Properties
          <span className="text-muted-foreground/50">({count})</span>
          {/* Collapsed is the default state, so a problem inside would otherwise
            never be seen. The count is a hint to open the panel, not an
            error — the note saves either way. */}
          {issues.size > 0 ? (
            <span
              title={`${issues.size} property ${issues.size === 1 ? 'does' : 'do'} not match this note type`}
              className="inline-flex items-center gap-1 rounded-6 bg-ic-amber/[0.12] px-1.5 py-px text-11 text-ic-amber"
            >
              <Icon name="warning" size={10} className="codicon-inherit" />
              {issues.size}
            </span>
          ) : null}
        </button>

        {/* Closed is a *view*, not an absence: a heading and a number say a note
          has eleven properties and nothing about what they are, so checking
          one meant opening the panel and closing it again.

          One line, on the heading's own line, clipped where it runs out —
          not wrapped. This is a glance, and a summary that grows to three
          lines is the panel again with its borders taken off; whatever does
          not fit is one click away.

          The rule between them is inset top and bottom, so it separates the
          two without reaching the card's own padding: a full-height line
          would read as a column divider. */}
        {!open ? (
          <>
            <span className="my-1 w-px shrink-0 self-stretch bg-bd-2" />
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
              <Chip label="type" value={NOTE_TYPE_LABELS[type as NoteTypeId] ?? type} />
              {id ? <Chip label="id" value={id} mono /> : null}
              {entries.map(([key, value]) => (
                <Chip key={key} label={key} value={summarise(value)} flagged={issues.has(key)} />
              ))}
            </div>
          </>
        ) : null}
      </div>

      {open ? (
        // Open is the full list: one property per row, the whole width of the
        // card, a hairline between them. The grid used to size itself to its
        // content — so on a wide note it was a narrow column hugging the left
        // edge with the rules stopping halfway across, which read as a broken
        // table rather than a deliberate one.
        <div className="mt-2 grid w-full grid-cols-[minmax(96px,max-content)_minmax(0,1fr)] px-2 pb-2 [&>*:nth-child(-n+2)]:border-t-0">
          <FmRow label="type">
            {readOnly ? (
              <span className="text-foreground">
                {NOTE_TYPE_LABELS[type as NoteTypeId] ?? type}
              </span>
            ) : (
              <FmTypeSelect
                value={type as NoteTypeId}
                onChange={(next) => onChange({ ...frontmatter, type: next })}
              />
            )}
          </FmRow>
          {id ? (
            <FmRow label="id">
              <span className="font-mono text-foreground">{id}</span>
            </FmRow>
          ) : null}
          {entries.map(([key, value]) => (
            <FmRow key={key} label={key} issue={<IssueNote messages={issues.get(key)} />}>
              {readOnly ? (
                <TypedValue value={value} />
              ) : (
                <FmEditValue
                  value={value}
                  onChange={(v) => onChange({ ...frontmatter, [key]: v })}
                />
              )}
            </FmRow>
          ))}

          {/* Problems that don't belong to a property shown above — a field
              the type requires but the note doesn't have, or one hidden by
              HIDE_KEYS. Without this they'd be counted in the header and
              then found nowhere. */}
          {[...issues].some(([key]) => !entries.some(([k]) => k === key)) ? (
            <div className="col-span-2 border-t border-bd-2 pt-[7px]">
              {[...issues]
                .filter(([key]) => !entries.some(([k]) => k === key))
                .map(([key, messages]) => (
                  <IssueNote
                    key={key || '_'}
                    messages={messages.map((m) => (key ? `${key}: ${m}` : m))}
                  />
                ))}
            </div>
          ) : null}

          {newRow ? (
            // The same two cells a committed row has, except both are inputs:
            // this is the row being typed, not yet a property. Blur commits
            // it, but only when focus actually leaves the pair — without the
            // `relatedTarget` check, tabbing from the name into the value
            // would commit a row half-typed.
            //
            // Cells rather than a wrapped row for the same reason as `FmRow`:
            // the grid can only line the key column up across rows if the
            // cells are its own children.
            <>
              <input
                autoFocus
                ref={newKeyRef}
                value={newRow.key}
                onBlur={onNewRowBlur}
                onChange={(e) => setNewRow({ ...newRow, key: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    newValueRef.current?.focus()
                  }
                  if (e.key === 'Escape') {
                    e.stopPropagation()
                    setNewRow(null)
                  }
                }}
                placeholder="Name"
                className={cn(
                  FM_KEY_COL,
                  'pr-4 py-2 bg-transparent text-foreground outline-none placeholder:text-muted-foreground/60'
                )}
              />
              <input
                ref={newValueRef}
                value={newRow.value}
                onBlur={onNewRowBlur}
                onChange={(e) => setNewRow({ ...newRow, value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitNewRow()
                  }
                  if (e.key === 'Escape') {
                    e.stopPropagation()
                    setNewRow(null)
                  }
                }}
                placeholder="Value"
                className="min-w-0 border-t border-bd-2 bg-transparent py-2 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/60"
              />
            </>
          ) : null}
        </div>
      ) : null}

      {open && !newRow ? (
        <div className="mt-1 w-fit max-w-full">
          <ChromeButton
            icon="add"
            label="Add property"
            iconSize={12}
            onClick={() => setNewRow({ key: '', value: '' })}
          />
        </div>
      ) : null}
    </div>
  )
}

/** One row of the properties table: a hairline between rows (skipped on the
 *  first) and another between the label and value cells, so it reads as an
 *  actual table grid rather than loose stacked lines. `items-stretch` (not
 *  `items-center`) is what makes the vertical rule run the full row height
 *  instead of just the label's own line. */
/**
 * The key cell, in one place.
 *
 * Two elements have to agree — a committed row's label and the input of the
 * row being typed — and they sit two hundred lines apart, so a literal in each
 * is a mismatch waiting to happen the next time one is edited. No width here:
 * the grid column decides that, from the longest key.
 */
const FM_KEY_COL = 'border-t border-bd-2 whitespace-nowrap text-[13px]'

/**
 * Two grid cells and, when there is one, a warning spanning both.
 *
 * A fragment rather than a wrapper element: the cells have to be direct
 * children of the grid for the key column to be shared across rows. The
 * warning sits below the value cell rather than inside it, because that cell
 * is `truncate` — a single clipped line, which would swallow it.
 */
function FmRow({
  label,
  children,
  issue
}: {
  label: string
  children: React.ReactNode
  issue?: React.ReactNode
}): JSX.Element {
  return (
    <>
      <span className={cn(FM_KEY_COL, 'py-2 pr-4 text-c-2')}>{label}</span>
      <div className="flex min-w-0 items-center gap-2 border-t border-bd-2 py-2 text-[13px] text-c-1">
        <span className="min-w-0">{children}</span>
        {issue}
      </div>
    </>
  )
}

function FmTypeSelect({
  value,
  onChange
}: {
  value: NoteTypeId
  onChange: (next: NoteTypeId) => void
}): JSX.Element {
  return (
    // The native arrow is stripped (`appearance-none`) so the control matches
    // the rest of the panel, which left it looking exactly like the text
    // values around it — nothing said it could be changed. The arrow is drawn
    // back, on the right, where a select's arrow lives.
    // The arrow sits inside the control's own box, at its right edge, the way
    // a native select's does — `pr-5` is what makes room for it, and the
    // absolute placement is what keeps it *in* the box rather than beside it.
    // `pointer-events-none` so clicking the arrow opens the list: an arrow you
    // can click and have nothing happen is worse than no arrow.
    <span className="relative inline-flex min-w-0 max-w-full items-center">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as NoteTypeId)}
        className="min-w-0 max-w-full cursor-pointer appearance-none bg-transparent pr-5 text-c-1 outline-none"
      >
        {ALL_NOTE_TYPES.map((t) => (
          <option key={t} value={t} className="border border-bd-2 bg-bg-2 text-foreground">
            {NOTE_TYPE_LABELS[t]}
          </option>
        ))}
      </select>
      <Icon
        name="chevron-down"
        size={10}
        className="pointer-events-none absolute right-0.5 top-1/2 -translate-y-1/2 codicon-muted"
      />
    </span>
  )
}

/**
 * Does this value point somewhere you can go?
 *
 * Two shapes count: a URL, and a `[[wikilink]]` to another note. Both are
 * ordinary things to put in frontmatter — a `linkedin`, a `company` — and
 * showing them as inert text meant the only way to follow one was to select
 * and copy it.
 */
function linkTarget(display: string): { href: string; kind: 'url' | 'wikilink' } | null {
  const value = display.trim()
  if (/^https?:\/\/\S+$/i.test(value)) return { href: value, kind: 'url' }
  const wiki = value.match(/^\[\[([^\]]+)\]\]$/)
  if (wiki?.[1]) return { href: wiki[1].trim(), kind: 'wikilink' }
  return null
}

function FmEditValue({
  value,
  onChange
}: {
  value: unknown
  onChange: (v: unknown) => void
}): JSX.Element {
  if (typeof value === 'boolean') {
    return (
      <button
        type="button"
        onClick={() => onChange(!value)}
        className="inline-flex items-center gap-1 text-foreground transition-opacity hover:opacity-80"
      >
        <Icon name={value ? 'check' : 'circle-slash'} size={10} />
        {value ? 'true' : 'false'}
      </button>
    )
  }
  const display = formatValue(value)
  const link = linkTarget(display)
  const input = (
    <input
      defaultValue={display}
      placeholder={Array.isArray(value) ? 'comma, separated, tags' : ''}
      // An input's intrinsic width is a browser default of roughly twenty
      // characters no matter what it holds, so a column sized to its content
      // measured that rather than the value. `size` is the only thing that
      // makes an input as wide as its own text. Capped, because one long
      // description should not push the table past the panel.
      size={Math.min(64, Math.max(12, display.length + 1))}
      className={cn(
        'min-w-0 max-w-full bg-transparent outline-none placeholder:text-muted-foreground/50',
        // Styled as a link, still editable as text. Clicking it puts the caret
        // where you clicked, the way every other value here behaves; the arrow
        // beside it is what follows the link, so neither gesture steals the
        // other.
        link
          ? 'text-accent-1 underline decoration-accent-1/40 underline-offset-2'
          : 'text-foreground'
      )}
      onBlur={(e) => {
        const next = parseValue(value, e.target.value)
        if (next !== value) onChange(next)
      }}
    />
  )

  if (!link) return input

  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1">
      {input}
      <button
        type="button"
        title={link.kind === 'url' ? `Open ${link.href}` : `Open note ${link.href}`}
        aria-label="Open link"
        onClick={() => openLink(link)}
        className="shrink-0 text-accent-1 opacity-70 transition-opacity hover:opacity-100"
      >
        <Icon
          name={link.kind === 'url' ? 'link-external' : 'go-to-file'}
          size={11}
          className="codicon-inherit"
        />
      </button>
    </span>
  )
}

function openLink(link: { href: string; kind: 'url' | 'wikilink' }): void {
  if (link.kind === 'url') {
    // `setWindowOpenHandler` in main already answers this with
    // `shell.openExternal` and denies the window, so the default browser
    // opens it and no channel of our own is needed.
    window.open(link.href, '_blank')
    return
  }
  // The editor's own resolver, so a link in a property lands on the same note
  // a link in the text would.
  openWikilink(link.href)
}

/**
 * A value, coloured by what kind of thing it is.
 *
 * Every property used to be the same grey, so a date, a count, a switch and a
 * list of tags were told apart only by reading them. The hues are the icon
 * palette's — the same ones a folder or a status dot uses, with a real light
 * value each — so this is the app's own vocabulary rather than a scheme
 * invented for one panel.
 *
 * Deliberately quiet: the colour says *what kind*, and a panel of eleven
 * saturated values would say only "look at me, all of me". Numbers and dates
 * are tinted, text is left alone — most properties are text, and colouring
 * the majority colours nothing.
 */
function TypedValue({ value }: { value: unknown }): JSX.Element {
  if (Array.isArray(value)) {
    if (value.length === 0) return <Dash />
    // Chips, not a comma-separated run: a list of tags is a set of small
    // things, and commas made it read as one long value with punctuation in
    // it. The chip is the same shape the closed view uses.
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        {value.map((v, i) => (
          <span
            key={i}
            className="inline-flex max-w-full items-center rounded-6 bg-accent-1/[0.10] px-1.5 py-px text-11 text-accent-1"
          >
            {String(v)}
          </span>
        ))}
      </span>
    )
  }
  if (typeof value === 'boolean') {
    return (
      <span
        className={cn('inline-flex items-center gap-1', value ? 'text-ic-emerald' : 'text-c-2')}
      >
        <Icon
          name={value ? 'pass-filled' : 'circle-slash'}
          size={10}
          className={value ? 'codicon-emerald' : 'codicon-muted'}
        />
        {value ? 'true' : 'false'}
      </span>
    )
  }
  if (value === null || value === undefined || value === '') return <Dash />
  const s = String(value)
  if (/^https?:\/\//i.test(s)) {
    return (
      <a
        href={s}
        onClick={(e) => {
          e.preventDefault()
          window.open(s, '_blank')
        }}
        className="break-all text-accent-1 underline decoration-accent-1/40 underline-offset-2 transition-colors hover:text-accent-1-hover"
      >
        {s}
      </a>
    )
  }
  if (isDateLike(s)) {
    return (
      <span className="inline-flex items-center gap-1 text-ic-purple">
        <Icon name="calendar" size={10} className="codicon-purple" />
        {formatDate(s)}
      </span>
    )
  }
  // A bare number — a target, a count, a version. Tabular so a column of them
  // lines up on the digit rather than on the glyph widths.
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    return <span className="tabular-nums text-ic-cyan">{s}</span>
  }
  return <span className="break-words">{s}</span>
}

function Dash(): JSX.Element {
  return <span className="text-muted-foreground/40">—</span>
}

function isDateLike(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})?/.test(s)
}

function formatDate(s: string): string {
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

function formatValue(value: unknown): string {
  return Array.isArray(value)
    ? value.join(', ')
    : typeof value === 'object' && value !== null
      ? JSON.stringify(value)
      : value === null || value === undefined
        ? ''
        : String(value)
}

function parseValue(prev: unknown, raw: string): unknown {
  if (Array.isArray(prev)) {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
  if (typeof prev === 'number') {
    const n = Number(raw)
    return Number.isFinite(n) ? n : raw
  }
  if (typeof prev === 'boolean') {
    return raw === 'true'
  }
  return raw
}

/**
 * One property as a chip, for the closed view.
 *
 * Key and value inside one shape rather than two words with a space between
 * them: at a glance a wrapped row of pairs is otherwise a run-on sentence, and
 * which word belongs to which is guesswork at the line breaks.
 */
function Chip({
  label,
  value,
  mono = false,
  flagged = false
}: {
  label: string
  value: string
  mono?: boolean
  flagged?: boolean
}): JSX.Element {
  return (
    <span
      title={`${label}: ${value}`}
      className={cn(
        'inline-flex max-w-full shrink-0 items-baseline gap-1.5 rounded-6 px-1.5 py-0.5 text-11',
        // The same badge a warning wears in the open view, rather than a grey
        // chip with a ring drawn round it: one meaning, one shape, wherever
        // it appears.
        flagged ? 'bg-ic-amber/[0.12]' : 'bg-bg-2'
      )}
    >
      <span className={cn('shrink-0', flagged ? 'text-ic-amber/70' : 'text-c-2')}>{label}</span>
      <span
        className={cn(
          'min-w-0 truncate',
          flagged ? 'text-ic-amber' : 'text-c-1',
          mono && 'font-mono'
        )}
      >
        {value}
      </span>
    </span>
  )
}

/**
 * A property's value as one short line.
 *
 * The closed view has no room to be faithful — a list becomes its items joined
 * up, an empty value becomes a dash — and it does not need to be: anything
 * that matters is one click away in the open view, and a chip that wraps to
 * three lines defeats the point of the closed one.
 */
function summarise(value: unknown): string {
  if (Array.isArray(value)) return value.length > 0 ? value.map(String).join(', ') : '—'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}
