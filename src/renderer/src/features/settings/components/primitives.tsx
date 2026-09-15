import { useState, type ReactNode } from 'react'
import { Icon } from '@/ui/icon'
import { ChromeButton } from '@/ui/chrome-button'
import { ConfirmDialog } from '@/ui/ConfirmDialog'
import { cn } from '@/ui/cn'
import { PICKER_SELECTED_MARK, pickerOption } from '@/ui/picker-option'
import { useSlidingIndicator } from '@/ui/sliding-indicator'

/**
 * Makes a button ask first.
 *
 * Carried as a prop rather than left to each caller so that a destructive
 * action cannot ship without the question by accident — the button either has
 * a `confirm` or visibly does not.
 */
export interface ConfirmSpec {
  title: string
  message: ReactNode
  confirmLabel?: string
}

// Shared building blocks for the redesigned, Notion-style Settings. Section titles
// use `font-heading` (Regola Pro) to match the marketing site; cards use the
// landing's larger radii (rounded-[16px]) and subtle surfaces.

/** Right-pane section wrapper: a Regola Pro title, then the cards. No subtitle —
 *  the controls carry their own labels, and the prose only added scroll. */
export function SectionShell({
  title,
  description,
  icon,
  children
}: {
  title: string
  /** One line under the title saying what this screen is for. */
  description?: string
  /** Matches the section's icon in the sidebar, so the two agree. */
  icon?: string
  children: ReactNode
}): JSX.Element {
  return (
    <div className="mx-auto w-full max-w-[680px] px-10 pb-12 pt-9">
      <header className="mb-7">
        <div className="flex items-center gap-2.5">
          {/* One fixed mark per section, the AI one included. It used to track
              whichever provider was active, which made the header of a screen
              change identity depending on a setting further down it. */}
          {icon ? <Icon name={icon} size={20} className="shrink-0" /> : null}
          <h1 className="font-heading text-[21px] font-bold tracking-tight text-c-1">{title}</h1>
        </div>
        {description ? (
          <p className="mt-1.5 max-w-[52ch] text-12 leading-relaxed text-c-2">{description}</p>
        ) : null}
      </header>
      {/* The vertical rhythm, in one place, because it only works as a set
          and nothing else marks a boundary now that the rules are gone:
          adjacent rows 18px apart, a change of subject inside a group 30, one
          group to the next 48. Each step is close to double the one below it,
          which is what lets a gap alone say which kind of boundary it is —
          two sizes a few pixels apart read as the same size and say nothing. */}
      <div className="space-y-9">{children}</div>
    </div>
  )
}

/**
 * A titled group of settings, drawn as a list rather than as a form.
 *
 * It was a form: a fixed-width label column on the left and, on the right,
 * controls of every shape — pill toggles that wrapped into ragged blocks, a
 * segmented control, a stepper — each as wide as it happened to be. Nothing
 * shared a right edge, so there was no line for the eye to follow down the
 * screen, and every explanation was a tooltip nobody hovers.
 *
 * Now every setting is a row with the same two edges: what it is on the left,
 * the control flush right, and a hairline between rows. That single change is
 * most of what makes this read as a settings screen instead of a dialog full
 * of fields — and it gives the explanations somewhere visible to live, which
 * is the part that actually helps a person.
 *
 * Still draws no container, which was decided earlier and holds: the rows'
 * own hairlines give the structure a box used to give, without a box drawn on
 * a page.
 */
export function Card({
  title,
  description,
  action,
  plain = false,
  children
}: {
  title?: string
  /**
   * One line under the title.
   *
   * Down to one caller: Diagnostics, whose line under the title is a changing
   * statement of fact about this build rather than a description of the group.
   * No settings screen uses it any more — what a setting does belongs on the
   * setting, where someone reading that row will see it, not in a paragraph
   * above four of them that answers for none in particular.
   */
  description?: string
  action?: ReactNode
  /**
   * Children that are not rows.
   *
   * The divider below assumes every child is a row and puts a rule between
   * each pair. A card whose body is a paragraph and a switch, or a grid of
   * provider cards, is not that — it got a rule through the middle of one
   * thought and no padding anywhere, which is what the divider is for when it
   * is right and disastrous when it is not. Those cards say so and get plain
   * spacing instead.
   */
  plain?: boolean
  children: ReactNode
}): JSX.Element {
  return (
    <section>
      {title || action ? (
        <div className="flex items-center gap-3">
          {title ? <h3 className="text-13 font-semibold text-c-1">{title}</h3> : null}
          {action ? <div className="ml-auto shrink-0">{action}</div> : null}
        </div>
      ) : null}
      {description ? (
        <p className="mt-1 max-w-[52ch] text-11.5 leading-relaxed text-c-2">{description}</p>
      ) : null}
      {/* One rule per group, under its title, with air on both sides.
       *
       * The only rule left on these screens, and the only one that was ever
       * doing something a gap could not: it says where a group starts. The
       * rules that were between every row said that about every boundary at
       * once, which is the same as saying it about none of them.
       */}
      {title ? (
        // `py-1` on a wrapper rather than margins on the line itself: a
        // background fills its padding, so putting the spacing on the ruled
        // element would have drawn a 9px bar instead of a 1px rule.
        //
        // One rung lighter than it was. `bd-1` is deliberately the same value
        // as `bg-2`, which was the level *below* these screens until the
        // dialogs moved up — at which point the only rule on the page was
        // being drawn in the colour of the page.
        <div className="py-1">
          <div className="h-px bg-bd-2" />
        </div>
      ) : null}
      <div className={plain ? 'space-y-3' : undefined}>{children}</div>
    </section>
  )
}

/**
 * One setting: what it is, what it does, and the control that changes it.
 *
 * The explanation is the part worth insisting on. Every one of these already
 * had a sentence written for it, and every one of those sentences was a
 * `title` attribute — visible only to someone who hovers the exact element and
 * waits, which is nobody. Written out, it is the difference between a screen
 * of labelled switches and a screen you can actually read.
 *
 * `control` sits at the right edge, always, whatever shape it is. That edge is
 * what the eye follows.
 */
export function Row({
  label,
  hint,
  control,
  disabled = false
}: {
  label: string
  /** One line. Say what turning it on does, not what it is called. */
  hint?: string
  control: ReactNode
  /** Dims the words, not the control — the control dims itself if it can. */
  disabled?: boolean
}): JSX.Element {
  return (
    // The same padding on every row, and the same above as below. A row that
    // opened a wider gap above itself to mark a change of subject used to live
    // here; every row is spaced alike now, which is a plainer rhythm and one
    // that cannot drift out of step with itself.
    <div className="flex items-center justify-between gap-6 py-2">
      <div className={cn('min-w-0', disabled && 'opacity-50')}>
        <div className="text-12.5 text-c-1">{label}</div>
        {hint ? <p className="mt-0.5 text-11 leading-snug text-c-2">{hint}</p> : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  )
}

/**
 * A setting whose control is too wide to sit beside its own name.
 *
 * The view picker is two preview cards; the vault list is a list. Forcing
 * those into a row would squeeze them against the right edge to no purpose.
 * They get the name above and the control below, in the same list, so the
 * hairlines still line up.
 */
export function BlockRow({
  label,
  hint,
  children
}: {
  label?: string
  hint?: string
  children: ReactNode
}): JSX.Element {
  return (
    <div className="py-2">
      {label ? <div className="text-12.5 text-c-1">{label}</div> : null}
      {hint ? <p className="mt-0.5 text-11 leading-snug text-c-2">{hint}</p> : null}
      <div className={label || hint ? 'mt-2.5' : undefined}>{children}</div>
    </div>
  )
}

/**
 * Bare icon in a card header — no label, no padding, no fill.
 *
 * Header actions are secondary by definition: the card's own controls are the
 * point, and a bordered button with a word in it competed with them. The label
 * survives as the tooltip and the accessible name, so nothing is lost to
 * anyone reading by keyboard or screen reader.
 */
export function IconButton({
  icon,
  label,
  onClick,
  busy = false,
  confirm
}: {
  icon: string
  /** Tooltip and accessible name; this button shows no text. */
  label: string
  onClick(): void
  /** Spins the icon and holds it lit while an action is in flight. */
  busy?: boolean
  /** Ask before running. Omit for actions that are harmless to repeat. */
  confirm?: ConfirmSpec
}): JSX.Element {
  const [asking, setAsking] = useState(false)
  return (
    <>
      <ChromeButton
        icon={icon}
        iconSize={12}
        iconClassName={busy ? 'codicon-white animate-spin' : undefined}
        onClick={() => (confirm ? setAsking(true) : onClick())}
        title={label}
        aria-label={label}
      />
      {confirm ? (
        <ConfirmDialog
          open={asking}
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel ?? 'Reset'}
          confirmIcon="debug-restart"
          onConfirm={() => {
            setAsking(false)
            onClick()
          }}
          onCancel={() => setAsking(false)}
        />
      ) : null}
    </>
  )
}

/** Inline field: fixed-width label on the left, control on the right. */
export function Field({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <span className="w-32 shrink-0 text-[11px] text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

/** A bordered secondary button (used for actions inside cards). */
export function ActionButton({
  icon,
  children,
  onClick,
  disabled,
  tone = 'default',
  confirm
}: {
  icon?: string
  children: ReactNode
  onClick(): void
  disabled?: boolean
  tone?: 'default' | 'danger'
  /** Ask before running. Omit for actions that are harmless to repeat. */
  confirm?: ConfirmSpec
}): JSX.Element {
  const [asking, setAsking] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => (confirm ? setAsking(true) : onClick())}
        disabled={disabled}
        className={cn(
          'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[10px] border px-3 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-50',
          // Border, label and icon share one hue per tone. The danger variant
          // already did; the default one drew a grey icon beside white text
          // because the base `.codicon` rule pins that grey with `!important`
          // and no helper was overriding it.
          tone === 'danger'
            ? 'border-red-400/45 text-red-400 hover:bg-red-500/10 hover:text-red-300'
            : 'border-bd-2 text-foreground hover:bg-bg-3'
        )}
      >
        {icon ? (
          <Icon
            name={icon}
            size={13}
            className={tone === 'danger' ? 'codicon-red' : 'codicon-white'}
          />
        ) : null}
        {children}
      </button>
      {confirm ? (
        <ConfirmDialog
          open={asking}
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel ?? 'Reset'}
          confirmIcon="debug-restart"
          destructive={tone === 'danger'}
          onConfirm={() => {
            setAsking(false)
            onClick()
          }}
          onCancel={() => setAsking(false)}
        />
      ) : null}
    </>
  )
}

/**
 * Pressable on/off chip — the icon-led replacement for a row of Switches.
 * Deliberately the same height and type scale as one `Segmented` button, so a
 * card of chips and a card of pickers read as one control language rather than
 * two. The pressed state is blue fill + blue border + blue glyph; icon colour
 * goes through the `codicon-*` helpers, since the global `.codicon` rule
 * outranks `text-*`.
 */
export function ToggleTile({
  icon,
  label,
  hint,
  checked,
  onChange
}: {
  icon: string
  label: string
  hint?: string
  checked: boolean
  onChange(next: boolean): void
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={hint}
      onClick={() => onChange(!checked)}
      className={cn(
        'inline-flex items-center gap-[5.5px] rounded-[10px] border px-2.5 py-1 text-[12px] font-medium transition-colors',
        pickerOption(checked),
        checked ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
      )}
    >
      <Icon name={icon} size={13} className={checked ? 'codicon-blue' : 'codicon-inherit'} />
      {label}
    </button>
  )
}

/** Icon-led segmented picker — replaces a Select for small, fixed option sets. */
export function Segmented<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: Array<{ value: T; icon: string; label: string }>
  onChange(next: T): void
}): JSX.Element {
  // The measuring lives in `ui/sliding-indicator`: it was written out here, in
  // the context panel and in the editor's own switch, with two of the three
  // carrying a comment saying "same technique as" the other.
  const { refFor, indicator } = useSlidingIndicator(value, options.length)

  return (
    <div className="relative inline-flex items-center gap-1 rounded-[12px] border border-bd-2 p-[2px]">
      {indicator ? (
        <div
          aria-hidden="true"
          className={cn(
            'absolute bottom-[2px] left-0 top-[2px] rounded-[9px] transition-[transform,width] duration-200 ease-out',
            PICKER_SELECTED_MARK
          )}
          style={{ transform: `translateX(${indicator.left}px)`, width: indicator.width }}
        />
      ) : null}
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            ref={refFor(o.value)}
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            // `relative z-pane` keeps the label above the sliding fill; without
            // it the indicator paints over the text it is meant to sit behind.
            className={cn(
              'relative z-pane inline-flex items-center gap-[5.5px] rounded-[9px] px-2.5 py-1 text-[12px] font-medium transition-colors',
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {/* `codicon-inherit` is what makes the mark follow the word beside
                it. Without it the base rule pins every icon grey with
                `!important`, so hovering lightened the label and left the icon
                behind — the two halves of one button disagreeing. */}
            <Icon name={o.icon} size={13} className={active ? 'codicon-blue' : 'codicon-inherit'} />
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** Sidebar group label (uppercase, faint). */
export function GroupLabel({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="px-2.5 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
      {children}
    </div>
  )
}

/** Sidebar navigation item. */
export function NavItem({
  icon,
  label,
  active,
  onClick
}: {
  icon: string
  label: string
  active: boolean
  onClick(): void
}): JSX.Element {
  // The standard grey, not the label's colour.
  //
  // It used to match the text exactly, which made the icon read as part of the
  // word rather than as a mark beside it — a column of full-strength glyphs
  // down the side of the screen, competing with the one that is actually
  // current. Which item is current is still said by the fill behind it.
  const iconColor = undefined
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex w-full items-center gap-1.5 rounded-[10px] px-2.5 py-[7px] text-[13px] transition-colors',
        'text-c-1',
        // The two themes need different classes here, which is the one case
        // the light variant exists for.
        //
        // The rail these sit in moved up a rung, leaving the current row too
        // close to its own background. On the dark theme the answer is the
        // token for a control resting on an already-raised surface — one step
        // further out, and lighter.
        //
        // On the light theme that same token is a ten-point drop onto a
        // near-white rail, which reads as a black bar rather than a selection.
        // Near white the eye compresses lightness, so a few points is a clear
        // step there where it would be invisible on the dark side.
        active ? 'bg-accent-hover light:bg-bg-1' : 'hover:bg-accent/40'
      )}
    >
      {/* Left alone, so the base rule's grey applies. */}
      <Icon name={icon} size={15} className={iconColor} />
      <span className="truncate">{label}</span>
    </button>
  )
}

/**
 * Minus / value / plus, for a setting that is a number with a floor and a
 * ceiling.
 *
 * A free number input was the obvious alternative and is worse here: every
 * one of these is a size you judge by looking at it, so the useful gesture is
 * "a bit bigger" repeated until it looks right, not typing a figure. It also
 * cannot be put into an invalid state — the buttons stop at the ends rather
 * than accepting 400 and clamping it after the fact.
 */
export function Stepper({
  value,
  min,
  max,
  unit,
  label,
  onChange
}: {
  value: number
  min: number
  max: number
  /** Shown after the number. */
  unit?: string
  /** Accessible name — the visible label is the `Field` this sits in. */
  label: string
  onChange(next: number): void
}): JSX.Element {
  const step = (delta: number): void => onChange(Math.min(max, Math.max(min, value + delta)))
  return (
    <div className="inline-flex items-center gap-1" role="group" aria-label={label}>
      {/* Filled squares rather than two bare glyphs floating beside a number:
          a minus sign alone does not read as something to press, and these are
          the only controls on the screen you are meant to hit repeatedly.

          One step up from the panel, and the hover one above that. They were
          written as a fixed rung on the assumption that a dialog sits at the
          bottom of the ladder; the dialog moved up one, the fill met the
          surface behind it, and they went back to being two bare glyphs. Named
          against the panel now rather than against the page. */}
      <ChromeButton
        icon="remove"
        iconSize={12}
        tone="subtle"
        box={24}
        className="bg-bg-3 hover:bg-bg-4"
        disabled={value <= min}
        onClick={() => step(-1)}
        title={`Smaller — ${label}`}
        aria-label={`Smaller — ${label}`}
      />
      <span className="w-12 text-center text-11 tabular-nums text-foreground">
        {value}
        {unit ? <span className="text-muted-foreground">{unit}</span> : null}
      </span>
      <ChromeButton
        icon="add"
        iconSize={12}
        tone="subtle"
        box={24}
        className="bg-bg-3 hover:bg-bg-4"
        disabled={value >= max}
        onClick={() => step(1)}
        title={`Larger — ${label}`}
        aria-label={`Larger — ${label}`}
      />
    </div>
  )
}
