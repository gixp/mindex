import { create } from 'zustand'
import { api } from '@/platform/api'
import { useVaultStore } from '@/platform/workspace'
import type { TreeSort, TreeGroup } from '@/platform/presentation/tree'

interface TreeSortState {
  sortBy: TreeSort
  group: TreeGroup
  setSortBy(v: TreeSort): void
  setGroup(v: TreeGroup): void
  reset(): void
}

// Shared by the sidebar tree and the center-panel folder grid, so "sort by"
// and "group by" stay a single vault-scoped setting instead of two
// independent controls that could drift apart.
export const useTreeSortStore = create<TreeSortState>((set) => ({
  sortBy: 'name-asc',
  group: 'folders-first',

  setSortBy(v) {
    set({ sortBy: v })
    if (useVaultStore.getState().vault?.root) void api().settings.setVault({ treeSort: v })
  },

  setGroup(v) {
    set({ group: v })
    if (useVaultStore.getState().vault?.root) void api().settings.setVault({ treeGroup: v })
  },

  reset() {
    set({ sortBy: 'name-asc', group: 'folders-first' })
  }
}))
