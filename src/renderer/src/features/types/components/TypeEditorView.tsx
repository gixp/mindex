import { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
  FIELD_KINDS,
  FIELD_KIND_LABELS,
  isEditableType,
  OPTION_COLORS,
  prettifyFieldName,
  type NoteFieldDef,
  type NoteFieldKind,
  type NoteTypeDef
} from '@shared/note-types'
import type { NoteTypeId } from '@shared/types'
import { useTypeEditorStore, type TypeEditorTab } from '@/features/types/store'
import { useNoteTypesStore } from '@/platform/note-types'
import { SourceEditor } from '@/features/editor/components/SourceEditor'
import { ConfirmDialog } from '@/ui/ConfirmDialog'
import { Icon } from '@/ui/icon'
import { Select } from '@/ui/select'
import { Switch } from '@/ui/switch'
import { cn } from '@/ui/cn'
import {
  DialogActions,
  DialogHeading,
  SMALL_DIALOG_BODY,
  SMALL_DIALOG_CONTENT,
  SMALL_DIALOG_OVERLAY
} from '@/ui/dialog-chrome'
import { templateVarHighlight } from './templateVars'
import { IconPicker } from '@/features/icon-picker/components/IconPicker'
import { typeIconColorClass } from '@/platform/presentation/type-icon'

const SAVE_DEBOUNCE_MS = 600

/** The variables `templates/engine.ts` substitutes when a note is created. */
const TEMPLATE_VARS = ['{{title}}', '{{id}}', '{{date}}', '{{datetime}}']

/** Shape and spacing shared by every editable value in here. */
const INPUT =
  'rounded-[7px] px-2 text-foreground outline-none transition-colors placeholder:text-muted-foreground/50'

/**
 * Filled and bordered — this value is editable right now.
 *
 * A collapsed field row wears `FIELD_REST` instead. Closed, the row is
 * something you are reading, and three filled boxes per line turned a list of
 * eight fields into a wall of boxes; opened, it is something you are editing,
 * and then the boxes are the point.
 */
const INPUT_LIVE = 'border border-border bg-bg-3 hover:border-bd-3 focus:border-accent-1/70'

/**
 * Collapsed, but still focusable. Clicking into a closed row's name used to
 * give no answer at all — the value took the caret and looked exactly as it
 * had a moment earlier.
 */
const INPUT_REST =
  'border border-transparent bg-transparent hover:bg-bg-3 focus:border-accent-1/70 focus:bg-bg-3'

/**
 * The app's icon palette (`codicon-blue`, `-emerald`, … in globals.css), as
 * chip colours. A value keeps its colour wherever it appears, because the
 * colour comes from the text rather than from its position in the list — so
 * `ACTIVE` looks the same on every type that has it, and adding a value above
 * it does not recolour everything below.
 */
const OPTION_COLOR_CLASS: Record<string, string> = {
  blue: 'bg-accent-1/15 text-accent-1',
  emerald: 'bg-emerald-400/15 text-emerald-400',
  amber: 'bg-amber-300/15 text-amber-300',
  purple: 'bg-purple-400/15 text-purple-400',
  cyan: 'bg-cyan-400/15 text-cyan-400',
  pink: 'bg-pink-400/15 text-pink-400',
  orange: 'bg-orange-400/15 text-orange-400',
  red: 'bg-red-400/15 text-red-400'
}

/** One line of the values row — label, chips and the add button all share it,
 *  so they line up exactly however the row wraps. */
const CHIP_ROW = 'flex h-[22px] items-center'

const OPTION_SWATCH_CLASS: Record<string, string> = {
  blue: 'bg-accent-1',
  emerald: 'bg-emerald-400',
  amber: 'bg-amber-300',
  purple: 'bg-purple-400',
  cyan: 'bg-cyan-400',
  pink: 'bg-pink-400',
  orange: 'bg-orange-400',
  red: 'bg-red-400'
}

/**
 * The colour a value wears: the one it was given, or one derived from the
 * text itself.
 *
 * The fallback matters — the shipped schemas carry dozens of values nobody
 * will ever open a dialog to colour, and leaving them all grey would make the
 * chips pointless. Deriving from the text rather than the position means a
 * value keeps its colour wherever it appears, and inserting one above it does
 * not recolour the rest.
 */
function chipColor(value: string, colors: Record<string, string> | undefined): string {
  const named = colors?.[value]
  if (named && OPTION_COLOR_CLASS[named]) return OPTION_COLOR_CLASS[named]!
  let hash = 0
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  const names = Object.keys(OPTION_COLOR_CLASS)
  return OPTION_COLOR_CLASS[names[hash % names.length]!]!
}

function fillVars(text: string): string {
  const now = new Date()
  return text
    .replace(/\{\{title\}\}/g, 'New note')
    .replace(/\{\{id\}\}/g, 'prj_01hxyz')
    .replace(/\{\{date\}\}/g, now.toISOString().slice(0, 10))
    .replace(/\{\{datetime\}\}/g, now.toISOString().slice(0, 16).replace('T', ' '))
}

/**
 * The note type editor, in the centre panel.
 *
 * The tab already carries the type's name and its badge, so there is no
 * heading here — a title repeated directly under itself is just a bigger
 * gap before the content.
 *
 * Edits autosave on a delay, the way notes do; nothing else in the app has an
 * explicit save.
 */
export function TypeEditorView({ typeId }: { typeId: string }): JSX.Element {
  const stored = useNoteTypesStore((s) => s.defOf(typeId))
  const save = useNoteTypesStore((s) => s.save)
  const tab = useTypeEditorStore((s) => s.editorTab)
  const setTab = useTypeEditorStore((s) => s.setEditorTab)

  const reset = useNoteTypesStore((s) => s.reset)
  const [draft, setDraft] = useState<NoteTypeDef | null>(stored)
  const [confirmReset, setConfirmReset] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Re-seed when the tab moves to a different type, or when a reset replaced
  // the stored definition underneath. Deliberately not on every store change:
  // our own optimistic save writes back, and re-seeding from that would fight
  // the cursor mid-word.
  useEffect(() => {
    setDraft(stored)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeId, stored?.overridden])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  function edit(next: NoteTypeDef): void {
    setDraft(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void save(next), SAVE_DEBOUNCE_MS)
  }

  if (!draft) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Unknown note type.
      </div>
    )
  }

  const def = draft

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-6 pt-4">
        <div className="flex items-center gap-6 border-b border-border">
          {(
            [
              ['fields', 'Fields'],
              ['template', 'Template'],
              ['location', 'Location']
            ] as [TypeEditorTab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                '-mb-px border-b-2 pb-2 text-[12.5px] transition-colors',
                tab === id
                  ? 'border-accent-1 text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {label}
            </button>
          ))}

          {/* On this row rather than the window's tab strip: these belong to
              the type you are editing, not to the tab that holds it. */}
          <div className="ml-auto flex items-center gap-3 pb-1.5">
            {def.overridden ? (
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                title="Restore the definition Mindex ships"
                className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
              >
                <Icon name="debug-restart" size={13} className="codicon-inherit" />
                Restore
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {tab === 'fields' ? (
          <FieldsTab fields={def.fields} onChange={(fields) => edit({ ...def, fields })} />
        ) : null}

        {tab === 'template' ? (
          <TemplateTab template={def.template} onChange={(t) => edit({ ...def, template: t })} />
        ) : null}

        {tab === 'location' ? <LocationTab def={def} onChange={edit} /> : null}
      </div>

      <ConfirmDialog
        open={confirmReset}
        title="Restore the default definition?"
        message={`This deletes .mindex/types/${def.id}.md. Your notes are untouched — only the definition goes back to what Mindex ships.`}
        confirmLabel="Restore"
        confirmIcon="debug-restart"
        destructive
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => {
          setConfirmReset(false)
          void reset(def.id as NoteTypeId)
        }}
      />
    </div>
  )
}

/**
 * The variable chips, above whatever they can be typed into.
 *
 * Drag drops the text where you let go — an `<input>` and CodeMirror both
 * accept a plain-text drop natively, so neither needs anything on its side.
 * Clicking appends instead, for when dragging is more precision than the job
 * deserves.
 */
function VariableChips({ onAppend }: { onAppend?(v: string): void }): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[11px] text-muted-foreground">Variables:</span>
      {TEMPLATE_VARS.map((v) => (
        <span
          key={v}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('text/plain', v)
            e.dataTransfer.effectAllowed = 'copy'
          }}
          onClick={() => onAppend?.(v)}
          title="Drag where you want it, or click to append"
          className="cursor-grab select-none rounded-[6px] bg-bg-3 px-1 py-0.5 font-mono text-[11px] text-accent-1 transition-colors hover:bg-bg-4 active:cursor-grabbing"
        >
          {v}
        </span>
      ))}
    </div>
  )
}

const VAR_SPLIT = /(\{\{\s*\w+\s*\}\})/g
/** Separate and non-global: `test` on a `/g/` regex advances `lastIndex`, so
 *  reusing VAR_SPLIT here would answer differently on alternate calls. */
const IS_VAR = /^\{\{\s*\w+\s*\}\}$/

/**
 * A single-line field that colours the `{{variables}}` inside it.
 *
 * An `<input>` cannot style part of its own value, so the text is drawn twice:
 * once by a backdrop that does the colouring, and once by the input itself
 * with transparent glyphs on top. The two must stay in exact typographic step
 * — same font, size and padding — or the caret drifts away from the letters,
 * which is why the shared classes are applied to both from one place.
 */
function VarInput({
  value,
  onChange,
  placeholder,
  className,
  onFocus
}: {
  value: string
  onChange(next: string): void
  placeholder?: string
  className?: string
  onFocus?(el: HTMLInputElement): void
}): JSX.Element {
  const backdropRef = useRef<HTMLDivElement>(null)
  const text = 'px-2 font-mono text-[12px] leading-8'

  return (
    <div
      className={cn(
        INPUT,
        INPUT_LIVE,
        // The border belongs to the wrapper, so the focus ring has to come
        // from the child's focus rather than the wrapper's own.
        'relative h-8 min-w-0 flex-1 px-0 focus-within:border-accent-1/70',
        className
      )}
    >
      <div
        ref={backdropRef}
        aria-hidden
        className={cn('pointer-events-none absolute inset-0 overflow-hidden whitespace-pre', text)}
      >
        {value.split(VAR_SPLIT).map((part, i) =>
          IS_VAR.test(part) ? (
            <span key={i} className="text-accent-1">
              {part}
            </span>
          ) : (
            <span key={i}>{part}</span>
          )
        )}
      </div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => onFocus?.(e.currentTarget)}
        // Keeps the backdrop aligned once the value is longer than the box.
        onScroll={(e) => {
          if (backdropRef.current) backdropRef.current.scrollLeft = e.currentTarget.scrollLeft
        }}
        placeholder={placeholder}
        spellCheck={false}
        className={cn(
          'absolute inset-0 w-full border-0 bg-transparent text-transparent caret-foreground outline-none placeholder:text-muted-foreground/50',
          text
        )}
      />
    </div>
  )
}

/** One source for the column widths, so the labels line up with the controls. */
const COL_GRIP = 'w-[17px] shrink-0'
const COL_KEY = 'w-[200px] shrink-0'
const COL_LABEL = 'min-w-0 flex-1'
const COL_KIND = 'w-[116px] shrink-0'
const COL_REQUIRED = 'w-[64px] shrink-0'
const COL_DELETE = 'mr-1 w-[14px] shrink-0'

// ── Fields ──────────────────────────────────────────────────────────────────

interface DropTarget {
  index: number
  /** Above the row rather than below it — decided by which half you are over. */
  before: boolean
}

function FieldsTab({
  fields,
  onChange
}: {
  fields: NoteFieldDef[]
  onChange(fields: NoteFieldDef[]): void
}): JSX.Element {
  const [dragging, setDragging] = useState<number | null>(null)
  const [target, setTarget] = useState<DropTarget | null>(null)
  const rowRefs = useRef<(HTMLDivElement | null)[]>([])

  function update(index: number, patch: Partial<NoteFieldDef>): void {
    onChange(fields.map((f, i) => (i === index ? { ...f, ...patch } : f)))
  }

  function drop(): void {
    if (dragging === null || !target) return
    const to = target.before ? target.index : target.index + 1
    const next = [...fields]
    const [row] = next.splice(dragging, 1)
    if (row) {
      next.splice(to > dragging ? to - 1 : to, 0, row)
      onChange(next)
    }
    setDragging(null)
    setTarget(null)
  }

  function add(): void {
    // A name that cannot collide, so the new row is addressable the moment it
    // appears rather than merging with an existing one.
    let n = 1
    let name = 'field'
    while (fields.some((f) => f.name === name)) name = `field${++n}`
    onChange([...fields, { name, label: prettifyFieldName(name), kind: 'text', required: false }])
  }

  return (
    <div className="w-full">
      {fields.length === 0 ? (
        <div className="rounded-[10px] border border-dashed border-border px-4 py-6 text-center text-[12px] text-muted-foreground">
          No fields yet.
        </div>
      ) : (
        // One header for the list, not one per row: with nothing left to
        // expand, every row is the same shape and the columns only need
        // naming once.
        <div className="flex items-center gap-2.5 px-2 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground/60">
          <span className={COL_GRIP} />
          <span className={cn(COL_KEY, 'px-2')}>Key</span>
          <span className={cn(COL_LABEL, 'px-2')}>Label</span>
          <span className={cn(COL_KIND, 'px-2')}>Type</span>
          <span className={COL_REQUIRED}>Required</span>
          <span className={COL_DELETE} />
        </div>
      )}

      <div className="flex flex-col" onDragEnd={() => (setDragging(null), setTarget(null))}>
        {fields.map((field, i) => {
          const showLine = target !== null && dragging !== null && target.index === i
          // Two kinds carry a setting the row cannot hold in a column. They
          // get a second line, always visible: there is no longer anywhere to
          // hide it, and hiding it was what the accordion was for.
          const extra = field.kind === 'select' || field.kind === 'relation'
          return (
            <div key={`${field.name}-${i}`} className="relative">
              {showLine && target.before ? <DropLine /> : null}

              <div
                ref={(el) => {
                  rowRefs.current[i] = el
                }}
                onDragOver={(e) => {
                  if (dragging === null) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  const box = e.currentTarget.getBoundingClientRect()
                  setTarget({ index: i, before: e.clientY < box.top + box.height / 2 })
                }}
                onDrop={(e) => {
                  if (dragging === null) return
                  e.preventDefault()
                  drop()
                }}
                className={cn(
                  // Every row carries its own surface at rest, so the list
                  // reads as a stack of things rather than free-floating text.
                  'my-[3px] rounded-[9px] border border-transparent bg-bg-3 transition-colors hover:bg-bg-4',
                  dragging === i && 'opacity-40'
                )}
              >
                <div className="flex items-center gap-2.5 px-2 py-1.5">
                  <span
                    draggable
                    onDragStart={(e) => {
                      setDragging(i)
                      e.dataTransfer.effectAllowed = 'move'
                      // The whole row follows the cursor. Dragging the grip
                      // alone showed a lone dotted handle floating over the
                      // list, which said nothing about what was moving.
                      const row = rowRefs.current[i]
                      if (row) {
                        const box = row.getBoundingClientRect()
                        e.dataTransfer.setDragImage(row, e.clientX - box.left, e.clientY - box.top)
                      }
                    }}
                    title="Drag to reorder"
                    className={cn(
                      COL_GRIP,
                      'cursor-grab select-none text-muted-foreground active:cursor-grabbing'
                    )}
                  >
                    <Icon name="gripper" size={13} />
                  </span>

                  <input
                    value={field.name}
                    onChange={(e) => update(i, { name: e.target.value.trim() })}
                    spellCheck={false}
                    title="The frontmatter key, exactly as it appears in the file"
                    className={cn(INPUT, INPUT_REST, COL_KEY, 'h-7 font-mono text-[12px]')}
                  />
                  <input
                    value={field.label}
                    onChange={(e) => update(i, { label: e.target.value })}
                    placeholder={prettifyFieldName(field.name)}
                    title="What the frontmatter panel calls it"
                    className={cn(INPUT, INPUT_REST, COL_LABEL, 'h-7 text-[12px]')}
                  />

                  <div className={COL_KIND}>
                    <Select<NoteFieldKind>
                      value={field.kind}
                      onChange={(kind) => update(i, { kind })}
                      // Same surface as the inputs beside it — one more
                      // editable value on the row, not a different class of
                      // control.
                      triggerClassName="rounded-[7px] border-transparent bg-transparent hover:bg-bg-3"
                      options={FIELD_KINDS.map((k) => ({ value: k, label: FIELD_KIND_LABELS[k] }))}
                    />
                  </div>

                  <div className={COL_REQUIRED}>
                    <Switch
                      checked={field.required}
                      onCheckedChange={(required) => update(i, { required })}
                      ariaLabel={`${field.name} is required`}
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => onChange(fields.filter((_, j) => j !== i))}
                    title="Remove field"
                    aria-label={`Remove ${field.name}`}
                    className={cn(
                      COL_DELETE,
                      'text-muted-foreground transition-colors hover:text-red-400'
                    )}
                  >
                    <Icon name="trash" size={13} className="codicon-inherit" />
                  </button>
                </div>

                {extra ? (
                  <div className="pb-2.5">
                    {/* Inset rather than a border on the panel: a rule that
                        runs into the rounded corners reads as a crack across
                        the card instead of a break between its two halves. */}
                    <div className="px-2">
                      <div className="h-px bg-bd-2" />
                    </div>
                    <div className="px-3 pt-2.5">
                      {field.kind === 'select' ? (
                        <OptionsEditor
                          options={field.options ?? []}
                          colors={field.optionColors ?? {}}
                          onChange={(options, optionColors) => update(i, { options, optionColors })}
                        />
                      ) : (
                        <RelationTarget
                          value={field.relationTo ?? ''}
                          onChange={(relationTo) => update(i, { relationTo })}
                        />
                      )}
                    </div>
                  </div>
                ) : null}
              </div>

              {showLine && !target.before ? <DropLine /> : null}
            </div>
          )
        })}
      </div>

      <button
        type="button"
        onClick={add}
        className="ml-2 mt-3 inline-flex items-center gap-1.5 text-[12.5px] text-accent-1 transition-colors hover:text-accent-1-hover"
      >
        <Icon name="add" size={12} className="codicon-inherit" />
        Add field
      </button>
    </div>
  )
}

/** Where the row lands if you let go now. */
function DropLine(): JSX.Element {
  return <div className="pointer-events-none h-0.5 rounded-full bg-accent-1" />
}

/**
 * Which type a link field points at.
 *
 * A free-text box asking for a type id was the wrong question twice over: it
 * expected you to know the ids, and the answer it showed back — "Points at
 * organization" — read like a statement rather than a setting. A named
 * dropdown of the types that exist answers it without either problem.
 */
function RelationTarget({
  value,
  onChange
}: {
  value: string
  onChange(next: string): void
}): JSX.Element {
  const defs = useNoteTypesStore((s) => s.defs)
  const options = [
    { value: '', label: 'Any note' },
    ...defs.filter((d) => isEditableType(d.id)).map((d) => ({ value: d.id, label: d.label }))
  ]

  return (
    <label className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
      Links to
      <Select
        value={value}
        onChange={onChange}
        options={options}
        // The same bare treatment as the Type select on the line above: on a
        // row where every other control is transparent until you touch it, a
        // framed one reads as a different kind of thing. `border-border` is
        // also a hard dark line on this surface rather than the hairline it
        // looks like against a panel.
        triggerClassName="rounded-[7px] border-transparent bg-transparent hover:bg-bg-3"
      />
    </label>
  )
}

/**
 * Follow the case the field already uses.
 *
 * Most shipped enums shout — `ACTIVE`, `P1`, `OWN_BUSINESS` — so a value typed
 * in lower case looks broken next to them. But not all of them do: `role` is
 * `team`, `partner`, `client`. Forcing upper case would quietly corrupt that
 * field, and these strings have to match the frontmatter exactly.
 *
 * So the convention is read off the values that are already there rather than
 * imposed, and a field with nothing in it yet is left alone — there is nothing
 * to conform to.
 */
function matchCase(value: string, options: string[]): string {
  if (!value) return value
  const lettered = options.filter((o) => /[a-z]/i.test(o))
  if (lettered.length === 0) return value
  if (lettered.every((o) => o === o.toUpperCase())) return value.toUpperCase()
  if (lettered.every((o) => o === o.toLowerCase())) return value.toLowerCase()
  return value
}

function OptionsEditor({
  options,
  colors,
  onChange
}: {
  options: string[]
  colors: Record<string, string>
  onChange(options: string[], colors: Record<string, string>): void
}): JSX.Element {
  // `null` when closed. An empty `original` means the dialog is adding rather
  // than editing — the same form either way, because they ask for the same two
  // things.
  const [editing, setEditing] = useState<{ original: string } | null>(null)

  function commit(original: string, value: string, color: string): void {
    const next = original ? value : matchCase(value, options)
    if (!next) return
    const list = original
      ? options.map((o) => (o === original ? next : o))
      : options.includes(next)
        ? options
        : [...options, next]

    const nextColors = { ...colors }
    if (original && original !== next) delete nextColors[original]
    if (color) nextColors[next] = color
    else delete nextColors[next]

    onChange(list, nextColors)
  }

  function remove(value: string): void {
    const nextColors = { ...colors }
    delete nextColors[value]
    onChange(
      options.filter((o) => o !== value),
      nextColors
    )
  }

  return (
    // `items-start` with a fixed row height on the label and the button: once
    // the values wrap, centring against the whole block drifts them down the
    // side of it. They belong on the first line, where the row starts.
    <div className="flex items-start gap-2">
      {/* Beside the values, not above them: the word is a label for the row it
          sits on. */}
      <span className={cn(CHIP_ROW, 'shrink-0 text-[11px] text-muted-foreground')}>Values</span>

      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {options.map((option) => (
          <span
            key={option}
            className={cn(
              CHIP_ROW,
              'inline-flex items-center gap-1 rounded-[6px] pl-2 pr-1 font-mono text-[11px]',
              chipColor(option, colors)
            )}
          >
            <button
              type="button"
              onClick={() => setEditing({ original: option })}
              title="Edit value"
              className="cursor-pointer"
            >
              {option}
            </button>
            <button
              type="button"
              onClick={() => remove(option)}
              aria-label={`Remove ${option}`}
              // Always visible: hiding it until hover meant the only way to
              // find out a value could be removed was to go looking.
              className="opacity-60 transition-opacity hover:opacity-100"
            >
              <Icon name="close" size={9} className="codicon-inherit" />
            </button>
          </span>
        ))}

        {/* Last in the flow, not pinned to the edge: it adds to the end of the
            list, so that is where it should be — and it wraps with the chips
            instead of floating away from them.

            A button rather than a permanently open text box; the box was a
            field you were never actually filling in, sitting there asking. */}
        <button
          type="button"
          onClick={() => setEditing({ original: '' })}
          title="Add a value"
          aria-label="Add a value"
          className={cn(
            CHIP_ROW,
            'inline-flex w-[22px] shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground'
          )}
        >
          <Icon name="add" size={11} className="codicon-inherit" />
        </button>
      </div>

      {editing ? (
        <ValueDialog
          original={editing.original}
          color={editing.original ? (colors[editing.original] ?? '') : ''}
          taken={options.filter((o) => o !== editing.original)}
          onClose={() => setEditing(null)}
          onSave={(value, color) => {
            commit(editing.original, value, color)
            setEditing(null)
          }}
        />
      ) : null}
    </div>
  )
}

/** Add or rename one choice value, and pick the colour it wears. */
function ValueDialog({
  original,
  color,
  taken,
  onClose,
  onSave
}: {
  original: string
  color: string
  taken: string[]
  onClose(): void
  onSave(value: string, color: string): void
}): JSX.Element {
  const [value, setValue] = useState(original)
  const [picked, setPicked] = useState(color)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 20)
    return () => clearTimeout(t)
  }, [])

  const trimmed = value.trim()
  const duplicate = trimmed.length > 0 && taken.includes(trimmed)
  const canSave = trimmed.length > 0 && !duplicate

  return (
    <Dialog.Root open onOpenChange={(next) => (next ? undefined : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay style={{ zIndex: 70 }} className={SMALL_DIALOG_OVERLAY} />
        <Dialog.Content
          style={{ zIndex: 70 }}
          className={SMALL_DIALOG_CONTENT}
          aria-describedby={undefined}
        >
          <div className={SMALL_DIALOG_BODY}>
            <DialogHeading
              title={original ? 'Edit value' : 'Add a value'}
              message="This is written into the note's frontmatter exactly as typed."
              onClose={onClose}
            />

            <div className="mt-4">
              <input
                ref={inputRef}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canSave) {
                    e.preventDefault()
                    onSave(trimmed, picked)
                  }
                }}
                spellCheck={false}
                placeholder="ACTIVE"
                className={cn(INPUT, INPUT_LIVE, 'h-8 w-full font-mono text-[12.5px]')}
              />
              {duplicate ? (
                <div className="mt-1 text-[11px] text-amber-400">
                  This field already has that value.
                </div>
              ) : null}
            </div>

            <div className="mt-4">
              <div className="text-[11px] text-muted-foreground">Colour</div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {/* An explicit "no colour": without it, a value given a colour
                    by mistake could never be handed back to the automatic one. */}
                <ColorSwatch
                  active={picked === ''}
                  onClick={() => setPicked('')}
                  className="border border-dashed border-bd-3"
                />
                {OPTION_COLORS.map((name) => (
                  <ColorSwatch
                    key={name}
                    active={picked === name}
                    onClick={() => setPicked(name)}
                    className={OPTION_SWATCH_CLASS[name]}
                    title={name}
                  />
                ))}
              </div>

              <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
                Preview
                <span
                  className={cn(
                    'rounded-[6px] px-2 py-0.5 font-mono text-[11px]',
                    chipColor(trimmed || 'VALUE', picked ? { [trimmed || 'VALUE']: picked } : {})
                  )}
                >
                  {trimmed || 'VALUE'}
                </span>
              </div>
            </div>

            <DialogActions
              confirmLabel={original ? 'Save' : 'Add'}
              onCancel={onClose}
              onConfirm={() => {
                if (canSave) onSave(trimmed, picked)
              }}
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ColorSwatch({
  active,
  onClick,
  className,
  title
}: {
  active: boolean
  onClick(): void
  className?: string
  title?: string
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? 'No colour'}
      aria-label={title ?? 'No colour'}
      aria-pressed={active}
      className={cn(
        'size-5 rounded-full transition-transform',
        active ? 'ring-2 ring-foreground/60 ring-offset-2 ring-offset-card' : 'hover:scale-110',
        className
      )}
    />
  )
}

// ── Template ────────────────────────────────────────────────────────────────

function TemplateTab({
  template,
  onChange
}: {
  template: string
  onChange(next: string): void
}): JSX.Element {
  const preview = useTypeEditorStore((s) => s.templatePreview)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0">
        <VariableChips
          onAppend={(v) => onChange(`${template}${template.endsWith('\n') ? '' : '\n'}${v}`)}
        />
      </div>

      <div className="mt-3 min-h-0 flex-1 overflow-hidden rounded-[10px] border border-border">
        {preview ? (
          <pre className="h-full overflow-auto whitespace-pre-wrap bg-bg-3 p-3 font-mono text-[12px] leading-relaxed">
            {fillVars(template) || 'Nothing yet — this type creates an empty note.'}
          </pre>
        ) : (
          <SourceEditor
            value={template}
            onChange={onChange}
            extraExtensions={templateVarHighlight}
          />
        )}
      </div>
    </div>
  )
}

// ── Location ───────────────────────────────────────────────────────────────

function LocationTab({
  def,
  onChange
}: {
  def: NoteTypeDef
  onChange(next: NoteTypeDef): void
}): JSX.Element {
  const [picking, setPicking] = useState(false)
  // Which field a clicked chip lands in. Without it the chips could only ever
  // append to one hard-coded field, which is not what "use them anywhere"
  // means.
  const focused = useRef<'folder' | 'filename' | null>(null)

  const folder = def.defaultFolder ? `${def.defaultFolder}/` : ''

  function append(v: string): void {
    if (focused.current === 'folder') onChange({ ...def, defaultFolder: def.defaultFolder + v })
    else onChange({ ...def, filenamePattern: def.filenamePattern + v })
  }

  return (
    <div className="max-w-[560px] space-y-5">
      <VariableChips onAppend={append} />

      <Row label="Name">
        <input
          value={def.label}
          onChange={(e) => onChange({ ...def, label: e.target.value })}
          className={cn(INPUT, INPUT_LIVE, 'h-8 w-full text-[12.5px]')}
        />
      </Row>

      <Row label="Default folder">
        <VarInput
          value={def.defaultFolder}
          onChange={(v) => onChange({ ...def, defaultFolder: v })}
          onFocus={() => (focused.current = 'folder')}
          placeholder="vault root"
          className="w-full"
        />
      </Row>

      <Row label="File name">
        {/* The icon sits with the file name because that is where it is
            spent: together they are how a note of this type shows up in the
            tree. It had a row and a text box of its own, which asked you to
            know codicon names by heart. */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPicking(true)}
            title="Change icon"
            aria-label="Change icon"
            className={cn(
              INPUT,
              INPUT_LIVE,
              'inline-flex size-8 shrink-0 items-center justify-center px-0'
            )}
          >
            <Icon name={def.icon} size={15} className={typeIconColorClass(def.color)} />
          </button>
          <VarInput
            value={def.filenamePattern}
            onChange={(v) => onChange({ ...def, filenamePattern: v })}
            onFocus={() => (focused.current = 'filename')}
            // The example is what an empty field would produce, so it belongs
            // where the value goes rather than as a line of prose underneath.
            placeholder={`${folder}${fillVars(def.filenamePattern) || '{{title}}.md'}`}
          />
        </div>
      </Row>

      <IconPicker
        open={picking}
        onOpenChange={setPicking}
        title={def.label}
        current={def.icon}
        currentColor={typeIconColorClass(def.color)}
        onPick={(codicon) => {
          onChange({ ...def, icon: codicon })
          setPicking(false)
        }}
        onPickColor={(color) => onChange({ ...def, color: color ?? '' })}
      />
    </div>
  )
}

/**
 * Label over control, nothing between them. The explanatory lines that used to
 * sit under each field mostly restated the label, at twice the height.
 */
function Row({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div>
      <div className="mb-1.5 text-[11.5px] font-medium">{label}</div>
      {children}
    </div>
  )
}
