import type { Config } from 'tailwindcss'
import plugin from 'tailwindcss/plugin'
import { LAYERS, PIXEL_FONT_SIZES, PIXEL_RADII } from './src/shared/design-tokens'

/**
 * One of the utility palette's colour scales, pointed at a single token.
 *
 * The app has exactly one red, one yellow and one green. The scales they
 * replace had eleven steps each, and the codebase had picked eight of them
 * more or less at random — `red-300` here, `red-400` there, `red-500` for a
 * fill — with nothing choosing between them and no light-theme value behind
 * any of them. Collapsing the scale means a call site that names a step still
 * gets the app's colour instead of a hue from outside the system.
 *
 * The two lightest steps keep a distinction, because one real thing was being
 * expressed by them: a word that lights up under the pointer, or a word set on
 * a tint of its own colour. That is the `-soft` companion, which is the same
 * colour moved one step away from the surface behind it — lighter in the dark
 * theme, darker in the light one.
 */
function statusScale(name: string, token: string): Record<string, Record<string, string>> {
  const base = `hsl(var(${token}) / <alpha-value>)`
  const soft = `hsl(var(${token}-soft, var(${token})) / <alpha-value>)`
  const steps = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950']
  const scale: Record<string, string> = { DEFAULT: base }
  for (const step of steps) {
    scale[step] = Number(step) <= 300 ? soft : base
  }
  return { [name]: scale }
}

export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    // Replaces Tailwind's default stacking scale rather than extending it.
    // Leaving `z-20` reachable alongside `z-dialog` would be the old problem
    // with extra steps: the point is that a call site has to name what it is,
    // and it cannot do that while an anonymous number is still available.
    // `auto` stays, since "no stacking context of its own" is a real answer.
    zIndex: { auto: 'auto', ...LAYERS },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        'border-strong': 'hsl(var(--border-strong))',
        'surface-muted': 'hsl(var(--surface-muted))',
        accent2: 'hsl(var(--accent2))',
        // `<alpha-value>` so `bg-accent-1/15` works: the raw blues this
        // replaces were used at fourteen different opacities, and a token
        // that cannot be faded is one they would keep going around.
        'accent-1': 'hsl(var(--accent-1) / <alpha-value>)',
        'accent-1-hover': 'hsl(var(--accent-1-hover) / <alpha-value>)',
        // Each assistant's own colour, already held as three numbers in
        // globals.css for the working-on-it glow. Exposed here so the composer
        // can say which assistant it is about to send to — as a fill on the
        // send button and as an edge on the box being written in.
        //
        // `<alpha-value>` for the same reason the accent has it: these are used
        // as a solid fill, as a hairline and as a hint, and a token that cannot
        // be faded is one call sites write a hex to get around.
        'brand-claude': 'hsl(var(--brand-claude) / <alpha-value>)',
        'brand-gemini': 'hsl(var(--brand-gemini) / <alpha-value>)',
        'brand-codex': 'hsl(var(--brand-codex) / <alpha-value>)',
        // The Send button's fill for that assistant, which is the mark on a
        // dark ground and a lighter grey on a light one — see globals.css.
        'send-codex': 'hsl(var(--send-codex) / <alpha-value>)',
        'send-codex-fg': 'hsl(var(--send-codex-fg) / <alpha-value>)',
        // The icon palette, as text and fills too.
        //
        // These were reachable only through the `codicon-*` helpers, which
        // colour an icon and nothing else — so a value that wanted to be the
        // same hue as its own mark had to reach for a utility-palette shade
        // instead, and that shade has no light-theme answer. Same eight hues,
        // same two themes, now available to words as well as glyphs.
        'ic-grey': 'hsl(var(--ic-grey) / <alpha-value>)',
        'ic-blue': 'hsl(var(--ic-blue) / <alpha-value>)',
        'ic-cyan': 'hsl(var(--ic-cyan) / <alpha-value>)',
        'ic-emerald': 'hsl(var(--ic-emerald) / <alpha-value>)',
        'ic-emerald-soft': 'hsl(var(--ic-emerald-soft) / <alpha-value>)',
        'ic-amber': 'hsl(var(--ic-amber) / <alpha-value>)',
        'ic-amber-soft': 'hsl(var(--ic-amber-soft) / <alpha-value>)',
        'ic-orange': 'hsl(var(--ic-orange) / <alpha-value>)',
        'ic-red': 'hsl(var(--ic-red) / <alpha-value>)',
        'ic-red-soft': 'hsl(var(--ic-red-soft) / <alpha-value>)',
        // The utility palette's warm and green scales, redirected onto the
        // three status tokens.
        //
        // Every shade of each scale resolves to one colour, so `text-red-400`,
        // `bg-red-500/15` and `border-red-400/45` are all the same red — and
        // so is anything written tomorrow by someone who reaches for the
        // palette out of habit. The lighter steps (200/300) map to the `-soft`
        // companion, because that is what they were being used for: a hover
        // and a word on a tint of its own colour.
        //
        // This is the net, not the intent. Call sites say `ic-red` / `ic-amber`
        // / `ic-emerald`, the linter says so too (eslint.config.js), and these
        // entries are here so that a miss is still the right colour rather than
        // a stray hue with no light-theme answer.
        ...statusScale('red', '--ic-red'),
        ...statusScale('rose', '--ic-red'),
        ...statusScale('amber', '--ic-amber'),
        ...statusScale('yellow', '--ic-amber'),
        ...statusScale('emerald', '--ic-emerald'),
        ...statusScale('green', '--ic-emerald'),
        ...statusScale('lime', '--ic-emerald'),
        ...statusScale('orange', '--ic-orange'),
        'ic-pink': 'hsl(var(--ic-pink) / <alpha-value>)',
        'ic-purple': 'hsl(var(--ic-purple) / <alpha-value>)',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))'
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))'
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))'
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
          'foreground-hover': 'hsl(var(--muted-foreground-hover))'
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          // One step further out, for a control that already rests on accent.
          hover: 'hsl(var(--accent-hover))',
          foreground: 'hsl(var(--accent-foreground))'
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))'
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))'
        },
        // The elevation ladder — see plan/color-schema-migration.md and
        // globals.css's own comment on the --bg-N variables.
        'bg-1': 'hsl(var(--bg-1))',
        'bg-2': 'hsl(var(--bg-2))',
        'bg-3': 'hsl(var(--bg-3))',
        'bg-4': 'hsl(var(--bg-4))',
        // Border ladder — own vocabulary from bg-N, see globals.css's
        // comment on --bd-1.
        'bd-1': 'hsl(var(--bd-1))',
        'bd-2': 'hsl(var(--bd-2))',
        'bd-3': 'hsl(var(--bd-3))',
        // Text ladder — own vocabulary from bg-N/bd-N, see globals.css's
        // comment on --c-1.
        'c-1': 'hsl(var(--c-1))',
        'c-2': 'hsl(var(--c-2))',
        // A change that has been accepted and written. `<alpha-value>` for the
        // same reason the accent has it: it is used as a word, as a hairline
        // and as a tint, and a token that cannot be faded gets worked around.
        'ai-done': 'hsl(var(--ai-done) / <alpha-value>)',
        'c-2-hover': 'hsl(var(--c-2-hover))',
        // The dimming behind a modal (globals.css). Carries its own alpha,
        // so it is used bare — `bg-scrim`, never `bg-scrim/40`.
        scrim: 'hsl(var(--scrim))'
      },
      boxShadow: {
        // The shadow set (globals.css). Theme-aware: a block asks for "a
        // small shadow" and gets what that means in the theme it is in.
        s1: 'var(--sh-1)',
        s2: 'var(--sh-2)'
      },
      borderRadius: {
        DEFAULT: 'var(--radius)',
        sm: 'var(--radius)',
        md: 'var(--radius)',
        lg: 'var(--radius)',
        xl: 'var(--radius)',
        // Named tokens for the literal pixel radii already scattered across
        // the app as `rounded-[Npx]` (100+ call sites) — every value that
        // grep actually found, so any of them can become e.g. `rounded-8`
        // with zero visual change. Not migrated in this pass (see
        // eslint.config.js's arbitrary-value rule below); adopt opportunistically.
        // Shared with `lib/cn.ts` — see design-tokens.ts's own comment.
        // The radius set (globals.css). A component picks one of these;
        // the literal PIXEL_RADII below are the pre-existing inventory being
        // migrated onto them, not a scale to reach for.
        r0: 'var(--r-0)',
        r1: 'var(--r-1)',
        r2: 'var(--r-2)',
        r3: 'var(--r-3)',
        r4: 'var(--r-4)',
        ...PIXEL_RADII
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        heading: ['Regola Pro', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Geist Mono', 'ui-monospace', 'monospace']
      },
      // Same idea as borderRadius above: named tokens for the literal pixel
      // sizes already in use as `text-[Npx]` (350+ call sites, mostly the
      // dense UI text sizes — 10/11/12/13px — plus a long tail of one-off
      // fine-tuned sizes). A bare pixel value, not a [size, lineHeight]
      // tuple, so `text-12` renders identically to today's `text-[12px]`:
      // no line-height override either has. Shared with `lib/cn.ts` — see
      // design-tokens.ts's own comment.
      fontSize: { ...PIXEL_FONT_SIZES }
    }
  },
  plugins: [
    /**
     * `light:` — the light theme as a variant, for the one thing tokens
     * cannot express.
     *
     * Nearly all colour here is a CSS variable that simply holds a different
     * value under `[data-theme="light"]`, and needs no variant at all. This
     * exists for palettes that are not positions in the colour system — the
     * chat mode buttons, whose fills are brand hues at partial opacity. On a
     * dark panel, letting the background through softens a fill; on a pale
     * one the same trick washes it out and takes the white arrow on it below
     * readable. That is a different class, not a different value, so it needs
     * a selector.
     *
     * Not a general-purpose escape hatch: reach for a token first, and use
     * this only where the two themes genuinely need different classes.
     */
    plugin(({ addVariant }) => {
      addVariant('light', "&:where([data-theme='light'], [data-theme='light'] *)")
    })
  ]
} satisfies Config
