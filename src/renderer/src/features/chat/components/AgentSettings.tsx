import { useMemo } from 'react'
import { type AcpConfigOption, currentLabel, optionFor } from '@shared/acp'
import type { ProviderId } from '@shared/types'
import { Icon } from '@/ui/icon'
import { HandIcon } from '@/ui/hand-icon'
import { ProviderGlyph } from '@/ui/provider-glyph'
import { Select, type SelectGroup, type SelectOption } from '@/ui/select'
import { cn } from '@/ui/cn'
import { EffortSlider } from './EffortSlider'
import { Switch } from '@/ui/switch'
import { asToggle } from '@/features/chat/lib/toggle-option'
import { PICKER_SELECTED } from '@/ui/picker-option'
import { modeIconFor } from '@/features/chat/lib/mode-vocabulary'
import { usableProviders, useProvidersStore } from '@/platform/engines'
import { useAdvertisedOptions } from '@/features/chat/store-agentOptions'
import {
  clampWords,
  DEFAULT_REQUEST_SHAPE,
  LENGTH_LABELS,
  MAX_WORDS,
  MIN_WORDS,
  OUTPUT_LABELS,
  SCOPE_LABELS,
  stepWords,
  WORDS_STEP,
  type RequestLength,
  type RequestOutput,
  type RequestScope,
  type ComposerShape
} from '@/features/chat/lib/request-shape'
import {
  buildModelGroups,
  currentChoiceValue,
  modelLabel,
  unpackChoice,
  type ModelChoice,
  type ModelGroup
} from '@/features/chat/lib/model-choice'

/**
 * The composer controls, filled from what the assistant says about itself.
 *
 * The layout is the one Mindex already had — model on the left, mode on the
 * right, the effort track folded into the model menu. What changed is where the
 * contents come from: Mindex used to carry a written-out list of four modes and
 * five effort steps, while the assistant here offers six and six, plus a choice
 * of persona that was never reachable at all.
 *
 * Only the assistant's own words are shown. Mindex's read better in places —
 * "Ask before edits" beats "Manual" — but they were only ever right for one
 * assistant: Codex calls the same three things "Ask for approval", "Approve for
 * me" and "Full access", and no fixed wording covers both.
 *
 * One thing about the menu component decides most of the code below: the button
 * it renders shows the *selected option's* label, and falls back to a
 * placeholder only when nothing is selected at all. So anything that has to
 * appear on the button — an icon, the warning dot, the "Agent — Default" pair —
 * belongs on every option's `triggerLabel`, never on the placeholder.
 */

/**
 * Icons for the modes Mindex already had icons for.
 *
 * Keyed by the assistant's own machine name. Claude's first four happen to
 * match Mindex's exactly, which is why the original icons still fit; anything
 * else — Codex's, Gemini's, and the two Claude modes that were never shown —
 * gets a neutral one rather than a wrong one.
 */
const MODE_ICON: Record<string, string> = {
  default: 'hand',
  auto: 'rocket',
  acceptEdits: 'edit',
  plan: 'checklist',
  // Never previously reachable: both remove prompting rather than relax it.
  dontAsk: 'circle-slash',
  bypassPermissions: 'unlock'
}

/**
 * The one mode that gets a colour, and why only one.
 *
 * `dontAsk` stops the assistant asking by *refusing* anything not already
 * allowed — stricter than the ordinary mode rather than looser — and green
 * says so at a glance.
 *
 * Bypass used to be amber beside it. A warning colour on a mode a person
 * chose deliberately reads as an alarm about their own choice, and it was the
 * only alarm in a menu of six ordinary rows. It is named plainly instead; the
 * row says what it does.
 *
 * Every other mode stays uncoloured. A colour on all six would make the list
 * noisy and say nothing, which is the state this menu was in.
 */
const MODE_TONE: Record<string, string> = {
  dontAsk: 'codicon-emerald'
}

/**
 * The icon for a mode.
 *
 * The mode's colour used to be said once, on the send button. The send button
 * now carries the *assistant* — which of them a message will reach — so the
 * warning that was riding on it moves here, to the row where the mode is
 * actually chosen.
 */
function modeIcon(id: string, label?: string): React.ReactNode {
  // The table first, so the assistant Mindex grew up with is drawn exactly as
  // it was; then meaning, which is what the other two rely on.
  const name = MODE_ICON[id] ?? modeIconFor(id, label) ?? 'gear'
  return (
    <span className="flex shrink-0 items-center text-muted-foreground">
      {name === 'hand' ? (
        <HandIcon />
      ) : (
        <Icon name={name} size={13} className={cn('shrink-0', MODE_TONE[id] ?? 'codicon-muted')} />
      )}
    </span>
  )
}

/** Values to show, keeping a selected one the assistant has stopped offering. */
function withCurrent(option: AcpConfigOption): Array<{ value: string; label: string }> {
  const values = option.values.map((v) => ({ value: v.value, label: v.label }))
  const current = option.currentValue
  if (typeof current === 'string' && current && !values.some((v) => v.value === current)) {
    // Kept visible rather than letting the menu quietly read as something the
    // user never picked. Finding out your model changed under you should not
    // happen by noticing a different word.
    values.push({ value: current, label: current })
  }
  return values
}

/**
 * How hard it thinks, as a track.
 *
 * It used to sit at the foot of the model menu. It belongs with the mode: both
 * say how the assistant works on a message, while the model menu says which
 * assistant it is. Keeping them apart meant one of the two questions was
 * answered in a menu that was not asking it.
 *
 * Drawn only when there is a real choice — a single rung is not one.
 */
function ThinkingTrack({
  option,
  onChoose
}: {
  option: AcpConfigOption
  onChoose(value: string): void
}): JSX.Element | null {
  const levels = option.values.map((v) => ({ value: v.value, label: v.label }))
  if (levels.length < 2) return null
  const current = typeof option.currentValue === 'string' ? option.currentValue : ''
  const now = levels.find((v) => v.value === current)?.label ?? current

  return (
    <div className="px-1.5 py-1.5">
      {/* Same icon-to-text gap as the rows above, so the two line up down the
          left edge of the menu. */}
      <div className="mb-2 flex items-center gap-1">
        <Icon name="dashboard" size={12} className="shrink-0 text-muted-foreground" />
        <span className="text-foreground">
          {option.label} <span className="text-muted-foreground">({now})</span>
        </span>
      </div>
      <EffortSlider value={current} levels={levels} onChange={onChoose} />
    </div>
  )
}

/**
 * The model chooser: every usable assistant, each with its own models under it.
 *
 * It used to list one assistant's models — whichever one Settings had chosen,
 * because that setting decided who answered everywhere. Now a conversation
 * carries its own assistant, so the menu is the whole field: a heading per
 * assistant, its models beneath, and picking one is a single decision rather
 * than two that could disagree.
 *
 * Every row carries its assistant's mark, heading or no heading. Dropping it
 * because the heading above already names the assistant was a mistake: a row
 * is read on its own, the heading is three rows up by the time you reach the
 * bottom of a group, and the mark is also what the button inherits when the
 * row is chosen.
 *
 * Effort belongs here rather than under the modes because it is a property of
 * the model — how hard it thinks — while a mode is about what it is allowed to
 * do without asking. The assistant even says so: which effort steps exist
 * depends on which model is chosen.
 */
function ModelSelect({
  provider,
  groups,
  current,
  currentLabel,
  onChooseModel
}: {
  provider: ProviderId
  groups: ModelGroup[]
  current: string
  /** What to call the model in force when it is not one of the rows. */
  currentLabel: string
  onChooseModel(choice: ModelChoice): void
}): JSX.Element {
  const selectGroups: SelectGroup<string>[] = groups.map((g) => ({
    label: g.label,
    options: g.rows.map((row) => ({
      value: row.value,
      // No separate `triggerLabel`: this label carries the mark, and the button
      // shows whichever label belongs to the selected value. Overriding it with
      // plain text is what stripped the mark off the button before.
      label: (
        // Same gap as the mode rows below, so the two controls sitting side by
        // side in the composer space their mark and text identically.
        <span className="flex items-center gap-1">
          <ProviderGlyph id={g.provider} size={12} />
          <span>{row.label}</span>
        </span>
      )
    }))
  }))

  // Every row, flat, so the button can find the selected one whichever group
  // it lives in — the menu component searches this list, not the groups.
  const options: SelectOption<string>[] = selectGroups.flatMap((g) => g.options)

  return (
    <Select<string>
      value={current}
      onChange={(next) => {
        const choice = unpackChoice(next)
        if (choice) onChooseModel(choice)
      }}
      options={options}
      groups={selectGroups}
      title="Choose an assistant and model"
      size="sm"
      placement="top"
      align="center"
      // A floor, not a fixed width. The panel still grows to fit its widest
      // row, so a heading or a long model name is not paid for in advance.
      minDropdownWidth={160}
      // Every model on screen at once, like the mode menu. The list is short —
      // a handful per assistant — so the default scrolling cap was hiding rows
      // for no gain. The window is still the limit, and the placement above
      // keeps the panel inside it.
      dropdownClassName="max-h-[calc(100vh-16px)]"
      // Shown only when the model in force is not one of the rows. It names
      // that model rather than the word "Model": the button's whole job is to
      // say which one is answering, and a button that goes from a name to a
      // category is a button that has stopped reporting. The name comes from
      // `modelLabel`, which looks past the rows, so this matches what the menu
      // itself would have called it instead of printing a bare id.
      placeholder={
        <span className="flex items-center gap-1">
          <ProviderGlyph id={provider} size={12} />
          <span>{currentLabel}</span>
        </span>
      }
      // Same row metrics as the mode menu. The gap either side of the
      // separator is the wrapper's margin plus whatever the row above and the
      // content below contribute — so rows of different heights in the two
      // menus made the same separator look differently spaced in each.
      optionClassName="px-1.5 py-1.5"
      optionsGapClassName="space-y-0.5"
      triggerClassName="rounded-none border-0 pl-0 pr-0 bg-transparent hover:bg-transparent text-muted-foreground"
    />
  )
}

/**
 * The persona row, and the panel it opens.
 *
 * Last in the mode menu, under the toggles: the word "Agent" on the left, the
 * chosen persona on the right, and the menu's own chevron after it. That
 * pairing has to ride every option's `triggerLabel` — a placeholder would only
 * ever show while nothing was selected, which is never.
 *
 * Choosing one is answered in the composer rather than here: a chip above the
 * field, beside the attachments. Selecting a persona used to change nothing
 * anywhere — the menu closed and every pixel looked as it had a moment
 * earlier, so the only way to learn which one was in force was to reopen the
 * menu and read it.
 *
 * The panel is kept narrow deliberately. Its descriptions are the personas' own
 * instructions and run to paragraphs; left to size the panel they would make it
 * the widest thing on screen, so they are clamped to two lines instead.
 */
function AgentRow({
  option,
  onChoose
}: {
  option: AcpConfigOption
  onChoose(value: string): void
}): JSX.Element {
  const row = (valueLabel: string): React.ReactNode => (
    <span className="flex w-full items-center justify-between gap-3">
      <span className="text-foreground">{option.label}</span>
      <span className="truncate text-muted-foreground">{valueLabel}</span>
    </span>
  )

  const options: SelectOption<string>[] = option.values.map((v) => ({
    value: v.value,
    label: (
      // No padding of its own: the row already provides it, and adding more
      // here made the vertical spacing larger than the horizontal and larger
      // than the mode rows'.
      <span className="flex flex-col gap-0.5">
        <span className="leading-tight">{v.label}</span>
        {v.description ? (
          <span className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
            {v.description}
          </span>
        ) : null}
      </span>
    ),
    triggerLabel: row(v.label)
  }))

  // The menu's rows force a single line with an ellipsis by default, which
  // flattened these descriptions to one line no matter what the label markup
  // said. Undoing that here is what lets them run to the two lines they are
  // clamped at.
  // The same padding as the mode rows. Only `whitespace-normal` is added, to
  // undo the single-line clamp the menu applies by default — that is what kept
  // these descriptions to one line no matter what the row markup said.
  const rowClass = 'px-1.5 py-1.5 whitespace-normal'

  return (
    <Select<string>
      value={typeof option.currentValue === 'string' ? option.currentValue : ''}
      onChange={onChoose}
      options={options}
      title={option.label}
      headerLabel={option.label}
      // Opens beside the mode menu, not under this row, so the arrow points
      // that way.
      chevronIcon="chevron-right"
      size="sm"
      placement="side"
      // A fixed width, not a minimum. These rows wrap, so a minimum would let
      // the longest description decide how wide the panel is — and be
      // re-decided while scrolling, which is what made it grow and slide
      // sideways mid-scroll.
      dropdownClassName="w-[220px]"
      optionClassName={rowClass}
      optionsGapClassName="space-y-0.5"
      placeholder={row(currentLabel(option))}
      // Same rounding and padding as the mode rows above it, so the row reads
      // as one more entry in that menu rather than a panel of its own.
      triggerClassName="w-full rounded-[6px] border-0 bg-transparent px-1.5 py-1.5 hover:bg-bg-3"
    />
  )
}

/**
 * One of the three rows that are Mindex's own, not the assistant's.
 *
 * Drawn to match the persona row exactly — name on the left, current value on
 * the right, a panel opening beside it — because from the menu they are the
 * same kind of thing: a row that opens a short list.
 */
function ShapeRow<T extends string>({
  label,
  value,
  items,
  onChange,
  footer
}: {
  label: string
  value: T
  /**
   * Each value, the words for it, and the mark that stands for it.
   *
   * The mark is optional because one value has no honest picture: "auto" is
   * the absence of a choice about length, and every mark that might stand for
   * it would be inventing a meaning. Its place in the column is still kept, so
   * the words stay in one line down the panel.
   */
  items: Array<{
    value: T
    text: string
    icon?: string
    /**
     * The mark's colour, for the rows that name a file format.
     *
     * Taken from the file tree's own table rather than chosen here, so a Word
     * file asked for in this menu carries the same blue as the Word file that
     * lands in the tree afterwards. Everything else stays grey: colour here
     * means "this is a kind of file", and spending it on the four places
     * inside the app would say nothing.
     */
    iconClass?: string
    /**
     * Starts a second run of rows, with a rule above it.
     *
     * For the one list that holds two kinds of answer: places inside the app,
     * then file formats the assistant writes itself. The line is the whole
     * distinction, and without it the two run together as one list of eight.
     */
    separated?: boolean
  }>
  onChange(next: T): void
  footer?: React.ReactNode
}): JSX.Element {
  // The mark rides the row as well as the panel. It was left off the row on
  // the reasoning that a name and a value are already two things and a third
  // would compete — wrong: the mark is what the row is read by once the words
  // are familiar, and a value shown without it is the one place in the menu
  // where the same choice looks like two different things.
  const pair = (item: { text: string; icon?: string; iconClass?: string }): React.ReactNode => (
    <span className="flex w-full items-center justify-between gap-3">
      <span className="text-foreground">{label}</span>
      <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
        {item.icon ? (
          <Icon
            name={item.icon}
            size={12}
            className={cn('shrink-0', item.iconClass ?? 'codicon-muted')}
          />
        ) : null}
        <span className="truncate">{item.text}</span>
      </span>
    </span>
  )
  const current = items.find((o) => o.value === value)

  const rows = items.map((o) => ({
    value: o.value,
    label: (
      <span className="flex items-center gap-2 leading-none">
        {o.icon ? (
          <Icon
            name={o.icon}
            size={13}
            className={cn('shrink-0', o.iconClass ?? 'codicon-muted')}
          />
        ) : (
          // The space it would have taken, kept empty. Without it this one row
          // starts further left than the rest and the column frays.
          <span className="inline-block h-[13px] w-[13px] shrink-0" />
        )}
        <span className="leading-none">{o.text}</span>
      </span>
    ),
    triggerLabel: pair(o)
  }))
  const split = items.findIndex((o) => o.separated)

  return (
    <Select<T>
      value={value}
      onChange={onChange}
      options={rows}
      // Two unnamed runs rather than one: the menu draws a rule between groups
      // and a heading only for a group that has a name, which is exactly the
      // line wanted here and none of the words.
      {...(split > 0
        ? {
            groups: [
              { label: '', options: rows.slice(0, split) },
              { label: '', options: rows.slice(split) }
            ]
          }
        : {})}
      title={label}
      headerLabel={label}
      chevronIcon="chevron-right"
      size="sm"
      placement="side"
      dropdownClassName="w-[190px]"
      optionClassName="px-1.5 py-1.5"
      optionsGapClassName="space-y-0.5"
      placeholder={pair(current ?? { text: value })}
      footer={footer ?? null}
      footerClassName="pt-0.5"
      triggerClassName="w-full rounded-6 border-0 bg-transparent px-1.5 py-1.5 hover:bg-bg-3"
    />
  )
}

/**
 * A setting with exactly two values, as a pair of boxes rather than two rows.
 *
 * One assistant advertises how it collaborates this way — two values named
 * "Default" and "Plan" that are not on and off. As menu rows they became
 * "Collaboration mode: Default" and "Collaboration mode: Plan", one above the
 * other, each repeating the setting's name and neither showing the other as
 * the alternative it is. A pair side by side says in one glance what two rows
 * said twice and less clearly.
 *
 * Styled from the shared picker, so it is the same "this one is chosen" the
 * settings screen uses — with the quiet edge stepped up to `bd-2`, which is
 * what anything sitting on a panel needs.
 */
function SegmentedOption({
  option,
  onChoose
}: {
  option: AcpConfigOption
  onChoose(value: string): void
}): JSX.Element {
  const current = typeof option.currentValue === 'string' ? option.currentValue : ''
  return (
    <div className="px-1.5 py-1.5">
      <div className="mb-1.5 text-muted-foreground">{option.label}</div>
      <div className="flex gap-1">
        {option.values.map((v) => (
          <button
            key={v.value}
            type="button"
            onClick={() => onChoose(v.value)}
            title={v.description ?? v.label}
            className={cn(
              'flex-1 rounded-6 border px-2 py-1 text-12 transition-colors',
              v.value === current
                ? PICKER_SELECTED
                : 'border-bd-2 bg-transparent text-muted-foreground hover:bg-bg-3 hover:text-foreground'
            )}
          >
            {v.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** One press of the word count, up or down. */
function Stepper({ direction, onPress }: { direction: 1 | -1; onPress(): void }): JSX.Element {
  const up = direction === 1
  const label = up ? `Add ${WORDS_STEP} words` : `Take off ${WORDS_STEP} words`
  return (
    <button
      type="button"
      onClick={onPress}
      title={label}
      aria-label={label}
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-6 border border-input text-muted-foreground transition-colors hover:bg-bg-3 hover:text-foreground"
    >
      <Icon name={up ? 'add' : 'dash'} size={11} className="codicon-inherit" />
    </button>
  )
}

/**
 * The three of them, and the number field the last one can open.
 *
 * They sit above the persona row and below everything the assistant owns,
 * which is the boundary they mark: the rows above are its vocabulary, these
 * are the same three words whoever is answering.
 */
function RequestRows({
  shape,
  onChange
}: {
  shape: ComposerShape
  onChange(next: ComposerShape): void
}): JSX.Element {
  const scope = shape.scope ?? DEFAULT_REQUEST_SHAPE.scope
  const output = shape.output ?? DEFAULT_REQUEST_SHAPE.output
  const length = shape.length ?? DEFAULT_REQUEST_SHAPE.length

  return (
    <>
      <ShapeRow<RequestScope>
        label="Scope"
        value={scope}
        onChange={(next) => onChange({ ...shape, scope: next })}
        items={[
          { value: 'note', text: SCOPE_LABELS.note, icon: 'file' },
          { value: 'folder', text: SCOPE_LABELS.folder, icon: 'folder' },
          // The vault's own mark, the one the tree, the breadcrumb and the
          // switcher all give the workspace root. A second picture for the
          // same thing would be a second name for it.
          { value: 'vault', text: SCOPE_LABELS.vault, icon: 'folder-library' }
        ]}
      />
      <ShapeRow<RequestOutput>
        label="Output"
        value={output}
        onChange={(next) => onChange({ ...shape, output: next })}
        items={[
          { value: 'auto', text: OUTPUT_LABELS.auto, icon: 'session-in-progress' },
          { value: 'chat', text: OUTPUT_LABELS.chat, icon: 'comment' },
          { value: 'this-note', text: OUTPUT_LABELS['this-note'], icon: 'file' },
          { value: 'new-note', text: OUTPUT_LABELS['new-note'], icon: 'new-file' },
          // A file, written by the assistant with its own tools — Mindex
          // converts nothing. The marks are the ones the file tree already
          // gives these types, so a row here and a file in the tree look alike.
          {
            value: 'docx',
            text: OUTPUT_LABELS.docx,
            icon: 'file-text',
            iconClass: 'codicon-blue',
            separated: true
          },
          { value: 'xlsx', text: OUTPUT_LABELS.xlsx, icon: 'table', iconClass: 'codicon-emerald' },
          { value: 'pdf', text: OUTPUT_LABELS.pdf, icon: 'file-pdf', iconClass: 'codicon-red' },
          { value: 'md', text: OUTPUT_LABELS.md, icon: 'markdown', iconClass: 'codicon-blue' }
        ]}
      />
      <ShapeRow<RequestLength>
        // "Response", not "Length": the row is about the answer, and the
        // values under it already say how long. The stored name stays `length`
        // because that is still what it decides.
        label="Response"
        value={length}
        onChange={(next) => onChange({ ...shape, length: next })}
        items={[
          // Marks for a length are a stretch — there is no picture of "a
          // paragraph". These are read as sizes rather than as things: a stroke,
          // a few lines, a sheet.
          { value: 'auto', text: LENGTH_LABELS.auto, icon: 'session-in-progress' },
          { value: 'sentence', text: LENGTH_LABELS.sentence, icon: 'dash' },
          { value: 'paragraph', text: LENGTH_LABELS.paragraph, icon: 'list-flat' },
          { value: 'page', text: LENGTH_LABELS.page, icon: 'file-text' }
        ]}
        footer={
          // A number rather than one more named rung: past a page, the useful
          // answer is a figure, and naming rungs for every figure is how a
          // short list becomes a long one.
          //
          // Stepped as well as typed. Reaching for the keyboard to go from 200
          // to 250 is more than the change is worth, and the two presses are
          // also the only hint that the figure is meant to be nudged rather
          // than composed exactly.
          <div className="flex items-center gap-1.5 px-1.5 py-1.5">
            <Stepper
              direction={-1}
              onPress={() =>
                onChange({
                  ...shape,
                  length: 'words',
                  lengthWords: stepWords(shape.lengthWords, -1)
                })
              }
            />
            <input
              type="number"
              min={MIN_WORDS}
              max={MAX_WORDS}
              step={WORDS_STEP}
              value={shape.lengthWords ?? 200}
              onChange={(e) =>
                onChange({
                  ...shape,
                  length: 'words',
                  lengthWords: clampWords(Number(e.target.value))
                })
              }
              className="w-12 rounded-6 border border-input bg-transparent px-1 py-1 text-center text-12 text-foreground focus-visible:outline-none"
            />
            <Stepper
              direction={1}
              onPress={() =>
                onChange({
                  ...shape,
                  length: 'words',
                  lengthWords: stepWords(shape.lengthWords, 1)
                })
              }
            />
            <span className="ml-auto text-12 text-muted-foreground">Words</span>
          </div>
        }
      />
    </>
  )
}

/**
 * The mode menu, with the persona row beneath it.
 *
 * The button reads as the current mode — the setting worth knowing at a glance,
 * because it decides whether the assistant stops to ask before it acts. That
 * setting survives into the next conversation, which is why it is on the
 * button rather than buried in the menu.
 */
function ModeSelect({
  mode,
  effort,
  extras,
  shape,
  onChoose,
  onShape
}: {
  mode: AcpConfigOption | undefined
  effort: AcpConfigOption | undefined
  extras: AcpConfigOption[]
  shape: ComposerShape
  onChoose(optionId: string, value: string | boolean): void
  onShape(next: ComposerShape): void
}): JSX.Element | null {
  if (!mode && !effort && extras.length === 0) return null

  const modeRow = (id: string, label: string): React.ReactNode => (
    <span className="flex items-center gap-1 leading-none">
      {modeIcon(id, label)}
      <span className="leading-none">{label}</span>
    </span>
  )

  const options: SelectOption<string>[] = mode
    ? withCurrent(mode).map((v) => ({
        value: v.value,
        label: modeRow(v.value, v.label)
      }))
    : []

  // Anything the assistant offers that has no place of its own — Codex's
  // collaboration mode and fast mode today. Listed under the modes so a new
  // setting shows up rather than being silently dropped.
  //
  // An on/off setting is drawn as a switch rather than as two rows to pick
  // between. Two rows is how a *choice among values* is offered, and reading
  // "Fast mode: On" and "Fast mode: Off" as siblings makes an on/off look like
  // one — you have to find the tick to know which way it currently is. A
  // switch shows its state without being read.
  // Recognised by shape as well as by declared type — an assistant that has an
  // on/off mostly does not say so in the type. See `asToggle`.
  const toggles = new Map(
    extras.map((e) => [e.id, asToggle(e)] as const).filter(([, t]) => t !== null)
  )
  // Two values that are not on and off: shown as a pair below rather than as
  // rows here. A row per value repeats the setting's name once per value and
  // shows neither as the alternative to the other.
  const pairs = extras.filter(
    (e) => !toggles.has(e.id) && e.type === 'select' && e.values.length === 2
  )
  const pairIds = new Set(pairs.map((e) => e.id))

  // Everything else this assistant advertises. One row each, opening a panel —
  // not one row per value, which is what made the menu's height and shape
  // depend on whoever was connected: a setting with six values added six rows
  // all reading "<setting>: <value>", and the same menu was a different object
  // for each assistant.
  const rest = extras.filter((e) => !toggles.has(e.id) && !pairIds.has(e.id))

  for (const toggle of toggles.values()) {
    if (!toggle) continue
    options.push({
      value: `toggle:${toggle.id}`,
      // The menu stays open: flipping a setting is not answering the question
      // the menu was asking, and closing on it makes turning two of them on a
      // matter of opening the same menu twice.
      keepOpen: true,
      label: (
        <span className="flex w-full items-center justify-between gap-3 leading-none">
          <span className="leading-none">{toggle.label}</span>
          {/* Shows the state and takes the press through the row it sits in —
              a switch of its own inside a menu row would be a button inside a
              button, which is invalid and gets announced twice. */}
          <Switch
            checked={toggle.on}
            onCheckedChange={() => undefined}
            ariaLabel={toggle.label}
            className="pointer-events-none"
          />
        </span>
      )
    })
  }

  return (
    <Select<string>
      value={typeof mode?.currentValue === 'string' ? mode.currentValue : ''}
      onChange={(next) => {
        // A switch row carries no value of its own — pressing it means "the
        // other way", and what the other way *is* was worked out when the row
        // was built. Sending back the text on the row would set a declared
        // boolean to the string "true", which is neither on nor off.
        if (next.startsWith('toggle:')) {
          const toggle = toggles.get(next.slice('toggle:'.length))
          if (toggle) onChoose(toggle.id, toggle.next)
          return
        }
        const sep = next.indexOf(' ')
        if (sep === -1) {
          if (mode) onChoose(mode.id, next)
          return
        }
        onChoose(next.slice(0, sep), next.slice(sep + 1))
      }}
      options={options}
      title="Mode"
      headerLabel="Mode"
      size="sm"
      placement="top"
      align="center"
      // A width, not a floor. Its contents are a fixed set of rows, not a
      // list, so letting the longest of them decide meant one wordy label
      // widened the whole menu — and the rows below truncate perfectly well.
      // Tall enough for all of it: unlike a list of models, there is nothing
      // here that scrolling would reveal, so scrolling only hides.
      dropdownClassName="w-[200px] max-h-[calc(100vh-16px)]"
      optionClassName="px-1.5 py-1.5"
      optionsGapClassName="space-y-0.5"
      // The label keeps the ordinary text colour whatever mode is in force —
      // only its icon carries the colour, and that already rides the row markup
      // above, which the button reuses for the selected value.
      triggerClassName="rounded-none border-0 pl-0 pr-0 bg-transparent hover:bg-transparent text-muted-foreground"
      // Last in the menu, under the toggles — the same couple of pixels that
      // separate the rows above it.
      footerClassName="pt-0.5"
      footer={
        <>
          {effort ? (
            <ThinkingTrack option={effort} onChoose={(v) => onChoose(effort.id, v)} />
          ) : null}
          {/* Mindex's own three, between what the assistant owns and the
              persona. A rule above them, because the rows above are the
              assistant's vocabulary and these three are the same words whoever
              is answering — but only when there is something above them to be
              separated from. The menu already draws one line where the footer
              begins, so an assistant that offers no thinking track got that
              line and this one stacked in the same place. */}
          {pairs.map((pair) => (
            <SegmentedOption key={pair.id} option={pair} onChoose={(v) => onChoose(pair.id, v)} />
          ))}
          {/* Everything else the assistant advertises: one row each, opening a
              panel of its own. */}
          {rest.map((extra) => (
            <AgentRow key={extra.id} option={extra} onChoose={(v) => onChoose(extra.id, v)} />
          ))}
          {effort || pairs.length > 0 || rest.length > 0 ? (
            <div className="mx-2 my-1 h-px bg-bd-2" />
          ) : null}
          <RequestRows shape={shape} onChange={onShape} />
          {/* No persona row here any more.

              It had a place of its own at the bottom, behind a rule, and
              nothing ever filled it: the adapter builds mode, model, effort
              and fast mode, and treats subagents as something it reports
              having run rather than something to choose in advance — checked
              against the built adapter and a live session. If one is ever
              advertised it will arrive as an ordinary row above, with the rest
              of what the assistant offers. */}
        </>
      }
    />
  )
}

export function AgentSettings({
  provider,
  options,
  model: chosenModel,
  shape,
  onChoose,
  onChooseModel,
  onShape
}: {
  provider: ProviderId
  options: AcpConfigOption[]
  /** The model this conversation is on, which is the tab's to remember. */
  model: string
  /** The three rows that are Mindex's own, and how to change them. */
  shape: ComposerShape
  onChoose(optionId: string, value: string | boolean): void
  onChooseModel(choice: ModelChoice): void
  onShape(next: ComposerShape): void
}): JSX.Element | null {
  const items = useProvidersStore((s) => s.items)
  // What every assistant says about itself, so the menu names the ones this
  // tab is not talking to the way they name themselves rather than the way
  // Mindex's compiled list does.
  const advertised = useAdvertisedOptions()
  const model = optionFor(options, 'model')
  const mode = optionFor(options, 'mode')
  const effort = optionFor(options, 'thought_level')

  /**
   * The menu's contents: every assistant that is installed and signed in.
   *
   * Only the assistant this tab is talking to has answered for itself, so only
   * its models are the live list; the rest come from the list compiled into
   * Mindex until you switch to one, at which point it answers and refines. The
   * compiled list is a copy of someone else's catalogue and does go stale —
   * the cost is a name that may be a version behind on an assistant you are
   * not using yet, which is cheaper than a menu that cannot show it at all.
   */
  // This tab's own assistant is the one case where a live conversation knows
  // better than the list learned at launch, so it goes on top.
  const live = useMemo(
    () => ({ ...advertised, [provider]: options }),
    [advertised, provider, options]
  )
  const groups = useMemo(() => buildModelGroups(usableProviders(items), live), [items, live])
  const placed = new Set([model, mode, effort].filter(Boolean).map((o) => o!.id))
  const extras = options.filter((o) => !placed.has(o.id))

  return (
    <>
      {groups.length > 0 ? (
        <ModelSelect
          provider={provider}
          groups={groups}
          // The tab's own model, not the option's `currentValue`: the menu now
          // spans every assistant, and only the one being talked to has a
          // current value to report. Reading it from the option would leave the
          // button blank for a tab whose assistant has not answered yet.
          current={currentChoiceValue(provider, chosenModel)}
          currentLabel={modelLabel(
            { provider, model: chosenModel },
            { groups, providers: items, live }
          )}
          onChooseModel={onChooseModel}
        />
      ) : null}
      <ModeSelect
        mode={mode}
        effort={effort}
        extras={extras}
        shape={shape}
        onChoose={onChoose}
        onShape={onShape}
      />
    </>
  )
}
