import { Icon } from './icon'
import { cn } from '@/ui/cn'

/**
 * What every "this needs an assistant" surface shows instead of its normal
 * content, not on top of it — the composer's own version of this idea
 * (`ChatInputBar`) already established that a dimmed control offering choices
 * that go nowhere is worse than stating plainly that there is nothing to
 * choose yet. This is that same idea, shared, for the handful of places that
 * are not the composer: the right panel, the AI settings cards, the
 * right-sidebar view picker, the Auto Context dialog.
 *
 * `onAction` is optional on purpose. Inside Settings' own AI section the
 * Provider card that fixes this is already on screen, right above — a button
 * that opens Settings would be pointless there. Everywhere else, it is the
 * one useful thing to offer.
 */
export function ProviderRequiredNotice({
  message,
  actionLabel,
  onAction,
  className
}: {
  message: string
  actionLabel?: string
  onAction?: () => void
  className?: string
}): JSX.Element {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 text-center', className)}>
      <Icon name="plug" size={28} className="text-muted-foreground" />
      <p className="max-w-[260px] text-13 leading-snug text-muted-foreground">{message}</p>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="mt-1 inline-flex items-center gap-1.5 rounded-10 bg-accent-1 px-3.5 py-1.5 text-12.5 font-medium text-white transition-colors hover:bg-accent-1/90 [&_.codicon::before]:!text-white"
        >
          <Icon name="settings-gear" size={13} />
          {actionLabel}
        </button>
      ) : null}
    </div>
  )
}
