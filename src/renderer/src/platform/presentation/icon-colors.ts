import { cssVarColor } from '@/platform/theme'

/**
 * The icon palette, as concrete colours.
 *
 * Everywhere else in the app an icon's colour is a class name — `codicon-blue`
 * from the extension table, or a `text-*` class the icon picker wrote — and a
 * stylesheet turns it into pixels. Canvas has no stylesheet, so the graph needs
 * the actual value.
 *
 * This is the single list; `IconPicker` renders its swatches from it too, so a
 * colour added here shows up in the picker and on the graph at once and the two
 * cannot drift apart.
 */

export interface IconColor {
  label: string
  /** The class stored on the file/folder. `null` is "no override". */
  cls: string | null
  /**
   * The CSS variable the hue lives in, for the eight palette colours — the
   * ones that have a different value in each theme. `null` for the entries
   * that are not a palette hue: the accent, the default grey, and literal
   * white.
   */
  token: string | null
  /** The dark theme's value, and what is used if the variable cannot be read. */
  swatch: string
}

/**
 * The base `.codicon` colour in `globals.css` — the grey an icon is with no
 * override, and the answer for any stored colour class nothing recognises.
 *
 * Deliberately one value in both themes: it is a mid grey, which reads on
 * either background, and an icon with no colour set should not appear to
 * change when the theme does.
 */
export const DEFAULT_ICON_COLOR = 'rgb(140,140,140)'

export const ICON_COLORS: readonly IconColor[] = [
  // Blue leads because it is what an icon is when nobody has chosen — see
  // `DEFAULT_FOLDER_ICON_COLOR`. Grey sits beside it as the way to say "no
  // particular colour" deliberately, which used to be a swatch meaning "clear
  // the override" and therefore looked identical to picking grey without
  // being it.
  //
  // There used to be an Accent swatch here too, at the front, holding the
  // app's own accent. It made three blues in a row — accent, the default
  // previewing that same accent, and this one — of which two were the same
  // colour and the third was a shade off, with nothing in the picker able to
  // explain the difference. The accent is one thing for the whole app; the
  // palette is eight hues an icon can be. Removed 2026-09-02.
  { label: 'Blue', cls: 'codicon-blue', token: '--ic-blue', swatch: 'rgb(96,165,250)' },
  { label: 'Grey', cls: 'codicon-grey', token: '--ic-grey', swatch: DEFAULT_ICON_COLOR },
  { label: 'White', cls: 'codicon-white', token: '--foreground', swatch: '#fff' },
  { label: 'Cyan', cls: 'codicon-cyan', token: '--ic-cyan', swatch: 'rgb(34,211,238)' },
  { label: 'Emerald', cls: 'codicon-emerald', token: '--ic-emerald', swatch: 'rgb(52,211,153)' },
  { label: 'Amber', cls: 'codicon-amber', token: '--ic-amber', swatch: 'rgb(252,211,77)' },
  { label: 'Orange', cls: 'codicon-orange', token: '--ic-orange', swatch: 'rgb(251,146,60)' },
  { label: 'Red', cls: 'codicon-red', token: '--ic-red', swatch: 'rgb(248,113,113)' },
  { label: 'Pink', cls: 'codicon-pink', token: '--ic-pink', swatch: 'rgb(244,114,182)' },
  { label: 'Purple', cls: 'codicon-purple', token: '--ic-purple', swatch: 'rgb(192,132,252)' }
]

/**
 * Colours that are no longer offered but may still be stored.
 *
 * Anyone who picked the old Accent swatch has `text-accent-1` written against
 * their folder. Dropping it from the list above must not turn their choice
 * grey — an override someone set on purpose outliving the button that set it
 * is the normal case, not an edge one.
 */
const RETIRED: Record<string, { token: string; swatch: string }> = {
  // Carries its own value as well as its variable, for the same reason the
  // live entries do: without a document to read the variable out of, falling
  // through to the generic grey would lose the very choice this exists to
  // preserve.
  'text-accent-1': { token: '--accent-1', swatch: '#3b82f6' }
}

/** Tailwind's 400 shades, for the `text-<name>-400` classes the picker writes. */
const TAILWIND_400: Record<string, string> = {
  slate: '#94a3b8',
  gray: '#9ca3af',
  zinc: '#a1a1aa',
  neutral: '#a3a3a3',
  stone: '#a8a29e',
  red: '#f87171',
  orange: '#fb923c',
  amber: '#fbbf24',
  yellow: '#facc15',
  lime: '#a3e635',
  green: '#4ade80',
  emerald: '#34d399',
  teal: '#2dd4bf',
  cyan: '#22d3ee',
  sky: '#38bdf8',
  blue: '#60a5fa',
  indigo: '#818cf8',
  violet: '#a78bfa',
  purple: '#c084fc',
  fuchsia: '#e879f9',
  pink: '#f472b6',
  rose: '#fb7185'
}

const BY_CLASS = new Map(ICON_COLORS.filter((c) => c.cls).map((c) => [c.cls as string, c] as const))

/**
 * A palette entry as something to paint with, in the theme currently applied.
 *
 * The eight hues are read out of their CSS variables so a colour a user picked
 * means the same thing in both themes — Tailwind's 400 shades in the dark, its
 * 600s in the light, which is what `--ic-*` holds. The rest are fixed by
 * definition and answer with their own value.
 */
export function iconSwatch(c: IconColor): string {
  return c.token ? cssVarColor(c.token, 1, c.swatch) : c.swatch
}

/**
 * A stored colour class as a canvas-usable colour.
 *
 * Handles both vocabularies, because both are real on disk: the extension
 * table stores `codicon-blue`, the icon picker's overrides store a Tailwind
 * `text-*` class, and a note type stores a bare palette word (`sky`). Anything
 * unrecognised falls through to the default grey — the same thing the tree
 * does when it cannot make sense of a colour.
 */
export function iconColorValue(cls: string | null | undefined): string {
  if (!cls) return DEFAULT_ICON_COLOR
  const known = BY_CLASS.get(cls)
  if (known) return iconSwatch(known)
  const retired = RETIRED[cls]
  if (retired) return cssVarColor(retired.token, 1, retired.swatch)
  const tw = cls.match(/^text-([a-z]+)-\d{2,3}$/)
  if (tw?.[1] && TAILWIND_400[tw[1]]) return TAILWIND_400[tw[1]] as string
  if (TAILWIND_400[cls]) return TAILWIND_400[cls] as string
  return DEFAULT_ICON_COLOR
}
