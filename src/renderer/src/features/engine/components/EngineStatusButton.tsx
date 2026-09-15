import { useUiStore } from '@/platform/app-settings'
import { useJobsStore } from '@/features/engine/store'
import { Icon } from '@/ui/icon'
import { cn } from '@/ui/cn'

/** Claude engine indicator — opens the engine log. */
export function EngineStatusButton(): JSX.Element {
  const openEngineLog = useUiStore((s) => s.setEngineLogOpen)
  const activeCount = useJobsStore((s) => s.activeCount)
  const pendingCount = useJobsStore((s) => s.pendingCount)
  const paused = useJobsStore((s) => s.paused)

  const title = paused
    ? 'Engine paused'
    : activeCount > 0
      ? `Engine — ${activeCount} running`
      : pendingCount > 0
        ? `Engine — ${pendingCount} queued`
        : 'Engine idle'

  return (
    <button
      type="button"
      onClick={() => openEngineLog(true)}
      title={title}
      aria-label={title}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded hover:bg-bg-3',
        activeCount > 0 ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
      )}
    >
      {/* Never tinted: engine state is reported by the status badge beside it,
          so colouring here as well said the same thing twice. */}
      <Icon name="vm-running" size={14} />
    </button>
  )
}
