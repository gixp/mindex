import { useNotificationsStore } from '@/platform/notifications'
import { PANEL_SURFACE } from '@/ui/surfaces'
import { Icon } from './icon'

/**
 * Bottom-left stack of transient notices. One mount point for the whole app —
 * see `App.tsx` — so any surface can call `pushToast(...)`
 * without rendering anything itself.
 */
export function Toaster(): JSX.Element | null {
  const toasts = useNotificationsStore((s) => s.toasts)
  const dismiss = useNotificationsStore((s) => s.dismissToast)
  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-toast flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          style={PANEL_SURFACE}
          className="pointer-events-auto flex max-w-[360px] items-start gap-2 rounded-10 px-3 py-2.5 text-12.5 text-foreground"
        >
          <Icon name="info" size={13} className="mt-px shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 leading-snug">{t.message}</span>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            title="Dismiss"
            aria-label="Dismiss"
            className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
          >
            <Icon name="close" size={11} />
          </button>
        </div>
      ))}
    </div>
  )
}
