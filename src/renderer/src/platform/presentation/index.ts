import type { ProviderId } from '@shared/types'
import { useUiStore } from '@/platform/app-settings'
import { defaultFileIcon, treeDisplayName } from '@/platform/presentation/tree-display'
import {
  overrideKeyFor,
  resolveTreeIcon,
  type ResolvedTreeIcon
} from '@/platform/presentation/tree-icon'

/**
 * How a file or folder looks — asked in one way, answered in one place.
 *
 * The precedence itself already lived in one function. The problem was that
 * calling it took four arguments — both override maps and the active engine —
 * so screens routed around it: some called the extension default alone and
 * silently lost the icon the person had chosen, and two re-implemented
 * `override ?? default` inline, making a third and fourth copy of a rule that
 * is supposed to have one.
 *
 * This takes only the file's identity and fetches the rest itself. Nothing to
 * thread through, so there is no longer a reason to skip it.
 *
 * Two forms of every question, because the callers genuinely differ: the hooks
 * are for components, which must redraw when the person picks a new icon; the
 * plain functions are for the markdown renderer and the editor's own nodes,
 * which build markup outside React and only need the current answer.
 *
 * Identity is asymmetric and not interchangeable: a note's choice is stored
 * under its **absolute** path, a folder's under its **vault-relative** one.
 * Passing the wrong one silently finds nothing, which looks exactly like "the
 * person never chose an icon" — the failure this module exists to end. The two
 * functions are separate rather than one with a `kind` argument so that the
 * distinction is impossible to get wrong at the call site.
 */

export interface Look extends ResolvedTreeIcon {
  /** What to show as the name — extension stripped, title preferred. */
  label: string
}

export interface Settings {
  iconOverrides: Record<string, string>
  iconColorOverrides: Record<string, string>
  provider: ProviderId
}

function currentSettings(): Settings {
  const s = useUiStore.getState()
  return {
    iconOverrides: s.iconOverrides,
    iconColorOverrides: s.iconColorOverrides,
    provider: (s.settings?.engine?.provider ?? 'claude') as ProviderId
  }
}

/**
 * How a note looks, given settings taken once.
 *
 * Exported for the two places that resolve many rows at a time — the file
 * tree and the graph. They cannot use the hook forms, because a hook cannot
 * be called in a loop, and so both had reached past this module for the
 * low-level resolver and rebuilt what it does. Taking the settings as an
 * argument is the shape that serves them without a second implementation.
 */
export function noteLookFrom(
  settings: Settings,
  absPath: string,
  basename: string,
  title?: string
): Look {
  return {
    ...resolveTreeIcon(
      { kind: 'note', name: basename, overrideKey: overrideKeyFor('note', absPath, '') },
      settings.iconOverrides,
      settings.iconColorOverrides,
      settings.provider
    ),
    label: treeDisplayName(basename, title)
  }
}

/** How a folder looks, given settings taken once. See `noteLookFrom`. */
export function folderLookFrom(
  settings: Settings,
  relPath: string,
  name: string,
  expanded?: boolean
): Look {
  return {
    ...resolveTreeIcon(
      { kind: 'folder', name, overrideKey: overrideKeyFor('folder', '', relPath), expanded },
      settings.iconOverrides,
      settings.iconColorOverrides,
      settings.provider
    ),
    label: name
  }
}

/** How a note looks. `absPath` is what its choice is stored under. */
export function noteLook(absPath: string, basename: string, title?: string): Look {
  return noteLookFrom(currentSettings(), absPath, basename, title)
}

/** How a folder looks. `relPath` is what its choice is stored under. */
export function folderLook(relPath: string, name: string, expanded?: boolean): Look {
  return folderLookFrom(currentSettings(), relPath, name, expanded)
}

/**
 * The component forms. Subscribed field by field rather than to the whole
 * store, so a note redraws when someone recolours it and not when an unrelated
 * panel opens.
 */
export function useNoteLook(absPath: string, basename: string, title?: string): Look {
  const iconOverrides = useUiStore((s) => s.iconOverrides)
  const iconColorOverrides = useUiStore((s) => s.iconColorOverrides)
  const provider = useUiStore((s) => s.settings?.engine?.provider)
  return noteLookFrom(
    { iconOverrides, iconColorOverrides, provider: (provider ?? 'claude') as ProviderId },
    absPath,
    basename,
    title
  )
}

export function useFolderLook(relPath: string, name: string, expanded?: boolean): Look {
  const iconOverrides = useUiStore((s) => s.iconOverrides)
  const iconColorOverrides = useUiStore((s) => s.iconColorOverrides)
  const provider = useUiStore((s) => s.settings?.engine?.provider)
  return folderLookFrom(
    { iconOverrides, iconColorOverrides, provider: (provider ?? 'claude') as ProviderId },
    relPath,
    name,
    expanded
  )
}

/**
 * Whether icons are drawn at all.
 *
 * Every caller asks this next to asking how something looks, so it lives here
 * rather than in a separate hook nobody remembers exists.
 */
export interface IconVisibility {
  files: boolean
  folders: boolean
}

export function useIconVisibility(): IconVisibility {
  const files = useUiStore((s) => s.showFileIcons)
  const folders = useUiStore((s) => s.showFolderIcons)
  return { files, folders }
}

export function iconVisibility(): IconVisibility {
  const s = useUiStore.getState()
  return { files: s.showFileIcons, folders: s.showFolderIcons }
}

/**
 * The state the answer is drawn from, for a pure helper that wants to keep
 * taking it as an argument and only needs a sensible default.
 */
export function presentationSettings(): Settings {
  return currentSettings()
}

/**
 * The same state, for a component that has to redraw when any of it changes.
 *
 * Subscribed field by field rather than to the whole store, so a row redraws
 * when someone recolours a file and not when an unrelated panel opens — the
 * subscription `useNoteLook` and `useFolderLook` were each making privately.
 */
export function usePresentationSettings(): Settings {
  const iconOverrides = useUiStore((s) => s.iconOverrides)
  const iconColorOverrides = useUiStore((s) => s.iconColorOverrides)
  const provider = useUiStore((s) => s.settings?.engine?.provider)
  return { iconOverrides, iconColorOverrides, provider: (provider ?? 'claude') as ProviderId }
}

/**
 * Just the name, for somewhere that shows one without an icon — a graph
 * label, a tab title. Same rule as the label on a `Look`, so the two cannot
 * drift into disagreeing about what a file is called.
 */
export function displayName(basename: string, title?: string): string {
  return treeDisplayName(basename, title)
}

/**
 * What a folder would look like if nobody had chosen anything for it.
 *
 * For the icon picker's "Default" swatch, which has to preview the answer the
 * person is about to override. Asking with no overrides is the honest way to
 * get it — spelling the default out at the call site is how that swatch came
 * to preview grey for a folder that in fact gets the accent, and the root's
 * own mark had to be remembered in a second place.
 */
export function defaultFolderLook(relPath: string, name: string): Look {
  return folderLookFrom(
    { iconOverrides: {}, iconColorOverrides: {}, provider: 'claude' },
    relPath,
    name
  )
}

/** Re-exported so a caller never needs the low-level module for the default. */
export { defaultFileIcon }
