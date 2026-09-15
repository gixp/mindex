import type { ReactNode } from 'react'
import { Icon } from './icon'
import { cn } from './cn'

/**
 * The parts every floating menu is built from.
 *
 * There were two menus and they had written the same four things twice, with
 * different answers each time: rows at one radius here and another there,
 * group headings in one case and size here and another there, a hairline
 * separator in one and an empty gap in the other, and an icon with no fixed
 * width — so the labels beside a narrow mark and a wide one started at
 * different places down the same column.
 *
 * The shell stays with each menu: they are different widths and sit in
 * different corners, and that is the part worth keeping different.
 */

/** The small heading over a run of items. */
export function MenuGroup({
  label,
  children
}: {
  label?: string
  children: ReactNode
}): JSX.Element {
  return (
    <div>
      {label ? (
        <div className="px-2 pb-1 pt-1.5 text-10 font-medium uppercase tracking-wider text-c-2">
          {label}
        </div>
      ) : null}
      {children}
    </div>
  )
}

/** A hairline with air on both sides, for a change of subject inside a menu. */
export function MenuSeparator(): JSX.Element {
  return (
    <div className="py-1.5">
      <div className="h-px bg-bd-2" />
    </div>
  )
}

/**
 * One row.
 *
 * The mark sits in a fixed box, which is the whole reason labels line up: a
 * folder glyph and a game controller are not the same width, and without a box
 * every label starts wherever its own icon happened to end.
 *
 * Hover fills the row with the quiet border's own colour — the same rule every
 * button in the app follows, rather than the older tinted fill these used.
 */
export function MenuItem({
  icon,
  label,
  hint,
  trailing,
  selected = false,
  onClick,
  action
}: {
  icon?: string
  label: string
  /** A second line under the label — a path, a description. */
  hint?: string
  /** A shortcut, a count, a state — anything that belongs at the right edge. */
  trailing?: ReactNode
  selected?: boolean
  onClick?(): void
  /**
   * A control of its own at the right edge — a remove, a pin.
   *
   * A sibling of the row's button rather than inside it: a button within a
   * button is invalid markup and gets announced twice. The row is what
   * lights up, so the control lights up with it instead of being a hole in
   * the middle of the fill.
   */
  action?: ReactNode
}): JSX.Element {
  return (
    <div
      className={cn(
        'group/row relative flex items-center gap-2 rounded-8 transition-colors',
        // A step above the panel, not the quiet border's own colour. That
        // border is defined as *equal to* the second background level, which
        // is what these panels are made of — so filling a row with it painted
        // the panel onto itself and nothing moved under the pointer.
        selected ? 'bg-accent-1/[0.08]' : 'hover:bg-bg-3'
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
      >
        {icon ? (
          // A fixed box, which is the whole reason labels line up: a folder
          // glyph and a game controller are not the same width, and without
          // one every label starts wherever its own icon happened to end.
          <span className="flex h-4 w-4 shrink-0 items-center justify-center">
            <Icon name={icon} size={14} className={selected ? 'codicon-blue' : 'codicon-muted'} />
          </span>
        ) : null}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-12.5 text-c-1">{label}</span>
          {hint ? <span className="block truncate text-10.5 text-c-2">{hint}</span> : null}
        </span>
        {trailing ? <span className="shrink-0 text-10.5 text-c-2">{trailing}</span> : null}
      </button>
      {action ? <span className="shrink-0 pr-1.5">{action}</span> : null}
    </div>
  )
}
