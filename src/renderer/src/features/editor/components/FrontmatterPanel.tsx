import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/ui/icon'
import { ActionButton } from '@/ui/action-button'
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
 *
 * Open, it has two states of its own. *Reading* is a list of plain values —
 * nothing in it looks like a form, because most of the time nobody is filling
 * one in. *Editing* turns every value into a field at once, and is left by the
 * one Done button in the heading. The way in is the pencil at the right of a
 * row, so "change this one thing" is one click and lands with that field
 * already focused, rather than a mode you enter and then go hunting in.
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
  // Which state the open panel is in. Never true when `readOnly` — a skill
  // file's properties are shown, not edited.
  const [editing, setEditing] = useState(false)
  // The property whose pencil was clicked, so its field can take focus when
  // the fields appear. Only read as the fields mount; cleared on the way out.
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const issues = useFrontmatterIssues(relPath, frontmatter)
  // `null` means no draft row is showing. Kept separate from `frontmatter`
  // itself so a half-typed, not-yet-committed name/value is never mistaken
  // for a real property — the row only becomes one on commit.
  const [newRow, setNewRow] = useState<{ key: string; value: string } | null>(null)
  const newValueRef = useRef<HTMLInputElement>(null)
  const entries = Object.entries(frontmatter).filter(([k]) => !HIDE_KEYS.has(k))
  const type = String(frontmatter['type'] ?? 'note')
  const id = frontmatter['id'] ? String(frontmatter['id']) : null
  const count = 1 + (id ? 1 : 0) + entries.length
  const canEdit = !readOnly
  // One template for every row in the list, decided by the mode rather than by
  // whether a given row happens to have a pencil: a row that drops the trailing
  // column redistributes the two `fr` columns, which is what made `id` — the
  // one row with nothing to edit — start its value further right than the rows
  // above and below it.
  const withPencil = canEdit && !editing

  function startEditing(key: string): void {
    setFocusKey(key)
    setEditing(true)
  }

  function stopEditing(): void {
    setFocusKey(null)
    setEditing(false)
  }

  function commitNewRow(): void {
    const row = newRow
    if (!row) return
    const key = row.key.trim()
    setNewRow(null)
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
    // No frame of its own: open, this is a stack of filled rows, and each row
    // is already its own shape — a border around a set of cards boxes what is
    // visibly boxed. Closed, the heading and its chips are one line, which
    // reads as a line, not as something that lost a card.
    <div className="py-0.5">
      {/* Closed is a *view*, not an absence: a heading and a number say a note
          has eleven properties and nothing about what they are, so checking one
          meant opening the panel and closing it again. One bar, one line, the
          same card shape a row has when the panel is open — closed is this
          panel compacted, not a different object.

          Values without their names: at a glance a book means the type, a dot
          means the status, and "3 tags" is the whole truth about a list. The
          names are what the open panel is for. Whatever runs past the end is
          clipped rather than wrapped — a summary that grows to three lines is
          the open panel with its rows taken away. */}
      {!open ? (
        // `rounded-r2` rather than a row's own `rounded-8`: closed, this is a
        // control the width of the note, and the scale gives that size the
        // radius it gives an input inside a panel.
        <div className={cn(FM_ROW, 'group flex gap-3 rounded-r2')}>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden text-left"
          >
            <span className="inline-flex shrink-0 items-center gap-1.5 text-foreground">
              <Icon name="chevron-right" size={13} className="codicon-c-1" />
              Properties
              <span className="text-muted-foreground/50">({count})</span>
              {/* Collapsed is the default state, so a problem inside would
                otherwise never be seen. The count is a hint to open the panel,
                not an error — the note saves either way. */}
              {issues.size > 0 ? (
                <span
                  title={`${issues.size} property ${issues.size === 1 ? 'does' : 'do'} not match this note type`}
                  className="inline-flex items-center gap-1 rounded-6 bg-ic-amber/[0.12] px-1.5 py-px text-11 text-ic-amber"
                >
                  <Icon name="warning" size={10} className="codicon-inherit" />
                  {issues.size}
                </span>
              ) : null}
            </span>
            {/* Inset top and bottom, so it separates the heading from the
                summary without reaching the card's own padding: a full-height
                line would read as a column divider. */}
            <span className="my-1 w-px shrink-0 self-stretch bg-bd-2" />
            <span className="flex min-w-0 items-center gap-3.5 overflow-hidden">
              {summaryItems(type, entries, issues).map((item) => (
                <SummaryItem key={item.key} item={item} />
              ))}
            </span>
          </button>
          {/* The same pencil a row wears, in the same place — the right edge.
              Closed, the bar *is* the list, so the one control it offers should
              be the one the list offers, not a second vocabulary for it. */}
          {canEdit ? (
            <EditPencil
              label="properties"
              onClick={() => {
                setOpen(true)
                setEditing(true)
              }}
            />
          ) : null}
        </div>
      ) : (
        <div className="flex items-center gap-2 px-1">
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              stopEditing()
            }}
            className="inline-flex shrink-0 items-center gap-1.5 text-13 text-foreground transition-colors"
          >
            <Icon name="chevron-down" size={13} className="codicon-c-1" />
            Properties
            <span className="text-muted-foreground/50">({count})</span>
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

          {/* The way out of editing, and the only thing in the heading that is
              a fill: leaving the mode is the one action the panel offers while
              it is in it. Nothing takes its place while reading — a permanent
              Edit button beside a list whose every row already has a pencil is
              the same offer made twice. */}
          {editing ? (
            <div className="ml-auto">
              <ActionButton tone="primary" size="sm" onClick={stopEditing}>
                Done
              </ActionButton>
            </div>
          ) : null}
        </div>
      )}

      {open ? (
        // Open is the full list: one property per row, each row its own filled
        // card. Hairlines between cells made this a spreadsheet — a grid of
        // rules with the values inside them — when what is actually here is a
        // short list of separate facts. A fill per row, a gap between them, and
        // a mark on the left saying what kind of thing the value is.
        <div className="mt-1.5 flex w-full flex-col gap-1">
          <FmRow
            label="type"
            icon="book"
            trailing={withPencil}
            onEdit={withPencil ? () => startEditing('type') : undefined}
          >
            {editing ? (
              <FmTypeSelect
                value={type as NoteTypeId}
                autoFocus={focusKey === 'type'}
                onChange={(next) => onChange({ ...frontmatter, type: next })}
              />
            ) : (
              <span className="text-c-1">{NOTE_TYPE_LABELS[type as NoteTypeId] ?? type}</span>
            )}
          </FmRow>
          {id ? (
            // No pencil and no field: an id is what everything else points at,
            // so it is shown and locked rather than offered and then refused.
            <FmRow label="id" icon="symbol-numeric" trailing={withPencil}>
              {editing ? (
                <span className={cn(FM_FIELD, 'text-muted-foreground')}>
                  <span className="min-w-0 flex-1 truncate font-mono">{id}</span>
                  <Icon name="lock" size={11} className="codicon-muted" title="Fixed" />
                </span>
              ) : (
                <span className="break-all font-mono text-c-1">{id}</span>
              )}
            </FmRow>
          ) : null}
          {entries.map(([key, value]) => {
            const mark = propertyMark(key, value)
            return (
              <FmRow
                key={key}
                label={key}
                icon={mark.icon}
                iconClass={mark.className}
                issue={<IssueNote messages={issues.get(key)} />}
                trailing={withPencil}
                onEdit={withPencil ? () => startEditing(key) : undefined}
              >
                {editing ? (
                  <FmValueField
                    value={value}
                    autoFocus={focusKey === key}
                    onChange={(v) => onChange({ ...frontmatter, [key]: v })}
                  />
                ) : (
                  <TypedValue value={value} />
                )}
              </FmRow>
            )
          })}

          {/* Problems that don't belong to a property shown above — a field
              the type requires but the note doesn't have, or one hidden by
              HIDE_KEYS. Without this they'd be counted in the header and
              then found nowhere. */}
          {[...issues].some(([key]) => !entries.some(([k]) => k === key)) ? (
            <div className="flex flex-wrap items-center gap-1 px-1 pt-0.5">
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
            // The same card a committed row is, except both cells are fields
            // and the row carries its own two buttons: this is a property
            // being written, and it is not one until Add says so. Nothing
            // commits on blur — with a Cancel sitting right there, clicking it
            // would otherwise add the row it is meant to throw away.
            <div className={cn(FM_ROW, FM_COLS_ACTION)}>
              <Icon name="add" size={13} className="justify-self-center codicon-muted" />
              <span className={cn(FM_FIELD, 'focus-within:border-accent-1')}>
                <input
                  autoFocus
                  value={newRow.key}
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
                  className="w-full min-w-0 bg-transparent outline-none placeholder:text-muted-foreground/60"
                />
              </span>
              <span className={FM_FIELD}>
                <input
                  ref={newValueRef}
                  value={newRow.value}
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
                  className="w-full min-w-0 bg-transparent outline-none placeholder:text-muted-foreground/60"
                />
              </span>
              <span className="flex items-center gap-1">
                <ActionButton tone="ghost" size="sm" onClick={() => setNewRow(null)}>
                  Cancel
                </ActionButton>
                <ActionButton
                  tone="primary"
                  size="sm"
                  disabled={newRow.key.trim() === ''}
                  onClick={commitNewRow}
                >
                  Add
                </ActionButton>
              </span>
            </div>
          ) : null}

          {/* The last row of the list rather than a button sitting under it:
              adding a property is the next line of the same list, and a card
              the same shape as the others says where the new one will land.
              Quieter than they are — it is an invitation, not a value. */}
          {canEdit && !newRow ? (
            <button
              type="button"
              onClick={() => setNewRow({ key: '', value: '' })}
              className={cn(
                FM_ROW,
                FM_COLS_PLAIN,
                // No fill of its own: the fills belong to the properties, and
                // this is not one of them yet. It takes one on hover, which is
                // the row it is about to become.
                'bg-transparent text-left text-muted-foreground/70 transition-colors',
                'hover:bg-bg-3 hover:text-c-2'
              )}
            >
              <Icon name="add" size={13} className="justify-self-center codicon-inherit" />
              <span className="truncate">Add property</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * One row's card, in one place.
 *
 * Four things have to agree on it — a row being read, a row being edited, the
 * property being written and the add-a-property row — and they sit a hundred
 * lines apart, so a literal in each is a mismatch waiting to happen the next
 * time one is edited.
 *
 * The columns are fixed rather than sized to content: each row is now its own
 * card, so nothing lines the value column up across rows except the columns
 * being the same width in every one of them. The label column is a share of
 * the row, not a fixed width — on a narrow pane it gives way to the value,
 * which is the part anyone is reading. `min-h-9` rather than a padding that
 * happens to add up, so a row of chips and a row of one word are the same
 * height.
 */
const FM_ROW = 'grid w-full min-h-9 items-center gap-2.5 rounded-8 bg-bg-3 px-2.5 py-1 text-13'
/** Mark, name, value. */
const FM_COLS_PLAIN = 'grid-cols-[14px_minmax(0,0.34fr)_minmax(0,1fr)]'
/** The same, plus the pencil at the right edge. */
const FM_COLS_EDIT = 'grid-cols-[14px_minmax(0,0.34fr)_minmax(0,1fr)_20px]'
/** The same, plus a pair of buttons — the row being written. */
const FM_COLS_ACTION = 'grid-cols-[14px_minmax(0,0.34fr)_minmax(0,1fr)_auto]'

/**
 * A value's box while the panel is being edited.
 *
 * An edge and a fill a step up from the row, so a row that can be typed into
 * looks like one — the whole point of having two states is that the reading
 * one has no boxes in it at all. Focus moves the edge to the accent rather
 * than adding a ring: the field is already outlined, and a ring around an
 * outline is two borders saying the same thing.
 */
const FM_FIELD =
  'flex h-7 w-full min-w-0 items-center gap-2 rounded-8 border border-bd-2 bg-bg-4/50 px-2.5 ' +
  'text-13 text-c-1 transition-colors focus-within:border-accent-1 focus-within:bg-bg-4'

/**
 * One property as a card: its mark, its name, its value, and any warning.
 *
 * The mark is what carries "what kind of thing this is" — a calendar, a tag, a
 * status dot — so the value itself can be left as plain text. Colouring the
 * values instead meant a panel of eleven properties was eleven hues, which
 * says only "look at me, all of me".
 */
function FmRow({
  label,
  icon,
  iconClass,
  children,
  issue,
  trailing = false,
  onEdit
}: {
  label: string
  icon: string
  iconClass?: string
  children: React.ReactNode
  issue?: React.ReactNode
  /** Whether the list this row is in has a trailing column at all. Set for
   *  every row or for none of them — a row that drops it on its own gets a
   *  wider value column than its neighbours, which shows up as a value that
   *  starts further right than the ones above it. */
  trailing?: boolean
  onEdit?: () => void
}): JSX.Element {
  return (
    <div className={cn(FM_ROW, trailing ? FM_COLS_EDIT : FM_COLS_PLAIN, 'group')}>
      <Icon
        name={icon}
        size={13}
        className={cn('justify-self-center', iconClass ?? 'codicon-muted')}
      />
      <span className="truncate text-c-2">{label}</span>
      <div className="flex min-w-0 items-center gap-2 text-c-1">
        <span className="min-w-0 flex-1">{children}</span>
        {issue}
      </div>
      {/* Held open even for a row with nothing to put in it (`id`), so the
          column stays a column. */}
      {trailing ? onEdit ? <EditPencil label={label} onClick={onEdit} /> : <span /> : null}
    </div>
  )
}

/**
 * The one way into editing, wherever it is offered — a row, or the closed bar.
 *
 * Faint until what it belongs to is pointed at, rather than hidden until then:
 * a control that only exists on hover cannot be found by looking, and a column
 * of full-strength pencils competes with the values beside them.
 */
function EditPencil({ label, onClick }: { label: string; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      title={`Edit ${label}`}
      aria-label={`Edit ${label}`}
      onClick={onClick}
      className="inline-flex shrink-0 items-center justify-center justify-self-end text-muted-foreground/40 transition-colors hover:text-c-1 group-hover:text-muted-foreground"
    >
      {/* `block leading-none` is what makes the button the size of the glyph.
          A codicon is an inline span, so without it the button's box is the
          row's own 19.5px line box with the 12px mark floating on its baseline
          — a button half again as tall as what it draws, sitting off-centre
          inside its own padding. */}
      <Icon name="edit" size={12} className="block leading-none codicon-inherit" />
    </button>
  )
}

/**
 * Which mark a property wears, and in what colour.
 *
 * Name first, then the shape of the value: `status` is a status wherever it
 * appears, but an unnamed property is only what its value makes it. Everything
 * falls through to a neutral mark rather than none, so the column of marks
 * stays a column and rows do not lose their left edge.
 */
function propertyMark(key: string, value: unknown): { icon: string; className?: string } {
  const k = key.toLowerCase()
  if (k === 'status' || k === 'state') return { icon: 'circle-filled', className: statusHue(value) }
  if (k === 'tags' || k === 'tag') return { icon: 'tag' }
  if (Array.isArray(value)) return { icon: 'list-unordered' }
  if (typeof value === 'boolean') return { icon: 'symbol-boolean' }
  const s = String(value ?? '')
  if (isDateLike(s)) return { icon: 'calendar', className: 'codicon-purple' }
  if (/^https?:\/\//i.test(s) || /^\[\[[^\]]+\]\]$/.test(s.trim())) return { icon: 'link' }
  if (/^-?\d+(\.\d+)?$/.test(s)) return { icon: 'symbol-numeric' }
  return { icon: 'symbol-string' }
}

/**
 * The dot beside a status, coloured by what the status says.
 *
 * Deliberately a short list of the words this vault actually uses: anything
 * unrecognised keeps the palette's blue rather than a hue picked per string,
 * because a colour that means nothing is worse than no colour.
 */
function statusHue(value: unknown): string {
  const s = String(value ?? '')
    .trim()
    .toLowerCase()
  if (/^(done|complete|completed|evergreen|active|published|shipped|live|resolved)$/.test(s)) {
    return 'codicon-emerald'
  }
  if (/^(draft|wip|in-progress|in progress|doing|review|pending|todo|seedling)$/.test(s)) {
    return 'codicon-amber'
  }
  if (/^(archived|dropped|cancelled|canceled|paused|dead|blocked)$/.test(s)) return 'codicon-grey'
  return 'codicon-blue'
}

function FmTypeSelect({
  value,
  autoFocus,
  onChange
}: {
  value: NoteTypeId
  autoFocus?: boolean
  onChange: (next: NoteTypeId) => void
}): JSX.Element {
  return (
    // The native arrow is stripped (`appearance-none`) so the control matches
    // the other fields, and drawn back on the right, where a select's arrow
    // lives. `pointer-events-none` on it so clicking the arrow opens the list:
    // an arrow you can click and have nothing happen is worse than no arrow.
    <span className={cn(FM_FIELD, 'relative pr-2')}>
      <select
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value as NoteTypeId)}
        className="w-full min-w-0 cursor-pointer appearance-none bg-transparent pr-5 text-c-1 outline-none"
      >
        {ALL_NOTE_TYPES.map((t) => (
          <option key={t} value={t} className="border border-bd-2 bg-bg-2 text-foreground">
            {NOTE_TYPE_LABELS[t]}
          </option>
        ))}
      </select>
      <Icon
        name="chevron-down"
        size={11}
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 codicon-muted"
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

/**
 * A value while the panel is being edited, in whatever shape its kind needs:
 * chips for a list, a picker beside a date, a switch for a flag, a field for
 * everything else.
 */
function FmValueField({
  value,
  autoFocus,
  onChange
}: {
  value: unknown
  autoFocus?: boolean
  onChange: (v: unknown) => void
}): JSX.Element {
  if (Array.isArray(value)) {
    return <FmTagsField value={value} onChange={onChange} />
  }
  if (typeof value === 'boolean') {
    return (
      <button
        type="button"
        autoFocus={autoFocus}
        onClick={() => onChange(!value)}
        className={cn(FM_FIELD, 'justify-between hover:border-bd-3')}
      >
        {value ? 'true' : 'false'}
        <Icon
          name={value ? 'pass-filled' : 'circle-slash'}
          size={12}
          className={value ? 'codicon-emerald' : 'codicon-muted'}
        />
      </button>
    )
  }
  const display = formatValue(value)
  if (/^\d{4}-\d{2}-\d{2}$/.test(display)) {
    return <FmDateField value={display} autoFocus={autoFocus} onChange={onChange} />
  }
  return <FmTextField value={value} display={display} autoFocus={autoFocus} onChange={onChange} />
}

/**
 * A plain value, typed.
 *
 * Uncommitted until focus leaves or Enter is pressed — a note is written to
 * disk on change, and one keystroke per save is a file rewritten per letter.
 * Escape puts the field back to what the note actually says.
 */
function FmTextField({
  value,
  display,
  autoFocus,
  onChange
}: {
  value: unknown
  display: string
  autoFocus?: boolean
  onChange: (v: unknown) => void
}): JSX.Element {
  const link = linkTarget(display)
  return (
    <span className={FM_FIELD}>
      <input
        autoFocus={autoFocus}
        defaultValue={display}
        key={display}
        placeholder={Array.isArray(value) ? 'comma, separated, tags' : ''}
        className={cn(
          'w-full min-w-0 bg-transparent outline-none placeholder:text-muted-foreground/50',
          link ? 'text-accent-1' : 'text-c-1'
        )}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            e.currentTarget.blur()
          }
          if (e.key === 'Escape') {
            e.stopPropagation()
            e.currentTarget.value = display
            e.currentTarget.blur()
          }
        }}
        onBlur={(e) => {
          const next = parseValue(value, e.target.value)
          if (next !== value) onChange(next)
        }}
      />
      {link ? (
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
      ) : null}
    </span>
  )
}

/**
 * A date, still typeable.
 *
 * The field stays text and stays ISO, because that is what the note says on
 * disk and what every other view of this property shows; the button beside it
 * opens the platform's own date picker over a hidden native input. `showPicker`
 * throws when the browser won't allow it — there is nothing to do about that
 * beyond leaving the text field, which is why it is caught and dropped.
 */
function FmDateField({
  value,
  autoFocus,
  onChange
}: {
  value: string
  autoFocus?: boolean
  onChange: (v: unknown) => void
}): JSX.Element {
  const picker = useRef<HTMLInputElement>(null)
  return (
    <span className={cn(FM_FIELD, 'relative pr-2')}>
      <input
        autoFocus={autoFocus}
        defaultValue={value}
        key={value}
        className="w-full min-w-0 bg-transparent tabular-nums outline-none"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            e.currentTarget.blur()
          }
          if (e.key === 'Escape') {
            e.stopPropagation()
            e.currentTarget.value = value
            e.currentTarget.blur()
          }
        }}
        onBlur={(e) => {
          if (e.target.value !== value) onChange(e.target.value)
        }}
      />
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pointer-events-none absolute bottom-0 right-2 h-0 w-0 opacity-0"
      />
      <button
        type="button"
        title="Pick a date"
        aria-label="Pick a date"
        onClick={() => {
          try {
            picker.current?.showPicker()
          } catch {
            picker.current?.focus()
          }
        }}
        className="shrink-0 text-muted-foreground transition-colors hover:text-c-1"
      >
        <Icon name="calendar" size={12} className="codicon-inherit" />
      </button>
    </span>
  )
}

/**
 * A list, as the chips it already looks like, each with its own way out.
 *
 * The alternative — one text field holding `a, b, c` — is how this used to
 * work, and it made removing the middle item an exercise in comma surgery.
 * Adding one is an input that appears in the row's own flow, so the new chip
 * lands where it is being typed.
 */
function FmTagsField({
  value,
  onChange
}: {
  value: unknown[]
  onChange: (v: string[]) => void
}): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const tags = value.map(String)

  function add(raw: string): void {
    const tag = raw.trim()
    setDraft(null)
    if (!tag || tags.includes(tag)) return
    onChange([...tags, tag])
  }

  return (
    <span className="flex w-full min-w-0 flex-wrap items-center gap-1.5 py-0.5">
      {tags.map((tag, i) => (
        <span
          key={`${tag}-${i}`}
          className="inline-flex max-w-full items-center gap-1.5 rounded-6 bg-bg-4 py-1 pl-2 pr-1.5 text-11 text-c-1"
        >
          <span className="min-w-0 truncate">{tag}</span>
          <button
            type="button"
            title={`Remove ${tag}`}
            aria-label={`Remove ${tag}`}
            onClick={() => onChange(tags.filter((_, j) => j !== i))}
            className="shrink-0 text-muted-foreground transition-colors hover:text-c-1"
          >
            <Icon name="close" size={9} className="codicon-inherit" />
          </button>
        </span>
      ))}
      {draft === null ? (
        <button
          type="button"
          onClick={() => setDraft('')}
          className="inline-flex items-center gap-1 rounded-6 px-1.5 py-1 text-11 text-muted-foreground/70 transition-colors hover:text-c-1"
        >
          <Icon name="add" size={10} className="codicon-inherit" />
          Add tag
        </button>
      ) : (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => add(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add(e.currentTarget.value)
            }
            if (e.key === 'Escape') {
              e.stopPropagation()
              setDraft(null)
            }
          }}
          placeholder="tag"
          className="w-24 rounded-6 border border-accent-1 bg-bg-4 px-1.5 py-1 text-11 text-c-1 outline-none placeholder:text-muted-foreground/60"
        />
      )}
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
 * A value, being read.
 *
 * What kind of thing it is is said by the row's mark, on the left, in the icon
 * palette's own hues — so the value is plain text and stays comparable with the
 * one above it. Only a link keeps a colour of its own, because there the colour
 * is not a category, it is "this goes somewhere".
 *
 * The one shape that survives is a list: chips, not a comma-separated run.
 */
function TypedValue({ value }: { value: unknown }): JSX.Element {
  if (Array.isArray(value)) {
    if (value.length === 0) return <Dash />
    // Chips, not a comma-separated run: a list of tags is a set of small
    // things, and commas made it read as one long value with punctuation in
    // it. The chip is the same shape the closed view uses, and neutral — the
    // row already sits on a fill, and a row of blue inside it was the loudest
    // thing on the note.
    return (
      <span className="inline-flex flex-wrap items-center gap-1 py-0.5">
        {value.map((v, i) => (
          <span
            key={i}
            className="inline-flex max-w-full items-center rounded-6 bg-bg-4 px-2 py-1 text-11 text-c-1"
          >
            {String(v)}
          </span>
        ))}
      </span>
    )
  }
  if (typeof value === 'boolean') {
    return <span>{value ? 'true' : 'false'}</span>
  }
  if (value === null || value === undefined || value === '') return <Dash />
  const s = String(value)
  const link = linkTarget(s)
  if (link) {
    return (
      <a
        href={link.kind === 'url' ? link.href : undefined}
        onClick={(e) => {
          e.preventDefault()
          openLink(link)
        }}
        className="break-all text-accent-1 underline decoration-accent-1/40 underline-offset-2 transition-colors hover:text-accent-1-hover"
      >
        {s}
      </a>
    )
  }
  // A date is left exactly as it is written on disk, not reformatted: the same
  // property in the editing state shows the raw value, and the two disagreeing
  // about what a note says is worse than a prettier month name.
  // A bare number — a target, a count, a version — is tabular, so a column of
  // them lines up on the digit rather than on the glyph widths.
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    return <span className="tabular-nums">{s}</span>
  }
  return <span className="break-words">{s}</span>
}

function Dash(): JSX.Element {
  return <span className="text-muted-foreground/40">—</span>
}

function isDateLike(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})?/.test(s)
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

/** One thing said on the closed bar. */
type Summary = {
  key: string
  text: string
  title: string
  icon?: string
  iconClass?: string
  /** Secondary: true for everything the eye should pass over on the way to
   *  the type and the status, which are what a note is. */
  quiet?: boolean
  flagged?: boolean
}

/**
 * What the closed bar says, in the order it says it.
 *
 * The type first, because it is the one property every note has and the one
 * that decides what the others mean. Then the note's own properties in the
 * order they are written on disk. `id` is left out: it is a handle for the
 * machine, it is never short, and it is the same shape on every note — three
 * reasons it is noise on a line whose whole job is a glance.
 *
 * Empty values are dropped rather than shown as a dash. On a bar, a dash is a
 * property you have to look up to find out means nothing.
 */
function summaryItems(
  type: string,
  entries: [string, unknown][],
  issues: Map<string, string[]>
): Summary[] {
  const typeLabel = NOTE_TYPE_LABELS[type as NoteTypeId] ?? type
  const items: Summary[] = [
    {
      key: 'type',
      text: typeLabel,
      title: `type: ${typeLabel}`,
      icon: 'book',
      iconClass: 'codicon-blue'
    }
  ]

  for (const [key, value] of entries) {
    const k = key.toLowerCase()
    const flagged = issues.has(key)
    if (Array.isArray(value)) {
      if (value.length === 0) continue
      // A count, not the items: three tags are three more things to read, and
      // the bar is one line. What they are is one click away.
      items.push({
        key,
        text: `${value.length} ${key}`,
        title: `${key}: ${value.map(String).join(', ')}`,
        quiet: true,
        flagged
      })
      continue
    }
    if (value === null || value === undefined || value === '') continue
    const s = String(value)
    if (k === 'status' || k === 'state') {
      items.push({
        key,
        text: s,
        title: `${key}: ${s}`,
        icon: 'circle-filled',
        iconClass: statusHue(value),
        flagged
      })
      continue
    }
    // Written out, unlike the open panel's raw ISO: nothing here is being
    // edited, so the date can be the one a person would say out loud.
    items.push({
      key,
      text: isDateLike(s) ? formatDate(s) : s,
      title: `${key}: ${s}`,
      quiet: true,
      flagged
    })
  }

  return items
}

function SummaryItem({ item }: { item: Summary }): JSX.Element {
  return (
    <span title={item.title} className="inline-flex min-w-0 shrink-0 items-center gap-1.5">
      {item.icon ? (
        <Icon
          name={item.icon}
          size={item.icon === 'circle-filled' ? 9 : 13}
          className={item.flagged ? 'codicon-amber' : (item.iconClass ?? 'codicon-muted')}
        />
      ) : null}
      <span
        className={cn(
          'truncate',
          item.flagged ? 'text-ic-amber' : item.quiet ? 'text-c-2' : 'text-c-1'
        )}
      >
        {item.text}
      </span>
    </span>
  )
}

function formatDate(s: string): string {
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}
