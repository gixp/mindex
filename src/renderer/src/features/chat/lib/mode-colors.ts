import { isUnpromptedMode } from '@shared/acp'
import type { ProviderId } from '@shared/types'

/**
 * A colour per permission mode.
 *
 * Colour used to mean one thing here — "this mode asks nothing and allows
 * anything" — and everything else was uncoloured. Now it identifies the mode
 * instead: which one is in force is worth seeing at a glance, and a single
 * warning colour could not say which.
 *
 * Lives in one place because two surfaces read it — the icons in the mode menu
 * and the send button — and they must never disagree about the mode in force.
 */

export interface ModeColor {
  /** Background of the send and stop buttons, with hover and active states. */
  button: string
  /** Arrow colour on that background. */
  buttonText: string
  /**
   * The send button with nothing to send: the same colour, far weaker.
   *
   * Not a neutral grey. Which mode is in force is worth seeing whether or not
   * there is anything typed yet, and going grey while empty made the colour
   * flicker in and out as the box filled and emptied. Carries its own text
   * colour because at this weight the fill is nearly the background, so a
   * full-strength arrow would not read as inactive.
   */
  buttonDisabled: string
  /**
   * The message box's outline while it has focus.
   *
   * Only on focus — an outline that is always lit competes with the text being
   * written. Kept weaker than the button: the button says which mode is in
   * force, this only carries the same colour so the two read as one thing.
   */
  focusRing: string
}

/** White arrow — right for every colour except the light one. */
const ON_DARK = 'text-white'

/**
 * The arrow on a fill this weak: present, plainly inactive.
 *
 * White in the dark theme, where the weak fill sits dark against the panel.
 * In the light theme the same fill is nearly the page, so a white arrow would
 * vanish into it and the arrow goes dark instead.
 */
const OFF = 'text-white/40 light:text-foreground/40'

/*
 * Softened rather than solid — in the dark theme.
 *
 * On a dark background a lighter shade reads as *more* intense, not less — it
 * is brighter. Letting the background show through is what actually softens a
 * fill here, so the resting state is partly transparent and hover firms it up.
 *
 * That reasoning inverts on a pale background, where the same transparency
 * washes the fill out towards the page and takes the white arrow on it below
 * readable. So the light theme runs these solid, and darkens on hover instead
 * of firming up. Its resting fill is the shade the dark theme presses to, and
 * hover and press step down from there — the same hue throughout, one notch
 * darker at each step, so a mode is the same colour in both themes and only
 * its weight changes.
 *
 * Written out in full, never assembled from pieces: the stylesheet is built by
 * scanning this source for whole class names, so a class put together at
 * runtime is simply absent from it and the button comes out unstyled.
 */
const BY_MODE: Record<string, ModeColor> = {
  auto: {
    button:
      'bg-[#ea718c]/75 hover:bg-[#ea718c]/90 active:bg-[#ce637b]/90 light:bg-[#ce637b] light:hover:bg-[#b5546b] light:active:bg-[#9c4a5d]',
    buttonText: ON_DARK,
    buttonDisabled: `bg-[#ea718c]/25 light:bg-[#ce637b]/20 ${OFF}`,
    focusRing: 'focus-within:ring-[#ea718c]/50'
  },
  default: {
    // Claude's own orange, the one its mark is drawn in (`#d97757`, kept in
    // step with the brand colour in `graph-icons.ts` and `globals.css`).
    button:
      'bg-[#d97757]/75 hover:bg-[#d97757]/90 active:bg-[#bf694d]/90 light:bg-[#bf694d] light:hover:bg-[#a55a42] light:active:bg-[#8c4c38]',
    buttonText: ON_DARK,
    buttonDisabled: `bg-[#d97757]/25 light:bg-[#bf694d]/20 ${OFF}`,
    focusRing: 'focus-within:ring-[#d97757]/50'
  },
  acceptEdits: {
    // Light on purpose: a mid grey would read as switched off even with
    // something to send. Held at a higher opacity than the rest for the same
    // reason, and the arrow goes dark to stay visible on it.
    button:
      'bg-zinc-300/85 hover:bg-zinc-300 active:bg-zinc-400 light:bg-zinc-600 light:hover:bg-zinc-700 light:active:bg-zinc-800',
    buttonText: 'text-zinc-900 light:text-white',
    // The weak fill sits dark against the panel like every other, so the arrow
    // goes light here even though the strong fill wants a dark one.
    buttonDisabled: `bg-zinc-300/25 light:bg-zinc-600/20 ${OFF}`,
    focusRing: 'focus-within:ring-zinc-300/50'
  },
  plan: {
    button: 'bg-accent-1/75 hover:bg-accent-1/90 active:bg-accent-1/80',
    buttonText: ON_DARK,
    buttonDisabled: `bg-accent-1/25 ${OFF}`,
    focusRing: 'focus-within:ring-accent-1/50'
  },
  dontAsk: {
    // Green reads as safe, and this mode is: it stops asking by refusing
    // anything not already allowed, which makes it stricter than the ordinary
    // one rather than looser.
    button:
      'bg-emerald-500/75 hover:bg-emerald-500/90 active:bg-emerald-600/90 light:bg-emerald-600 light:hover:bg-emerald-700 light:active:bg-emerald-800',
    buttonText: ON_DARK,
    buttonDisabled: `bg-emerald-500/25 light:bg-emerald-600/20 ${OFF}`,
    focusRing: 'focus-within:ring-emerald-400/50'
  },
  bypassPermissions: {
    button:
      'bg-purple-500/75 hover:bg-purple-500/90 active:bg-purple-600/90 light:bg-purple-600 light:hover:bg-purple-700 light:active:bg-purple-800',
    buttonText: ON_DARK,
    buttonDisabled: `bg-purple-500/25 light:bg-purple-600/20 ${OFF}`,
    focusRing: 'focus-within:ring-purple-400/50'
  }
}

/*
 * ── The assistant's own colour ────────────────────────────────────────────
 *
 * The send button and the box being written in take the colour of the
 * *assistant* they will reach. Which one is in force is the thing most worth
 * seeing before pressing send: a message goes to one assistant and not another,
 * and until this existed nothing on the composer said which.
 *
 * Solid at rest, dimming under the pointer and further under a press — the way
 * a filled control behaves everywhere else. The mode buttons above soften in
 * the dark theme and run solid in the light one, which needs three shades of
 * one hue; a brand colour has one value and inverting it would stop being the
 * brand.
 *
 * Written out in full, never assembled — same reason as the modes above: the
 * stylesheet is built by scanning this source for whole class names.
 */
const BY_PROVIDER: Record<ProviderId, ModeColor> = {
  claude: {
    button: 'bg-brand-claude hover:bg-brand-claude/90 active:bg-brand-claude/75',
    buttonText: ON_DARK,
    buttonDisabled: `bg-brand-claude/25 ${OFF}`,
    focusRing: 'focus-within:ring-brand-claude/50'
  },
  gemini: {
    button: 'bg-brand-gemini hover:bg-brand-gemini/90 active:bg-brand-gemini/75',
    buttonText: ON_DARK,
    buttonDisabled: `bg-brand-gemini/25 ${OFF}`,
    focusRing: 'focus-within:ring-brand-gemini/50'
  },
  codex: {
    // The one mark with no hue. It inverts with the theme — near-white on dark,
    // near-black on light — so the arrow on it has to invert the other way, and
    // `--bg-1` is the value that already does: dark in the dark theme, pale in
    // the light one. A white arrow would vanish on it half the time.
    //
    // The fill is its own token rather than the mark: near-black at this size
    // reads as a hole punched in a light page, where the other two assistants
    // get a colour. It is the mark on a dark ground and a grey on a light one.
    button: 'bg-send-codex hover:bg-send-codex/90 active:bg-send-codex/75',
    buttonText: 'text-send-codex-fg',
    buttonDisabled: `bg-send-codex/25 ${OFF}`,
    focusRing: 'focus-within:ring-send-codex/50'
  }
}

/**
 * The colour of the assistant a message is about to go to.
 *
 * Falls back to Claude's for an id that is not one of the three, which is the
 * same default the composer applies when no provider is configured.
 */
export function providerColor(provider: ProviderId | undefined): ModeColor {
  return BY_PROVIDER[provider ?? 'claude'] ?? BY_PROVIDER.claude
}

/**
 * The resting edge of the box being written in, in the assistant's colour.
 *
 * Quiet — the focus ring is the loud one. This only has to say, at a glance and
 * without being looked at, which assistant the tab is on.
 */
const BORDER_BY_PROVIDER: Record<ProviderId, string> = {
  claude: 'border-brand-claude/30',
  gemini: 'border-brand-gemini/30',
  codex: 'border-brand-codex/30'
}

export function providerBorder(provider: ProviderId | undefined): string {
  return BORDER_BY_PROVIDER[provider ?? 'claude'] ?? BORDER_BY_PROVIDER.claude
}

/** What an uncoloured mode gets: the ordinary blue button. */
export const DEFAULT_MODE_COLOR: ModeColor = {
  button: 'bg-accent-1 hover:bg-[#3072f0] active:bg-accent-1/80',
  buttonText: ON_DARK,
  buttonDisabled: `bg-accent-1/25 ${OFF}`,
  focusRing: 'focus-within:ring-accent-1/50'
}

/**
 * The colour for a mode, by the assistant's own name for it.
 *
 * The table covers Claude's six. Codex and Gemini name their modes differently
 * and are not listed — building a table per assistant would go stale the same
 * way the hardcoded model lists did. They fall back on meaning instead: a mode
 * that asks nothing and allows anything is given the same colour as the one
 * Claude calls Bypass, so it still stands apart for them; anything else is
 * simply uncoloured.
 */
export function modeColor(id: string | undefined, label?: string): ModeColor {
  if (!id) return DEFAULT_MODE_COLOR
  const known = BY_MODE[id]
  if (known) return known
  if (isUnpromptedMode({ id, label })) return BY_MODE.bypassPermissions as ModeColor
  return DEFAULT_MODE_COLOR
}
