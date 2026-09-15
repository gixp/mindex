import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Icon } from '@/ui/icon'
import { cn } from '@/ui/cn'

/**
 * The button. One shape, four jobs, three sizes.
 *
 * There were two competing definitions and they agreed on nothing:
 * `dialog-chrome`'s `ACTION_*` classes used a 9px radius, no fixed height, a
 * 12.5px label and a blue fill; `ui/button.tsx` used a 6px radius, `h-8`, a
 * 14px label and a *near-white* fill with dark text. Both called their fill
 * "primary". Around them sat thirty-seven buttons written out by hand, between
 * them using four heights and nine radii.
 *
 * So the answer to "what does a button look like here" was, in practice, a
 * different answer every time somebody needed one.
 *
 * The values are the design system's own, not new ones: `--r-3` is the radius
 * this scale gives a pill of this size, `--accent-1` is the app's blue, and the
 * hover fill is `--bg-3`, which is what every other hover in the app is.
 *
 * ## Width
 *
 * A button is as wide as its label. It is **not** `flex-1` — that used to be
 * baked into the shared metrics, so every action row split its width evenly
 * between its buttons whatever the window was. In a confirmation that reads
 * fine; in a 640px form it made "Cancel" an enormous box. A row that wants the
 * split says so itself (`DialogActions`), rather than every button in the app
 * carrying it.
 */

type Tone = 'primary' | 'quiet' | 'ghost' | 'danger'
type Size = 'lg' | 'md' | 'sm'

/** Height, padding and label size per size. Nothing else varies. */
const SIZE: Record<Size, string> = {
  /** The first-run screen, where the button is the whole point of the page. */
  lg: 'h-10 gap-2 px-4 text-13',
  md: 'h-8 gap-1.5 px-3 text-12.5',
  sm: 'h-7 gap-1.5 px-2.5 text-11'
}

const TONE: Record<Tone, string> = {
  /**
   * The one thing this window is for.
   *
   * White is literal and correct in both themes: it sits on a saturated blue
   * that does not change, so a theme-aware colour would be wrong rather than
   * right. That is worth saying because it looks like the raw-colour mistake
   * this codebase removed everywhere else, and is its opposite — the mistake is
   * a fixed colour on a surface that moves, and this surface does not.
   */
  primary: 'bg-accent-1 text-white hover:bg-accent-1/90 [&_.codicon::before]:!text-white',
  /** The way out beside it: an edge, no fill, until it is pointed at. */
  quiet: 'border border-bd-2 bg-transparent text-c-1 hover:bg-bg-3',
  /** No edge either — for a control that sits inside something else. */
  ghost: 'bg-transparent text-c-2 hover:bg-bg-3 hover:text-c-1',
  /**
   * Destroying something, drawn as an outline rather than a filled red block.
   *
   * A wall of red reads as an alarm going off; this reads as the button that
   * does the dangerous thing, which is what it is.
   */
  danger: 'border border-ic-red/45 bg-transparent text-ic-red hover:bg-ic-red/10'
}

const BASE =
  'inline-flex shrink-0 items-center justify-center rounded-r3 font-medium transition-colors ' +
  'outline-none focus-visible:ring-2 focus-visible:ring-accent-1/50 ' +
  'disabled:pointer-events-none disabled:opacity-40'

export interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: Tone
  size?: Size
  /** Drawn before the label, at the size that matches it. */
  icon?: string
  children?: ReactNode
}

export const ActionButton = forwardRef<HTMLButtonElement, ActionButtonProps>(function ActionButton(
  { tone = 'quiet', size = 'md', icon, className, children, type, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      // Defaulted rather than left to the caller: a button inside a form
      // submits it otherwise, which is a bug nobody writes on purpose and
      // several of the hand-written ones had.
      type={type ?? 'button'}
      className={cn(BASE, SIZE[size], TONE[tone], className)}
      {...rest}
    >
      {icon ? (
        <Icon
          name={icon}
          size={size === 'lg' ? 16 : size === 'sm' ? 12 : 13}
          // Follows the label. Without it the base `.codicon` rule paints the
          // mark grey with `!important` and the button lights up around an icon
          // that does not — the most common invisible bug in this codebase.
          className="codicon-inherit"
        />
      ) : null}
      {children}
    </button>
  )
})
