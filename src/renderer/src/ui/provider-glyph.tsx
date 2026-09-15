import type { ProviderId } from '@shared/types'
import { Icon } from './icon'
import { providerIcon, providerIconClass } from '@/platform/providers'

/**
 * A provider's mark, at a consistent optical size.
 *
 * Claude and OpenAI both ship as codicons; Gemini does not, and the nearest
 * stand-in (`sparkle`) reads as a shield rather than a brand. So Gemini gets
 * its actual four-pointed star, drawn inline — an SVG rather than a bitmap so
 * it stays sharp at 12px in a menu row and 14px in a settings tile, and takes
 * its colour from `currentColor` like every icon around it.
 */
export function ProviderGlyph({
  id,
  size = 14,
  className = '',
  tone = 'brand'
}: {
  id: ProviderId
  size?: number
  className?: string
  /**
   * `'brand'` paints each mark its vendor colour. `'current'` drops the
   * colour entirely so the glyph inherits whatever it sits on — needed on
   * coloured surfaces, where Gemini's brand blue on a blue button would be
   * all but invisible.
   */
  tone?: 'brand' | 'current'
}): JSX.Element {
  const brand = tone === 'brand'
  if (id === 'gemini') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
        className={`shrink-0 ${brand ? providerIconClass(id) : ''} ${className}`}
        // The colour helpers in globals.css target `.codicon`, which this is
        // not, so the fill is set here from the same brand value.
        style={brand ? { color: '#4285f4' } : undefined}
      >
        <path d="M12 0c0 6.627-5.373 12-12 12 6.627 0 12 5.373 12 12 0-6.627 5.373-12 12-12-6.627 0-12-5.373-12-12z" />
      </svg>
    )
  }
  return (
    <Icon
      name={providerIcon(id)}
      size={size}
      className={`${brand ? providerIconClass(id) : ''} ${className}`}
    />
  )
}
