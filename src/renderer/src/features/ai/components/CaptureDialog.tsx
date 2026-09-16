import type { AppSettings } from '@shared/types'
import { api } from '@/platform/api'
import { useUiStore } from '@/platform/app-settings'
import { EffortSlider } from '@/features/chat/components/EffortSlider'
import { ModelMenu } from '@/features/chat/components/ModelMenu'
import { useMemo, useState, type ReactNode } from 'react'
import type { CaptureDraft } from '@shared/ai'
import type { NoteTypeDef } from '@shared/note-types'
import { StandardDialog } from '@/ui/StandardDialog'
import { Icon } from '@/ui/icon'
import { cn } from '@/ui/cn'
import { Select, type SelectOption } from '@/ui/select'
import { ErrorWindow } from '@/ui/ErrorWindow'
import { ActionButton } from '@/ui/action-button'
import { useNoteTypesStore } from '@/platform/note-types'
import { useVaultStore } from '@/platform/workspace'
import { draftPath, fileableTypes, isLoneUrl, sourceLabel } from './capture-draft'

/**
 * Everything the window can change about a draft before it is written.
 *
 * All six, not two. The window used to send back a title and a folder and keep
 * the rest of the assistant's answer as given — including the type, which is
 * the field most likely to be wrong, and the body, which is the part being
 * kept.
 */
export interface DraftEdits {
  title: string
  folder: string
  type: string
  body: string
  tags: string[]
  links: string[]
}

/**
 * Filing something as a note, in four steps of one window.
 *
 * The window is up from the moment it is asked for and only changes what it
 * shows — a field, the wait, then the draft or the reason it produced none.
 * Opening it on the answer meant the click produced nothing for the seconds
 * that took, which reads as a control that does not work.
 *
 * Its buttons are the app's own: the shared action metrics and the shared
 * affirmative fill, not a set of numbers invented here.
 */
export function CaptureDialog(
  props:
    | { input: true; initialText?: string; onSubmit(text: string): void; onCancel(): void }
    | { working: true; material: string; onCancel(): void }
    | { failure: string; onRetry(): void; onCancel(): void }
    | {
        draft: CaptureDraft
        busy: boolean
        onCreate(next: DraftEdits): void
        onCancel(): void
      }
): JSX.Element {
  if ('input' in props) {
    return (
      <InputStep
        initialText={props.initialText ?? ''}
        onSubmit={props.onSubmit}
        onCancel={props.onCancel}
      />
    )
  }
  if ('failure' in props) {
    return <FailureStep message={props.failure} onRetry={props.onRetry} onCancel={props.onCancel} />
  }
  if ('working' in props) return <WorkingStep material={props.material} onCancel={props.onCancel} />
  return <DraftStep {...props} />
}

/**
 * The shell every step shares.
 *
 * `stepKey` restarts the arrival animation when the step changes: the window
 * stays where it is and its contents move, which is what tells you something
 * happened without the whole thing flashing out and back.
 *
 * The subtitle changes with the step. One fixed line had to cover four
 * different moments and so said something true but useless in three of them.
 */
function Shell({
  stepKey,
  subtitle,
  children,
  onClose
}: {
  stepKey: string
  subtitle: string
  children: ReactNode
  onClose(): void
}): JSX.Element {
  return (
    <StandardDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      icon="inbox"
      title="Capture"
      subtitle={subtitle}
      width={640}
      height="auto"
    >
      <div key={stepKey} className="ai-step flex flex-col gap-4">
        {children}
      </div>
    </StandardDialog>
  )
}

/**
 * What was handed in, said back in one line.
 *
 * A link and a passage are handled differently — the page behind an address is
 * read first — and knowing which one this is about to be is worth a line. It
 * also answers the quieter question of whether the paste actually landed.
 */
function materialSummary(text: string): { icon: string; label: string } {
  const trimmed = text.trim()
  if (isLoneUrl(trimmed)) {
    return { icon: 'globe', label: `${sourceLabel(trimmed)} — the page will be read first` }
  }
  const words = trimmed.split(/\s+/).filter(Boolean).length
  return {
    icon: 'symbol-text',
    label: `${words.toLocaleString()} ${words === 1 ? 'word' : 'words'}`
  }
}

function InputStep({
  initialText,
  onSubmit,
  onCancel
}: {
  initialText: string
  onSubmit(text: string): void
  onCancel(): void
}): JSX.Element {
  const [text, setText] = useState(initialText)
  const ready = text.trim().length > 0

  return (
    <Shell
      stepKey="input"
      subtitle="A link or a passage. Nothing is written yet."
      onClose={onCancel}
    >
      {/* Field and actions in one box.

          The buttons sit under it rather than inside its corner. Inside, they
          shared the field's edge and its focus, so pressing one meant pressing
          something drawn as part of what you had just typed. Under it they are
          plainly the two things you do *with* what is in the box, and the row
          reads left to right: what was understood, then the way out, then the
          one that files it. */}
      <div className="flex flex-col gap-2 rounded-r2 border border-bd-2 bg-bg-1 p-2.5 transition-colors focus-within:border-bd-3">
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          // Enter sends; a newline needs Shift, as in every composer here. A
          // link is one line, which is the common case by a distance.
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && ready) {
              e.preventDefault()
              onSubmit(text.trim())
            }
          }}
          placeholder="Paste a link, or the text itself"
          rows={8}
          className="resize-none bg-transparent px-1 pt-0.5 text-12.5 leading-relaxed text-c-1 outline-none placeholder:text-c-2"
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        {/* What the field is holding, read back as it is typed. Empty until
            there is something to say, so it never sits there as furniture. */}
        {/* Who writes the note, where the word count used to be.
            The count said how much you had pasted, which you could see; this
            says who is about to read it, which you could not. */}
        <CaptureModel />

        <div className="flex shrink-0 items-center gap-2">
          <ActionButton size="sm" tone="ghost" onClick={onCancel}>
            Cancel
          </ActionButton>
          {/* The shortcut lives on the button rather than as a chip beside it:
              the button is the affordance, and a hint repeating what is written
              on it is furniture. */}
          <ActionButton
            size="sm"
            tone="primary"
            icon="screen-full"
            title="Capture — ⏎"
            disabled={!ready}
            onClick={() => onSubmit(text.trim())}
          >
            Capture
          </ActionButton>
        </div>
      </div>
    </Shell>
  )
}

function WorkingStep({ material, onCancel }: { material: string; onCancel(): void }): JSX.Element {
  const summary = materialSummary(material)

  return (
    <Shell
      stepKey="working"
      subtitle="Reading it, and working out where it belongs."
      onClose={onCancel}
    >
      {/* What is being worked on, so the wait is attached to something rather
          than being a spinner over an empty window. */}
      <div className="flex items-center gap-2 rounded-r3 border border-bd-2 px-3 py-2 text-11 text-c-2">
        <Icon name={summary.icon} size={11} className="shrink-0 codicon-muted" />
        <span className="truncate">{summary.label}</span>
      </div>

      {/* Three lines of nothing, breathing. An honest stand-in for a draft
          whose shape is not known yet — not a fake progress bar, which would
          be claiming to know how far along it is. */}
      <div className="flex flex-col gap-2 py-1" aria-hidden>
        <Bar className="w-1/3" />
        <Bar className="w-full" />
        <Bar className="w-4/5" />
      </div>

      {/* The one thing there is to do while waiting sits on the line that says
          what is being waited for, rather than in a row of its own below it. */}
      <div className="flex items-center justify-between gap-3">
        <p className="flex min-w-0 items-center gap-2 text-12.5 text-c-2">
          <Icon name="loading" size={13} className="codicon-modifier-spin codicon-muted" />
          Writing the note…
        </p>
        <ActionButton size="sm" onClick={onCancel}>
          Cancel
        </ActionButton>
      </div>
    </Shell>
  )
}

/** One line of the waiting state's placeholder. */
function Bar({ className }: { className: string }): JSX.Element {
  return <div className={cn('capture-shimmer h-2 rounded-full bg-bg-3', className)} />
}

/**
 * A capture that produced nothing, in the window every failure uses.
 *
 * It used to be a fourth face of this window with its own layout — and a dead
 * end: the reason, and a Close button. Whatever had been pasted was gone with
 * it, which for a long passage means going and finding it again. The way out
 * is now back to the field, with the material still in it.
 */
function FailureStep({
  message,
  onRetry,
  onCancel
}: {
  message: string
  onRetry(): void
  onCancel(): void
}): JSX.Element {
  return (
    <ErrorWindow
      open
      title="Capture"
      subtitle="Nothing was written. What you handed in is still here."
      detail={message}
      actionLabel="Try again"
      actionIcon="refresh"
      onAction={onRetry}
      onDismiss={onCancel}
    />
  )
}

function DraftStep({
  draft,
  busy,
  onCreate,
  onCancel
}: {
  draft: CaptureDraft
  busy: boolean
  onCreate(next: DraftEdits): void
  onCancel(): void
}): JSX.Element {
  const allDefs = useNoteTypesStore((s) => s.defs)
  const dirs = useVaultStore((s) => s.dirs)
  const notes = useVaultStore((s) => s.notes)

  const [title, setTitle] = useState(draft.title)
  const [folder, setFolder] = useState(draft.folder)
  const [type, setType] = useState(draft.type)
  const [body, setBody] = useState(draft.body)
  const [tags, setTags] = useState(draft.tags)
  const [links, setLinks] = useState(draft.links)

  // Only types that write a markdown file — the same rule the main process
  // applies before the assistant is asked, so the picker cannot offer something
  // the writer would refuse.
  const types = useMemo(() => fileableTypes(allDefs), [allDefs])
  const typeOptions: SelectOption<string>[] = types.map((d) => ({ value: d.id, label: d.label }))

  // Where it lands, resolved through the same rules the writer uses. Shown
  // because it was previously only discoverable after the fact — a name already
  // taken arrived as a toast, and a type with no extension in its pattern
  // arrived as a file that was not a note.
  const path = draftPath(types, type, title, folder)
  const taken = path ? notes.some((n) => n.relPath === path) : false
  const ready = !busy && title.trim().length > 0 && body.trim().length > 0 && !!path && !taken

  return (
    <Shell
      stepKey="draft"
      subtitle="Correct anything. Nothing is written until you create the note."
      onClose={onCancel}
    >
      {/* The note's name, drawn as a name. It was a labelled field the same
          size as every other, which made the one thing the note will be called
          look like a form entry. */}
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Untitled"
        aria-label="Title"
        className="w-full bg-transparent text-15 font-medium leading-tight text-c-1 outline-none placeholder:text-c-2"
      />

      {/* Where it goes: the type, the folder, and the file that results — one
          card, because they are one decision. They were three separate rows and
          the path underneath them read as a fourth unrelated thing. */}
      <div className="flex flex-col gap-2.5 rounded-r2 border border-bd-2 p-2.5">
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-11 text-c-2">File as</span>
          <div className="w-40 shrink-0">
            {/* A picker, not a label. The type is the field the assistant is
                most likely to get wrong and was the only one that could not be
                corrected — the window showed it as text and wrote it anyway. */}
            <Select
              value={type}
              onChange={setType}
              options={typeOptions}
              size="md"
              title="File it as"
              triggerClassName={FIELD_TRIGGER}
            />
          </div>
          <span className="shrink-0 text-11 text-c-2">in</span>
          <input
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder={typeDefault(types, type) || 'the vault root'}
            aria-label="Folder"
            list="capture-folders"
            className={cn(FIELD, 'min-w-0 flex-1')}
          />
          {/* The vault's real folders, offered rather than imposed: a folder
              that does not exist yet is a legitimate answer and gets created. */}
          <datalist id="capture-folders">
            {dirs.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </div>

        <PathLine path={path} taken={taken} />
      </div>

      {tags.length > 0 || links.length > 0 || draft.source ? (
        <div className="flex flex-wrap items-center gap-1">
          {tags.map((tag) => (
            <Chip key={tag} onRemove={() => setTags((v) => v.filter((x) => x !== tag))}>
              #{tag}
            </Chip>
          ))}
          {links.map((l) => (
            <Chip key={l} icon="link" onRemove={() => setLinks((v) => v.filter((x) => x !== l))}>
              {l.split('/').pop()}
            </Chip>
          ))}
          {draft.source ? <Chip icon="globe">{sourceLabel(draft.source)}</Chip> : null}
        </div>
      ) : null}

      {/* Editable, and drawn as the page it will become rather than as a field.
          Every other value on this window is correctable and this one — the part
          actually being kept — was read-only. */}
      <div className="flex flex-col gap-1.5 rounded-r2 border border-bd-2 p-3 transition-colors focus-within:border-bd-3">
        <span className="text-11 text-c-2">The note</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={10}
          aria-label="The note"
          className="max-h-[280px] resize-none overflow-y-auto bg-transparent text-12.5 leading-relaxed text-c-1 outline-none"
        />
      </div>

      <Actions
        onCancel={onCancel}
        confirmLabel={busy ? 'Creating…' : 'Create note'}
        confirmIcon="check"
        disabled={!ready}
        onConfirm={() =>
          onCreate({ title: title.trim(), folder: folder.trim(), type, body, tags, links })
        }
      />
    </Shell>
  )
}

/** The type's own folder, for the placeholder — what happens if you type none. */
function typeDefault(defs: NoteTypeDef[], id: string): string {
  return defs.find((d) => d.id === id)?.defaultFolder ?? ''
}

/**
 * Where the note will be written, or why it cannot be.
 *
 * A name already taken is caught here rather than by `createNote` throwing and
 * the window turning it into a toast — the toast lasted four seconds and left
 * the window sitting there as if nothing had happened.
 */
function PathLine({ path, taken }: { path: string | null; taken: boolean }): JSX.Element | null {
  if (!path) return null
  return (
    <p className={cn('flex items-center gap-1.5 text-11', taken ? 'text-ic-red' : 'text-c-2')}>
      <Icon
        name={taken ? 'warning' : 'file'}
        size={11}
        className={cn('shrink-0', taken ? 'codicon-red' : 'codicon-muted')}
      />
      <span className="truncate font-mono">{path}</span>
      {taken ? <span className="shrink-0">— already exists</span> : null}
    </p>
  )
}

/**
 * The edge stays; only its colour on focus goes.
 *
 * Focus used to turn every edge in the window blue. It is the same objection
 * the message box drew: a saturated line around a whole field is far louder
 * than "the caret is in here" needs to be, and the caret already says it. The
 * edge simply firms up a step instead.
 */
/**
 * The assistant that writes the captured note, and how hard it thinks.
 *
 * Its own choice, kept in settings rather than taken from the engine: filing a
 * pasted link wants something quick, while the assistant that re-reads the
 * whole vault on a schedule is chosen for entirely different reasons. Unset
 * follows the engine, which is what every install before this had.
 *
 * The thinking track is pinned under the rows rather than scrolling with them —
 * the menu is a list of models plus one control, and the control is the thing
 * you always want in reach.
 */
function CaptureModel(): JSX.Element {
  const settings = useUiStore((s) => s.settings)
  const engine = settings?.engine
  const ai = settings?.ai
  const provider = ai?.captureProvider ?? engine?.provider ?? 'claude'
  const model = ai?.captureModel || engine?.model || ''
  const effort = ai?.captureEffort ?? 'medium'

  function patch(next: Partial<NonNullable<AppSettings['ai']>>): void {
    void api().settings.setApp({ ai: { ...(ai ?? {}), ...next } })
  }

  return (
    <ModelMenu
      provider={provider}
      model={model}
      // A button here, not the bare text the composer uses. In the composer it
      // sits inside the box it belongs to and the box is its edge; here it
      // stands on its own in a row of buttons, and the same metrics as the
      // other fields in this window are what put it on their line.
      triggerClassName="h-8 gap-1.5 rounded-r3 border border-bd-2 bg-bg-1 px-2.5 text-12.5 text-c-1 hover:bg-bg-3"
      onChoose={(c) => patch({ captureProvider: c.provider, captureModel: c.model })}
      footer={
        <div className="px-1.5 py-1.5">
          <div className="mb-2 flex items-center gap-1">
            <Icon name="dashboard" size={12} className="shrink-0 text-muted-foreground" />
            <span className="text-c-1">
              Thinking <span className="text-c-2">({effort})</span>
            </span>
          </div>
          <EffortSlider
            value={effort}
            levels={EFFORT_LEVELS}
            onChange={(next) => patch({ captureEffort: next as NonNullable<typeof effort> })}
          />
        </div>
      }
    />
  )
}

/**
 * The rungs, written out here.
 *
 * Nothing has asked this assistant what it offers — there is no conversation
 * open to ask through — so these are Mindex's own five, the ones its settings
 * have always used. An assistant that does not take one simply ignores it.
 */
const EFFORT_LEVELS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Very high' },
  { value: 'max', label: 'Max' }
]

const FIELD =
  'h-8 rounded-r3 border border-bd-2 bg-bg-1 px-2.5 text-12.5 text-c-1 outline-none transition-colors placeholder:text-c-2 focus:border-bd-3'

/** The same metrics on the type picker's trigger, so the two fields line up. */
const FIELD_TRIGGER =
  'h-8 w-full rounded-r3 border border-bd-2 bg-bg-1 px-2.5 text-12.5 text-c-1 hover:bg-bg-3'

/**
 * A tag, a link, or the address it came from.
 *
 * Removable when it is something the assistant chose — a tag it picked and a
 * link it wrote are both guesses, and were previously fixed. The source is not:
 * it is where the material came from, which is a fact rather than a choice.
 */
function Chip({
  icon,
  onRemove,
  children
}: {
  icon?: string
  onRemove?: () => void
  children: ReactNode
}): JSX.Element {
  return (
    <span className="group/chip flex items-center gap-1 rounded-r4 border border-bd-2 py-0.5 pl-1.5 pr-1.5 text-11 text-c-2">
      {icon ? <Icon name={icon} size={10} className="codicon-inherit" /> : null}
      {children}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove"
          className="-mr-0.5 ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-4 text-c-2 opacity-0 transition-opacity hover:text-c-1 group-hover/chip:opacity-100"
        >
          <Icon name="close" size={9} className="codicon-inherit" />
        </button>
      ) : null}
    </span>
  )
}

/**
 * The window's way out and way on.
 *
 * Right-aligned, and each button only as wide as its label. They used to take
 * the small-modal metrics, which carry `flex-1` so a confirmation's two answers
 * split its width evenly — reasonable when the window is a question, absurd
 * here, where it made "Cancel" an enormous box across a 640px form.
 */
function Actions({
  cancelLabel = 'Cancel',
  confirmLabel,
  confirmIcon,
  disabled,
  onCancel,
  onConfirm
}: {
  cancelLabel?: string
  confirmLabel: string
  confirmIcon?: string
  disabled?: boolean
  onCancel(): void
  onConfirm(): void
}): JSX.Element {
  return (
    <div className="flex items-center justify-end gap-2">
      <ActionButton tone="ghost" onClick={onCancel}>
        {cancelLabel}
      </ActionButton>
      <ActionButton tone="primary" icon={confirmIcon} disabled={disabled} onClick={onConfirm}>
        {confirmLabel}
      </ActionButton>
    </div>
  )
}
