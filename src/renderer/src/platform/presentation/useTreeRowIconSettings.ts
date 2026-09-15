import { useUiStore } from '@/platform/app-settings'

interface TreeRowIconSettings {
  showFileIcons: boolean
  showFolderIcons: boolean
}

/**
 * Mirrors the sidebar tree's "show file/folder icons" row-detail toggle
 * anywhere else icons for the same notes/folders are rendered (tabs, folder
 * cards), so turning icons off in the tree turns them off everywhere.
 *
 * Reads straight from the ui store instead of re-fetching from disk: vault
 * open already awaits `loadVaultUi()` before anything using this hook can
 * mount, so the value here is correct from the first render — no
 * default-then-correct flash — and stays live afterwards since the
 * settings dialog pushes changes into the same store.
 */
export function useTreeRowIconSettings(): TreeRowIconSettings {
  const showFileIcons = useUiStore((s) => s.showFileIcons)
  const showFolderIcons = useUiStore((s) => s.showFolderIcons)
  return { showFileIcons, showFolderIcons }
}
