import { EngineLogDialog } from './EngineLogDialog'
import { useUiStore } from '@/platform/app-settings'

/** Lived in the window's root, purely because that is where it was mounted. */
export function EngineLogDialogConnected(): JSX.Element {
  const open = useUiStore((s) => s.engineLogOpen)
  const setOpen = useUiStore((s) => s.setEngineLogOpen)
  return <EngineLogDialog open={open} onOpenChange={setOpen} />
}
