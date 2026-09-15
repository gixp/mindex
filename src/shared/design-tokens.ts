/**
 * The literal-pixel fontSize/borderRadius token scales (`text-11`,
 * `rounded-8`, ...) — defined once here and consumed by both
 * `tailwind.config.ts` (so the utility classes actually exist) and
 * `renderer/src/lib/cn.ts` (so `tailwind-merge` knows these are font-size/
 * radius classes, not something else it has no name for).
 *
 * That second half matters: without it, `tailwind-merge` doesn't recognize
 * a bare-number `text-*`/`rounded-*` class as belonging to any group it
 * knows about, falls back to lumping it in with `text-color`, and silently
 * drops it whenever it's merged with a later `text-foreground`/
 * `text-muted-foreground` class in the same `cn()` call — the exact bug
 * that shipped in `ui/switcher.tsx`: `text-11` disappeared entirely,
 * leaving the browser/ancestor default font-size instead of 11px.
 */
export const PIXEL_FONT_SIZES = {
  '5': '5px',
  '5.5': '5.5px',
  '6.5': '6.5px',
  '9': '9px',
  '10': '10px',
  '10.5': '10.5px',
  '11': '11px',
  '11.5': '11.5px',
  '12': '12px',
  '12.5': '12.5px',
  '13': '13px',
  '14': '14px',
  '15': '15px',
  '16': '16px',
  '17': '17px',
  '18': '18px',
  '19': '19px',
  '21': '21px',
  '22': '22px',
  '26': '26px',
  '40': '40px'
} as const

export const PIXEL_RADII = {
  '2': '2px',
  '3': '3px',
  '4': '4px',
  '5': '5px',
  '6': '6px',
  '7': '7px',
  '8': '8px',
  '9': '9px',
  '10': '10px',
  '11': '11px',
  '12': '12px',
  '14': '14px',
  '15': '15px',
  '16': '16px',
  '20': '20px'
} as const

/**
 * What covers what, as a named ladder.
 *
 * There were fourteen distinct stacking values across the app, written in two
 * vocabularies that do not compare: the ordinary scale (10, 30, 40, 50) and
 * whatever number someone reached for (5, 60, 70, 150, 400, 999). Which of two
 * things ends up on top was decided by whoever picked the larger number, and
 * the way you found out was by seeing something underneath that should not
 * have been.
 *
 * This is the same defect the overlay registry already fixed once, in the same
 * app, for the same reason: an order that genuinely exists but is written down
 * nowhere. A name per rung makes a call site say what it *is* — a dialog, a
 * toast — instead of asserting a number against numbers it cannot see.
 *
 * Two rungs did move, on 2026-09-02, once the ladder made the order legible
 * enough to see they were wrong: an error dialog and a toast both sat below
 * the two full-screen states. So an error during startup was drawn behind the
 * startup screen — the app looked like it had hung on a progress line while
 * the sentence explaining why sat underneath it — and nothing the app had to
 * say during first-run setup was ever seen at all. Everything else is exactly
 * what its call sites already had.
 *
 * Re-ordering this is a change you have to look at to approve, not something
 * to bundle into a rename. That is the point of it being one list.
 *
 * Gaps between rungs are deliberate: they leave room for something to slot in
 * later without renumbering everything above it.
 */
export const LAYERS = {
  /** A control drawn over content inside one pane — a canvas's own buttons. */
  content: '5',
  /** Sticky headers and anything floating within a pane's own bounds. */
  pane: '10',
  /** A tool floating over the workspace: find and replace, a link editor, a
   *  drop target. Above the panes, below anything anchored to the window. */
  workspace: '30',
  /** Anchored to a window corner and persistent: quick ask, the proposal
   *  dock, a suggestion list above an input. */
  docked: '40',
  /** Dialogs, menus, popovers, the command palette. */
  dialog: '50',
  /** A screen that stands in for the app rather than sitting over it —
   *  first-run setup. */
  gate: '150',
  /** The startup screen, which is up before anything else exists. */
  boot: '400',
  /**
   * An error, which has to be readable above whatever caused it — including
   * the screens above.
   *
   * This used to sit at 60, below both of them, which meant an error during
   * startup was drawn underneath the startup screen: the app appeared to hang
   * on a progress line while the sentence explaining why sat behind it.
   */
  alert: '500',
  /**
   * Transient messages. Above everything, including an error dialog.
   *
   * Above the error on purpose, not by accident of ordering: that dialog dims
   * the whole window at its own level, so a toast below it is behind the dim
   * and invisible. A toast is a corner strip and blocks nothing that matters.
   *
   * This used to sit below the two full-screen states as well, so nothing the
   * app had to say during first-run setup was ever seen.
   */
  toast: '600',
  /** Development-only tools, above the entire product by definition. */
  dev: '999'
} as const
