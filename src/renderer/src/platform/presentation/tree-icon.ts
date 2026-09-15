import type { ProviderId } from '@shared/types'
import { defaultFileIcon, managedFileIcon } from './tree-display'

/**
 * Which icon a file or folder gets — one answer, for everywhere that draws one.
 *
 * The tree, the tab strip and the graph all have to agree, and they used not
 * to: each re-implemented the precedence, and the graph got the folder key
 * wrong (see `overrideKeyFor` below), so folder icons set in the tree simply
 * did not appear. Sharing the function is what makes "identical" structural
 * instead of something to keep remembering.
 *
 * Precedence, unchanged from what the tree has always done:
 *   1. the icon the user picked for this exact row;
 *   2. for a managed file with nothing picked, the active provider's mark;
 *   3. the built-in default for the extension, or `folder`.
 */

export interface TreeIconTarget {
  kind: 'note' | 'folder'
  /** Basename for a note; the folder's own name for a folder. */
  name: string
  /**
   * The key this row's overrides are stored under.
   *
   * NOT interchangeable between the two kinds — see {@link overrideKeyFor}.
   */
  overrideKey: string
  /** Only consulted for a folder, which has no other state to read. */
  expanded?: boolean
}

export interface ResolvedTreeIcon {
  /** Codicon name, or null when the provider mark should be drawn instead. */
  icon: string | null
  /** A `codicon-*` or `text-*` class. Null only for a note with no override
   *  and no extension-based default — a folder always gets one, see
   *  `DEFAULT_FOLDER_ICON_COLOR`. */
  colorClass: string | null
  /** Draw the active provider's mark rather than `icon`. */
  provider: ProviderId | null
}

/**
 * What a folder icon is when nobody has chosen — the tree, the tab strip, the
 * breadcrumb, the graph and the folder-view cards all read this one constant
 * rather than each hardcoding a fallback, so "what colour is an un-customized
 * folder" is a one-line edit here instead of a hunt through five files that
 * used to quietly disagree. Files keep their own per-extension defaults (or
 * plain grey) — this is folders only.
 *
 * Grey, and it has been three things: the app's accent, then the palette's
 * blue, now the palette's grey — which is the same value the base icon rule
 * paints anything nobody has coloured. That is the argument for it: a folder
 * with no choice made about it should look like everything else with no
 * choice made about it. Blue said "this one is special" about every folder in
 * the vault at once, which says nothing at all, and left no colour free to
 * mean "selected".
 */
export const DEFAULT_FOLDER_ICON_COLOR = 'codicon-grey'

/**
 * The key `iconOverrides` / `iconColorOverrides` are stored under.
 *
 * A note is keyed by its **absolute** path and a folder by its **vault-relative
 * posix** path. That asymmetry is not a choice made here — it is what
 * `TreeNode.path` already holds (`lib/tree.ts`: "abs path for note, posix rel
 * for folder"), and the overrides were written under whatever the tree row
 * passed in. Reading them back with the wrong one silently finds nothing,
 * which looks exactly like "the user never set an icon".
 */
export function overrideKeyFor(kind: 'note' | 'folder', absPath: string, relPath: string): string {
  return kind === 'folder' ? relPath : absPath
}

export function resolveTreeIcon(
  target: TreeIconTarget,
  iconOverrides: Record<string, string>,
  iconColorOverrides: Record<string, string>,
  engineProvider: ProviderId
): ResolvedTreeIcon {
  const override = iconOverrides[target.overrideKey]
  // `||` rather than `??`, matching the tree: an override stored as an empty
  // string means "cleared", and must fall through to the default.
  const colorOverride = iconColorOverrides[target.overrideKey] || null

  if (target.kind === 'folder') {
    // The vault root is keyed by the empty relative path, and it is not an
    // ordinary folder — it is the workspace itself, and it is the one folder
    // that appears in the breadcrumb, the switcher and the tree at once. It
    // gets its own mark, and an override still wins over it like anywhere.
    const isRoot = target.overrideKey === ''
    return {
      icon: override ?? (isRoot ? 'folder-library' : target.expanded ? 'folder-opened' : 'folder'),
      colorClass: colorOverride ?? DEFAULT_FOLDER_ICON_COLOR,
      provider: null
    }
  }

  const isManaged = managedFileIcon(target.name) !== null
  const fallback = defaultFileIcon(target.name)

  // A managed file with nothing picked shows the selected provider's mark in
  // its brand colour; anything the user picked for the row wins over that, as
  // it does everywhere else.
  if (isManaged && !override && !colorOverride) {
    return { icon: null, colorClass: null, provider: engineProvider }
  }

  return {
    icon: override ?? fallback.name,
    colorClass: colorOverride ?? fallback.color,
    provider: null
  }
}
