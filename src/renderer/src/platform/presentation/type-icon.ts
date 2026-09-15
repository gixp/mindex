/**
 * `color` on a note type definition holds one of two things: a palette word
 * the registry ships (`sky`, `emerald`), or a Tailwind class the icon picker
 * wrote. Only the second is renderable; the first falls through to the default
 * colour, which is what it did before types were editable.
 */
export function typeIconColorClass(color: string | undefined): string | undefined {
  return color && color.startsWith('text-') ? color : undefined
}
