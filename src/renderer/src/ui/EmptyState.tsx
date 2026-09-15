import { Icon } from './icon'

export function EmptyState({
  icon,
  title,
  hint,
  action
}: {
  icon: string
  title: string
  hint?: string
  /**
   * The one thing to do from here.
   *
   * An empty pane is exactly where a create action is most useful and least
   * findable: there are no rows to right-click and nothing to aim at.
   */
  action?: { label: string; icon?: string; onClick(): void }
}): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center px-4 gap-2">
      <Icon name={icon} size={22} className="text-muted-foreground/40" />
      <div className="text-[12px] text-muted-foreground">{title}</div>
      {hint ? (
        <div className="text-[11px] text-muted-foreground/70 leading-snug">{hint}</div>
      ) : null}
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-1 inline-flex items-center gap-1.5 rounded-[8px] px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-bg-3 hover:text-foreground [&:hover_.codicon]:!text-foreground"
        >
          <Icon name={action.icon ?? 'add'} size={12} className="codicon-inherit" />
          {action.label}
        </button>
      ) : null}
    </div>
  )
}
