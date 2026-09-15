import { useLayoutEffect, useRef, useState } from 'react'

/**
 * The measurement behind every segmented switcher in the app.
 *
 * A segmented control marks the chosen option with **one element that slides**,
 * not with a background painted onto whichever button is active: two separate
 * boxes cannot animate between each other, so that version swaps instantly and
 * the control stops reading as one thing.
 *
 * The sliding part is trivial; the measuring is the part that is easy to get
 * subtly wrong, and it was written out three times before this — in Settings,
 * in the context panel, and in the editor's own switch — with a comment in two
 * of them saying "same technique as" the third. This is that technique, once.
 *
 * How it looks stays with the caller. The three differ on purpose: Settings
 * marks the choice with an outline, the context panel with a fill. Only the
 * arithmetic is shared.
 */
export function useSlidingIndicator<T extends string>(
  active: T,
  /** Re-measures when the set of options changes, not only the choice. */
  count: number
): {
  /** Ref callback for each option's button, keyed by its value. */
  refFor(key: T): (el: HTMLButtonElement | null) => void
  /** Where the mark should be, or null before the first measurement. */
  indicator: { left: number; width: number } | null
} {
  const refs = useRef<Partial<Record<T, HTMLButtonElement | null>>>({})
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null)

  // `useLayoutEffect`, not `useEffect`: the measurement has to land before the
  // browser paints, or the mark shows at its previous size for one frame —
  // visible as a flick every time the choice changes. Width is measured as
  // well as offset because option labels are not the same length.
  useLayoutEffect(() => {
    const btn = refs.current[active]
    if (!btn) return
    setIndicator({ left: btn.offsetLeft, width: btn.offsetWidth })
  }, [active, count])

  return {
    refFor: (key) => (el) => {
      refs.current[key] = el
    },
    indicator
  }
}
