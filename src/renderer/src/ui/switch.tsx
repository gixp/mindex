import * as React from 'react'
import { cn } from '@/ui/cn'

interface SwitchProps {
  checked: boolean
  onCheckedChange(next: boolean): void
  disabled?: boolean
  ariaLabel?: string
  className?: string
}

export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, onCheckedChange, disabled, ariaLabel, className }, ref) => (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => {
        if (!disabled) onCheckedChange(!checked)
      }}
      className={cn(
        'relative inline-flex h-4 w-7 shrink-0 items-center rounded-full border transition-colors',
        // The border is on both states, transparent when on. Adding it only
        // when off would change the box the knob is positioned inside, and
        // the knob would jump a pixel every time the switch is flipped.
        //
        // Off needs an edge of its own: the track is the recessed level, and
        // against a panel that is only one step above it the switch could read
        // as absent rather than as off. The edge is the second rung, whose
        // value is the third fill's — the quietest one is set to the panel's
        // own value, so an off switch drawn with it had no visible edge at all
        // on the surface it usually sits on.
        checked ? 'border-transparent bg-accent-1/80' : 'border-bd-2 bg-bg-1',
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
        className
      )}
    >
      <span
        className={cn(
          // Literally white in both themes, and correct: this is a knob, not
          // a surface. Its shadow is what separates it from a pale track —
          // which is why the track is the recessed level rather than the
          // raised one, where in the light theme it would be white too.
          'inline-block h-3 w-3 rounded-full bg-white shadow transition-transform',
          // The knob sits the same distance from all four edges, and these two
          // numbers are what make that true. The track is 28x16 with a 1px
          // border, so its inside is 26x14; a 12px knob therefore has 1px of
          // air above and below it, and needs 1px at each end to match. It
          // used to travel 2..12, leaving 2px at each end — one pixel more
          // than at the top and bottom, so the circle read as sitting short
          // of the ends rather than centred in the track.
          checked ? 'translate-x-[13px]' : 'translate-x-[1px]'
        )}
      />
    </button>
  )
)
Switch.displayName = 'Switch'
