/**
 * An open hand: something a person does themselves rather than something that
 * happens on its own.
 *
 * Used by the chat's "ask me first" permission mode and by the Manual choice
 * on the AI settings screen — the same meaning in both.
 *
 * Drawn here because the icon set Mindex uses has no hand at all — all 658 of
 * its icons were checked by name and by tag, and the only matches were a
 * handheld phone and a drag handle. The same reason the Gemini glyph is drawn
 * by hand elsewhere.
 *
 * Sized and coloured from the surrounding text so it lines up with the codicons
 * beside it.
 */
export function HandIcon({ size = 13 }: { size?: number }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden="true"
    >
      {/*
        One outlined silhouette: fingers up, a valley between each, the palm
        rounding into a thumb at the lower left.

        Three fingers rather than four. At thirteen pixels each valley gets
        about one pixel to exist in, and the fourth is the one that closes up
        first — four fingers read as a comb, three still read as a hand.
      */}
      <path d="M4.35 9.2V6.25a1 1 0 0 1 2 0V7.5q.2.35.4 0V4.65a1 1 0 0 1 2 0V7.3q.2.35.4 0V5.65a1 1 0 0 1 2 0v4.4a3.5 3.5 0 0 1-3.5 3.5h-1a3.3 3.3 0 0 1-2.33-.97L2.35 10.6a1 1 0 0 1 1.41-1.41Z" />
    </svg>
  )
}
