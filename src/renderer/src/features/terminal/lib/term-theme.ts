import { cssVarColor } from '@/platform/theme'

/**
 * What the terminal paints with, in each theme.
 *
 * xterm.js renders to a canvas, so none of this can be a CSS variable the way
 * the rest of the app's colour is — it has to be handed over as sixteen
 * literal strings and re-handed over whenever the theme changes. That is the
 * same constraint the graph canvas has, and the reason `cssVarColor` lives in
 * `platform/theme` rather than inside either feature.
 *
 * Two halves, deliberately:
 *
 * - **The surface** — what the terminal's own background and cursor sit on —
 *   is read from the elevation ladder, so the panel and the terminal inside it
 *   are the same colour by construction rather than by a hex kept in sync by
 *   hand. The dark value that used to be written here literally, `rgb(32, 33,
 *   34)`, is exactly what `--bg-2` resolves to; nothing about the dark theme
 *   changes.
 * - **The sixteen ANSI slots** are a palette, not part of the app's colour
 *   system. A program printing "red" means red, and there is no elevation
 *   ladder position that answers that. They are Chris Kempson's Tomorrow —
 *   Tomorrow Night for the dark theme, which is what was already here, and
 *   plain Tomorrow for light, which is the same palette re-tuned for a pale
 *   background by its own author.
 *
 * Tomorrow publishes seven hues and no separate bright set. The dark theme's
 * bright slots come from Tomorrow Night Bright, its own published variant;
 * light has no such variant, so its bright slots repeat the normal hues. The
 * visible consequence is that bold text in a light terminal is bold but not
 * also brighter, which is the honest result of the palette not defining one.
 */

interface AnsiPalette {
  foreground: string
  cursor: string
  selectionBackground: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

const TOMORROW_NIGHT: AnsiPalette = {
  foreground: 'rgba(220, 220, 220, 1)',
  cursor: 'rgba(220, 220, 220, 0.85)',
  selectionBackground: 'rgba(120, 130, 150, 0.30)',
  black: '#1d1f21',
  red: '#cc6666',
  green: '#b5bd68',
  yellow: '#f0c674',
  blue: '#81a2be',
  magenta: '#b294bb',
  cyan: '#8abeb7',
  white: '#c5c8c6',
  brightBlack: '#666666',
  brightRed: '#d54e53',
  brightGreen: '#b9ca4a',
  brightYellow: '#e7c547',
  brightBlue: '#7aa6da',
  brightMagenta: '#c397d8',
  brightCyan: '#70c0b1',
  brightWhite: '#eaeaea'
}

const TOMORROW: AnsiPalette = {
  foreground: 'rgba(77, 77, 76, 1)',
  cursor: 'rgba(77, 77, 76, 0.85)',
  selectionBackground: 'rgba(120, 130, 150, 0.26)',
  black: '#4d4d4c',
  red: '#c82829',
  green: '#718c00',
  yellow: '#eab700',
  blue: '#4271ae',
  magenta: '#8959a8',
  cyan: '#3e999f',
  white: '#d6d6d6',
  brightBlack: '#8e908c',
  brightRed: '#c82829',
  brightGreen: '#718c00',
  brightYellow: '#eab700',
  brightBlue: '#4271ae',
  brightMagenta: '#8959a8',
  brightCyan: '#3e999f',
  brightWhite: '#ffffff'
}

/**
 * Call at mount and again on every theme change — the ladder is read live, so
 * the returned object is only correct for the theme in effect when it is
 * built.
 */
export function termTheme(resolved: 'dark' | 'light'): AnsiPalette & {
  background: string
  cursorAccent: string
} {
  const surface = cssVarColor('--bg-2')
  return {
    ...(resolved === 'light' ? TOMORROW : TOMORROW_NIGHT),
    background: surface,
    // What the cursor block punches out of, so it is the background, not a
    // colour of its own: a mismatch here shows as a coloured hole under the
    // character the cursor is on.
    cursorAccent: surface
  }
}
