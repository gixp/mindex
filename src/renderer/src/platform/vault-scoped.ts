import { onVaultSettings } from '@/platform/vault-settings'
import { useGraphViewStore } from '@/features/graph/store'

/**
 * Everything that has to follow the open workspace, listed once.
 *
 * Registration is explicit and called at startup rather than done as a side
 * effect of importing each store, because the whole problem being fixed here
 * was hydration that depended on what happened to be loaded: the graph's view
 * settings were applied by the settings store reaching into the graph's, and
 * the file tree's by the tree pane itself — so opening the graph first, or not
 * opening the tree at all, left stale or default values behind.
 *
 * The settings/view store registers itself, since it is imported everywhere
 * regardless. Anything that is not needs a line here.
 *
 * Still to move in: the file tree's sort and hidden-path settings, which the
 * tree pane fetches for itself in a second round trip to the same file.
 */
export function registerVaultScopedStores(): void {
  onVaultSettings((s) => {
    if (s) useGraphViewStore.getState().hydrate(s.graphView)
    else useGraphViewStore.getState().reset()
  })
}
