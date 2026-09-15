/**
 * The Mindex mark, at icon size.
 *
 * The same "M" path `BrandLoader` draws, lifted out so a row can carry it the
 * way it carries a provider's mark. Used where something belongs to Mindex
 * itself rather than to one of the three CLIs — a skill that works with any of
 * them, for instance, which used to show a generic sparkle and so read as
 * "unspecified" rather than "ours".
 *
 * Takes its colour from `currentColor`, like every icon around it, so it dims
 * and highlights with whatever row it sits in.
 */

/** On a 1024 grid, matching `BrandLoader` so the two marks stay identical. */
const MARK = 'M 248 752 L 248 280 L 512 600 L 776 280 L 776 752'

export function MindexGlyph({
  size = 14,
  className = ''
}: {
  size?: number
  className?: string
}): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      fill="none"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      <path
        d={MARK}
        stroke="currentColor"
        // Heavier than the loader's 84: at 13px the mark is about a hundredth
        // of the size it was designed at, and a stroke that thin disappears
        // next to the solid provider glyphs it sits beside.
        strokeWidth={116}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
