import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'
import { PIXEL_FONT_SIZES, PIXEL_RADII } from '@shared/design-tokens'

// tailwind-merge ships its own guess at Tailwind's scale and has no idea
// about the custom bare-number fontSize/borderRadius tokens tailwind.config.ts
// adds (`text-11`, `rounded-8`, ...) unless told. Without this, `text-11`
// doesn't match its font-size group at all, falls into the text-color group
// instead, and gets silently dropped whenever a later `text-foreground`/
// `text-muted-foreground` class shares the same cn() call — the font-size
// utility vanishes and the element falls back to an inherited default. See
// design-tokens.ts's own comment.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: Object.keys(PIXEL_FONT_SIZES),
      radius: Object.keys(PIXEL_RADII)
    }
  }
})

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
