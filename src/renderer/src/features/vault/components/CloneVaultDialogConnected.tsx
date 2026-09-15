import { CloneVaultDialog } from './CloneVaultDialog'
import { useUiStore } from '@/platform/app-settings'

/** Lived in the window's root, purely because that is where it was mounted. */
export function CloneVaultDialogConnected(): JSX.Element {
  const open = useUiStore((s) => s.cloneVaultOpen)
  const setOpen = useUiStore((s) => s.setCloneVaultOpen)
  return <CloneVaultDialog open={open} onOpenChange={setOpen} />
}
