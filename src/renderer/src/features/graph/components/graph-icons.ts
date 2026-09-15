import type { GraphNode } from '@shared/graph'
import type { ProviderId } from '@shared/types'
import { codiconGlyph } from '@/platform/presentation/codicon-glyphs'
import { iconColorValue } from '@/platform/presentation/icon-colors'
import { providerIcon, providerIconClass } from '@/platform/providers'
import { folderLookFrom, noteLookFrom, presentationSettings } from '@/platform/presentation'

/**
 * A node's icon, as something the canvas can draw.
 *
 * Which icon it is, is not decided here — the presentation facade decides
 * that, and
 * it is the same call the tree rows make. This only turns that answer into a
 * glyph and a colour value, because canvas has no `::before` to hang a
 * stylesheet rule on and no class to resolve a colour through.
 */

export interface ResolvedIcon {
  /** The character to draw, or null when the font has no such icon. */
  glyph: string | null
  color: string
  /**
   * Gemini's mark is an inline SVG, not a font glyph, so it cannot be drawn
   * as text. Set when the node should be painted with {@link GEMINI_STAR}.
   */
  geminiStar?: boolean
}

/**
 * Gemini's four-pointed star, on a 24×24 grid — the same path
 * `ProviderGlyph` renders inline, because Gemini ships no codicon and the
 * nearest stand-in (`sparkle`) reads as a shield rather than a brand.
 */
export const GEMINI_STAR =
  'M12 0c0 6.627-5.373 12-12 12 6.627 0 12 5.373 12 12 0-6.627 5.373-12 12-12-6.627 0-12-5.373-12-12z'

/** Brand colours, matching `.codicon-brand-*` in globals.css. */
const PROVIDER_COLOR: Record<ProviderId, string> = {
  claude: '#d97757',
  // OpenAI's mark is monochrome by design; `codicon-white` in the tree.
  codex: '#ffffff',
  gemini: '#4285f4'
}

/**
 * The arguments default to whatever is currently set, so a screen does not
 * have to thread them through. They stay arguments rather than being read
 * inside because this is a pure function with tests that pin every branch of
 * the precedence — the ability to hand it a specific answer is the reason
 * those tests are worth having.
 */
export function resolveNodeIcon(
  node: GraphNode,
  iconOverrides: Record<string, string> = presentationSettings().iconOverrides,
  iconColorOverrides: Record<string, string> = presentationSettings().iconColorOverrides,
  engineProvider: ProviderId = presentationSettings().provider
): ResolvedIcon {
  // Notes are keyed absolutely and folders relatively, which is exactly the
  // distinction the facade's two functions exist to make impossible to get
  // wrong — this used to build the key itself, and a miss there is silent: the
  // node simply looks like nobody ever chose an icon for it.
  //
  // A graph node has nothing to expand, so a folder is always the closed one
  // rather than whatever the tree happens to be showing.
  const settings = {
    iconOverrides,
    iconColorOverrides,
    provider: engineProvider
  }
  const resolved =
    node.kind === 'folder'
      ? folderLookFrom(settings, node.relPath, node.name, false)
      : noteLookFrom(settings, node.id, node.name)

  if (resolved.provider) {
    if (resolved.provider === 'gemini') {
      return { glyph: null, color: PROVIDER_COLOR.gemini, geminiStar: true }
    }
    return {
      glyph: codiconGlyph(providerIcon(resolved.provider)),
      color: brandColor(resolved.provider)
    }
  }

  return {
    glyph: resolved.icon ? (codiconGlyph(resolved.icon) ?? codiconGlyph('file')) : null,
    color: iconColorValue(resolved.colorClass)
  }
}

/** The provider's brand colour, keyed off the same class the tree applies. */
function brandColor(id: ProviderId): string {
  // `codicon-white` is a real entry in the shared palette; the brand classes
  // are not, so they resolve here.
  const cls = providerIconClass(id)
  return cls.startsWith('codicon-brand-') ? PROVIDER_COLOR[id] : iconColorValue(cls)
}

/**
 * Whether the icon font is ready to draw with.
 *
 * A canvas `fillText` in a font the browser has not loaded yet silently falls
 * back to a default face, which for a private-use codepoint means a tofu box —
 * and unlike a DOM node, the canvas will not repaint itself when the font
 * arrives. So the caller waits for this and then forces one redraw.
 */
export function whenCodiconFontReady(): Promise<void> {
  if (!('fonts' in document)) return Promise.resolve()
  return document.fonts
    .load('16px codicon')
    .then(() => undefined)
    .catch(() => undefined)
}
