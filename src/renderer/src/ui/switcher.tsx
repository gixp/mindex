import { cn } from '@/ui/cn'

export interface SwitcherOption<T extends string> {
  key: T
  label: string
  count: number
  /** Optional colored dot before the label — used where the option itself
   *  carries a status color (Auto Context's behind/running/done/disabled).
   *  A Tailwind background class, e.g. `bg-amber-400`. */
  dot?: string
  hint?: string
}

/**
 * The "fixed set of views, switch between them, nothing to create or close"
 * chip strip — a different family from the tab bar (`tab-bar.tsx`), which
 * creates and closes tabs. This is Auto Context's behind/running/done/
 * disabled buckets, Source Control's staged/changes/untracked/conflicted
 * buckets, and Link Health's dead-links/orphans split — three call sites
 * that had converged on (two of them, byte-for-byte) the same visual
 * language already: `h-7`, `rounded-[8px]`, `text-[11px]`,
 * a faint resting fill lifting to a stronger one when active. This
 * component is that language, named once.
 *
 * Renders just the buttons, not a wrapping row — every existing call site
 * sits inside a `flex` row that also holds a trailing action (Stage all,
 * Update N…), so the caller keeps that wrapper and drops this in.
 */
export function Switcher<T extends string>({
  options,
  active,
  onChange
}: {
  options: SwitcherOption<T>[]
  active: T
  onChange(key: T): void
}): JSX.Element {
  return (
    <>
      {options.map((opt) => (
        <button
          key={opt.key}
          type="button"
          aria-pressed={active === opt.key}
          onClick={() => onChange(opt.key)}
          title={opt.hint}
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-8 px-2.5 text-11 transition-colors',
            active === opt.key
              ? 'bg-bg-3 text-foreground'
              : 'bg-bg-2 text-muted-foreground hover:bg-bg-3 hover:text-foreground'
          )}
        >
          {opt.dot ? (
            <span className={cn('inline-block size-1.5 shrink-0 rounded-full', opt.dot)} />
          ) : null}
          {opt.label}
          <span className="tabular-nums opacity-70">{opt.count}</span>
        </button>
      ))}
    </>
  )
}
