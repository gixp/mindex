import { forwardRef } from 'react'
import type { AriaAttributes, ReactNode } from 'react'
import { Icon } from './icon'
import { cn } from '@/ui/cn'

/**
 * The one flat, chrome-style icon(+label) button, used everywhere from the
 * titlebar down to a single "Reset to default" in the icon picker. Before
 * this it was four independent hand-written implementations
 * (`headerButtonStyles.ts`, `EditorPanel.tsx`'s `FOLDER_ACTION_BTN`,
 * `settings/primitives.tsx`'s `IconButton`, plus a handful of one-off
 * copies) that happened to converge on the same look. See the
 * architecture-cleanup plan's repeated-pattern-audit step for the full
 * inventory of what does and doesn't belong here — several similarly-shaped
 * buttons (tab strips, filter chips, form links, primary CTAs, the floating
 * quick-ask button) were deliberately kept out because their role differs
 * even where the classes looked close.
 *
 * Two independent axes, not one linear "size":
 * - `tone` — how it answers to being hovered/active. `flat` never gets a
 *   background of its own (the titlebar, folder actions, bare icon-only
 *   spots); `subtle` gains a soft rounded background on hover/while open
 *   (the workspace switcher, "reset to default"); `card` is its own
 *   visually heavier family — a bordered, backgrounded chip — for controls
 *   that have to read clearly over arbitrary content (a tool-call summary
 *   inline in a chat message, the Excalidraw fullscreen toggle floating
 *   over a drawing).
 * - `box` — the fixed square hit area for an icon-only button, in px (e.g.
 *   28 for the titlebar's own h-7 w-7). Leave unset for auto-width — a
 *   `label` present, or the boxless look used throughout Settings and for
 *   Attach in the composer.
 */
export type ChromeButtonTone = 'flat' | 'subtle' | 'card'

export interface ChromeButtonProps {
  icon: string
  label?: string
  /** Truncates `label` with an ellipsis instead of wrapping/overflowing —
   *  for a label whose length depends on user content (e.g. a vault name),
   *  paired with a `max-w-*` in `className`. */
  truncateLabel?: boolean
  iconSize?: number
  /** Override the icon's own class — e.g. a busy/spinning state that needs a
   *  fixed colour regardless of hover, like Settings' `IconButton`. */
  iconClassName?: string
  tone?: ChromeButtonTone
  box?: number
  /** Tinted "this is the thing currently open/on" state — a titlebar toggle
   *  for an open panel, a filter that's live. */
  active?: boolean
  disabled?: boolean
  title?: string
  onClick?: () => void
  className?: string
  /** Extra content after the icon/label — e.g. a trailing chevron, a status
   *  dot. Rendered whether or not `label` is set. */
  children?: ReactNode
  'aria-label'?: string
  'aria-haspopup'?: AriaAttributes['aria-haspopup']
  'aria-expanded'?: boolean
}

const TONE_BASE: Record<ChromeButtonTone, string> = {
  flat: 'rounded-none hover:bg-transparent',
  subtle: 'rounded-8 hover:bg-bg-3',
  card: 'rounded-md border border-border bg-card/60 hover:bg-bg-3'
}

export const ChromeButton = forwardRef<HTMLButtonElement, ChromeButtonProps>(function ChromeButton(
  {
    icon,
    label,
    truncateLabel,
    iconSize,
    iconClassName,
    tone = 'flat',
    box,
    active,
    disabled,
    title,
    onClick,
    className,
    children,
    ...aria
  },
  ref
): JSX.Element {
  // A label forces the h-7/px-2/text-xs treatment (the header/folder-action
  // shape) whether or not there's also a fixed `box` — box+label doesn't
  // happen in practice, but label alone (auto-width) is the common case.
  // With neither `box` nor `label`, the button is genuinely bare: sized by
  // nothing but its icon and padding, like the Settings IconButton / the
  // composer's Attach.
  return (
    <button
      ref={ref}
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      style={box != null ? { height: box, width: box } : undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-1.5 transition-colors',
        // The standard +5-lightness-point hover rule (plan/color-schema-migration.md)
        // applied to the button's own default resting color. The icon
        // below always carries `codicon-inherit` (unless a caller
        // explicitly overrides it via `iconClassName`), so it tracks this
        // exact color too — no separate forced-hover rule needed, and
        // nothing for the icon and the label text to disagree about.
        'text-muted-foreground hover:text-muted-foreground-hover',
        TONE_BASE[tone],
        label ? 'h-7 px-2 text-xs' : '',
        active ? 'text-foreground' : '',
        active && tone === 'subtle' ? 'bg-bg-3' : '',
        disabled
          ? 'cursor-not-allowed opacity-40 hover:bg-transparent hover:text-muted-foreground'
          : '',
        className
      )}
      {...aria}
    >
      <Icon
        name={icon}
        size={iconSize ?? (tone === 'card' ? 11 : 15)}
        className={iconClassName ?? 'codicon-inherit'}
      />
      {label ? (
        <span className={truncateLabel ? 'min-w-0 truncate' : undefined}>{label}</span>
      ) : null}
      {children}
    </button>
  )
})
