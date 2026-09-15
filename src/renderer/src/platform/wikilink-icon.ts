import { setWikilinkIconResolver, type WikilinkIcon } from '@/platform/markdown/markdown'
import { resolveWikilink } from '@/platform/markdown/wikilink'
import { useVaultStore } from '@/platform/workspace'
import { defaultFileIcon, noteLook } from './presentation'

/**
 * Teach the markdown renderer how a link to a note is illustrated.
 *
 * Rendered text was the last place a chosen icon did not appear, and the
 * reason was not carelessness: a link carries a target like `[[some note]]`,
 * not a path, and a choice is stored against a path. So the renderer had
 * nothing to look one up with and fell back to the icon for the file kind.
 *
 * Resolving the link first is what closes that. An unresolved link — pointing
 * at a note that does not exist yet — keeps the plain default, which is right:
 * there is nothing yet for anyone to have chosen an icon for.
 *
 * Wired at startup rather than imported by the renderer, because the settings
 * store already imports the renderer and importing back would close a loop.
 */
export function registerWikilinkIcon(): void {
  setWikilinkIconResolver((target, lookupBase): WikilinkIcon => {
    const path = resolveWikilink(target, useVaultStore.getState().notes)
    if (!path) return defaultFileIcon(lookupBase)
    const look = noteLook(path, lookupBase)
    return { name: look.icon ?? 'file', color: look.colorClass }
  })
}
