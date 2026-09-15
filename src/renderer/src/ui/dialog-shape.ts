/**
 * The geometry every window in the app is drawn with.
 *
 * Its own module, not part of the dialog component, for one reason: the crash
 * screen has to be drawn with the same shape and must not import the dialog
 * component to get it. That component pulls in the dialog library, and the
 * crash screen's whole job is to still render when something underneath it
 * broke — the fewer things it depends on, the more often it works.
 */

/** The inset, the same on all four sides. */
export const DIALOG_PAD = 'p-5'

/**
 * The space between one block of a window's content and the next.
 *
 * The body is one column with this gap between its children, so a window's
 * own sections carry no margins and no padding — a toolbar, a list and a
 * footer are simply three children. Before this every window spaced its own
 * parts, which is the same divergence the inset had: four windows, four
 * answers, and any change meant finding all of them.
 */
export const DIALOG_GAP = 'gap-4'
