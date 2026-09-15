/**
 * How anything says "this one is chosen" — in one place, for the whole app.
 *
 * There were nine of them: the provider tiles and the model pills on the AI
 * screen, both manual/auto pairs, the theme tiles, the small pill toggles, the
 * sliding mark in the segmented picker, the chat/terminal picker in the right
 * sidebar, the two first-run steps that repeat the first two, and the open
 * vault in the vaults list. Every one used to spell this out itself, so
 * "change how a chosen thing looks" meant nine edits that could disagree, and
 * did — the same state shipped at three different border opacities and two
 * different fills at once.
 *
 * Now it is these two lines.
 *
 * The values, and why they are what they are:
 *
 * - The chosen box is named by its edge, in the full accent — not a tint of
 *   it. An edge at 40 or 60 per cent reads as a disabled edge next to a solid
 *   one, and these sit beside each other.
 * - Its fill is the accent at 8 per cent. A *tint* rather than a step up the
 *   grey ladder, and that is the point: a grey fill has to be chosen against
 *   the particular surface it lands on, and gets it wrong the moment the same
 *   control appears somewhere a shade different — which is exactly what
 *   happened, twice, when this was `bg-1` on a `bg-1` page and showed nothing
 *   at all. A tint is a different hue from every grey in the set, so it reads
 *   on all of them.
 * - The quiet edge is `bd-2`, one step further out than the rule under a card
 *   title. It was `bd-1`, whose value is deliberately identical to `bg-2` —
 *   fine while every picker sat on `bg-1`, and invisible the moment the
 *   dialogs moved up to `bg-2`, which is where most pickers in the app live.
 *   `bd-2` reads on both, which is what a shared value has to do.
 * - Hover on an unchosen box is a plain grey step, never a tint — the tint is
 *   reserved for the answer, and pointing at something is not answering. It
 *   steps to `bg-3` for the same reason the edge moved: a `bg-2` hover on a
 *   `bg-2` panel is no hover at all.
 */
export const PICKER_SELECTED = 'border-accent-1 bg-accent-1/[0.08]'

export const PICKER_UNSELECTED = 'border-bd-2 bg-transparent hover:bg-bg-3'

export function pickerOption(selected: boolean): string {
  return selected ? PICKER_SELECTED : PICKER_UNSELECTED
}

/**
 * The same chosen look for the two places that are not one box of a set: the
 * segmented picker's separate sliding mark, and the open vault's row — both
 * draw no edge of their own until they need one, so the `border` utility comes
 * along here rather than from the element's own class list.
 */
export const PICKER_SELECTED_MARK = `border ${PICKER_SELECTED}`
