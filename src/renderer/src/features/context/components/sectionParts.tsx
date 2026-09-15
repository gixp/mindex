import type { ReactNode } from 'react'
import { Icon } from '@/ui/icon'
import { markdownToHtml } from '@/platform/markdown/markdown'
import { handleWikilinkClick } from '@/platform/markdown/wikilink'
import { cn } from '@/ui/cn'
import { useSlidingIndicator } from '@/ui/sliding-indicator'

// Shared building blocks for every Context-hub section, so the suggestion
// sections added later drop straight into the same visual system instead of
// being designed again from scratch.

export function SectionShell({
  title,
  subtitle,
  actions,
  width = 'wide',
  children
}: {
  /** Omit when a tab strip already names the section. */
  title?: string
  subtitle?: string
  actions?: ReactNode
  /** 'wide' fits three cards per row; 'reading' keeps prose line length sane. */
  width?: 'wide' | 'reading'
  children: ReactNode
}): JSX.Element {
  const hasHeader = !!title || !!subtitle || !!actions
  return (
    <div
      className={cn(
        'mx-auto w-full px-8 py-8',
        width === 'wide' ? 'max-w-[900px]' : 'max-w-[760px]'
      )}
    >
      {hasHeader ? (
        <header className={cn('flex items-start gap-4', title ? 'mb-7' : 'mb-6')}>
          <div className="min-w-0 flex-1">
            {title ? (
              <h1 className="font-heading text-[26px] font-bold tracking-tight text-foreground">
                {title}
              </h1>
            ) : null}
            {subtitle ? (
              <p
                className={cn(
                  'text-[13px] leading-relaxed text-muted-foreground',
                  title ? 'mt-1.5' : ''
                )}
              >
                {subtitle}
              </p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </div>
  )
}

/**
 * Sync state of a folder's context.
 *
 * 'conflict' is reserved for the contradictions analyzer — once that ships it
 * will flag folders whose notes state different facts about the same thing,
 * which outranks staleness.
 */
export type ContextSyncState = 'synced' | 'stale' | 'conflict'

const SYNC_META: Record<
  ContextSyncState,
  { icon: string; tint: string; shell: string; title: string }
> = {
  synced: {
    icon: 'check',
    tint: 'codicon-emerald',
    shell: 'border-emerald-500/25 bg-emerald-500/10',
    title: 'In sync — the summary matches the notes'
  },
  stale: {
    icon: 'sync',
    tint: 'codicon-amber',
    shell: 'border-amber-500/25 bg-amber-500/10',
    title: 'Out of sync — notes changed after this summary was written'
  },
  conflict: {
    icon: 'warning',
    tint: 'codicon-red',
    shell: 'border-red-500/25 bg-red-500/10',
    title: 'Conflicting facts found between notes in this folder'
  }
}

/**
 * Round icon-only sync badge, built on the same border + 10%-tint recipe as
 * the app's text badges so it reads as one of them rather than a loose glyph.
 * Codicons are forced grey globally, so colour comes from codicon-* helpers.
 */
export function SyncBadge({ state }: { state: ContextSyncState }): JSX.Element {
  const meta = SYNC_META[state]
  return (
    <span
      title={meta.title}
      aria-label={meta.title}
      className={cn(
        'inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border',
        meta.shell
      )}
    >
      <Icon name={meta.icon} size={11} className={meta.tint} />
    </span>
  )
}

/** Small chip for a single metric. Render nothing rather than a placeholder. */
export function MetaBadge({ children }: { children: ReactNode }): JSX.Element {
  return (
    <span className="inline-flex items-center rounded-[5px] bg-bg-3 px-1.5 py-[2px] text-[9px] tabular-nums text-muted-foreground">
      {children}
    </span>
  )
}

export interface SegmentedTab {
  id: string
  label: string
  icon?: string
}

/**
 * Segmented switcher with a sliding highlight.
 *
 * The measuring is shared — see `ui/sliding-indicator`. What is not shared is
 * the look: this marks the choice with a fill, Settings marks it with an
 * outline, and that difference is deliberate.
 */
export function SegmentedTabs({
  tabs,
  active,
  onSelect
}: {
  tabs: SegmentedTab[]
  active: string
  onSelect(id: string): void
}): JSX.Element {
  const { refFor, indicator } = useSlidingIndicator(active, tabs.length)

  return (
    <div className="relative inline-flex rounded-[10px] bg-background p-0.5">
      {indicator ? (
        <div
          className="absolute bottom-0.5 left-0 top-0.5 rounded-[8px] bg-accent transition-[transform,width] duration-200 ease-out"
          style={{ transform: `translateX(${indicator.left}px)`, width: indicator.width }}
        />
      ) : null}
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          ref={refFor(t.id)}
          onClick={() => onSelect(t.id)}
          className={cn(
            'relative z-pane inline-flex items-center gap-1 rounded-[8px] px-3 py-1 text-[12px] transition-colors',
            active === t.id
              ? 'text-accent-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {t.icon ? <Icon name={t.icon} size={13} /> : null}
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function GroupHeader({
  label,
  count,
  hint
}: {
  label: string
  count?: number
  hint?: string
}): JSX.Element {
  return (
    <div className="mb-2 flex items-baseline gap-2">
      <span className="text-[11px] font-medium text-foreground">{label}</span>
      {hint ? <span className="text-[9px] text-muted-foreground/70">{hint}</span> : null}
      {typeof count === 'number' ? (
        <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">{count}</span>
      ) : null}
    </div>
  )
}

/** Auto-fitting card grid — same idiom as the editor's Recent files grid. */
export function CardGrid({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div
      className="grid gap-2.5"
      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))' }}
    >
      {children}
    </div>
  )
}

export interface MetaItem {
  label: string
  value: string
}

/** Metadata grid, matching the frontmatter table used in the transcribe dialog. */
export function MetaGrid({ items }: { items: MetaItem[] }): JSX.Element {
  return (
    <div className="grid grid-cols-4 gap-x-4 gap-y-2.5 border-y border-border py-3.5">
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {it.label}
          </div>
          <div className="mt-0.5 truncate font-mono text-[12px] text-c-1">{it.value}</div>
        </div>
      ))}
    </div>
  )
}

/**
 * Renders a CLAUDE.md section body. `.chat-bubble` is required — the wikilink
 * styles in globals.css are scoped to it (and to .ProseMirror), and it also
 * makes [[links]] clickable through the shared handler.
 */
export function Prose({ text }: { text: string }): JSX.Element {
  const trimmed = text.trim()
  if (!trimmed) {
    return <div className="text-[11px] italic text-muted-foreground/60">Not filled in.</div>
  }
  return (
    <div
      className="chat-bubble text-[13px] leading-relaxed text-c-1 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
      onClick={(e) => {
        if (handleWikilinkClick(e.target)) e.preventDefault()
      }}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: markdownToHtml(trimmed) }}
    />
  )
}

/** Titled card used for each prose section of a CLAUDE.md. */
export function ProseCard({
  icon,
  title,
  children
}: {
  icon: string
  title: string
  children: ReactNode
}): JSX.Element {
  return (
    <section className="overflow-hidden rounded-[15px] bg-background/50 shadow-[inset_0_0_0_1px_hsl(var(--border)/0.8)]">
      <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5">
        <Icon name={icon} size={13} className="codicon-orange" />
        <h3 className="text-[11px] font-medium text-c-1">{title}</h3>
      </div>
      <div className="px-4 py-3.5">{children}</div>
    </section>
  )
}

export function Breadcrumb({
  rootLabel,
  current,
  onBack,
  actions
}: {
  rootLabel: string
  current: string
  onBack(): void
  actions?: ReactNode
}): JSX.Element {
  return (
    <div className="mb-6 flex items-center gap-1.5">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex h-7 items-center gap-1 rounded-[8px] px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
      >
        <Icon name="arrow-left" size={12} />
        {rootLabel}
      </button>
      <Icon name="chevron-right" size={10} />
      <span className="min-w-0 truncate text-[11px] text-foreground">{current}</span>
      {actions ? <div className="ml-auto flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </div>
  )
}

export function SmallButton({
  icon,
  children,
  onClick,
  disabled,
  tone = 'primary'
}: {
  icon?: string
  children: ReactNode
  onClick(): void
  disabled?: boolean
  tone?: 'default' | 'primary' | 'accent'
}): JSX.Element {
  const shell = {
    primary: 'border-accent2/30 bg-accent2/[0.09] text-accent2 hover:bg-accent2/15',
    accent: 'border-amber-500/30 bg-amber-500/[0.08] text-amber-200 hover:bg-amber-500/15',
    default: 'border-border text-foreground hover:bg-bg-3'
  }[tone]
  const tint = { primary: 'codicon-orange', accent: 'codicon-amber', default: '' }[tone]
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[8px] border px-2.5 py-1 text-[11px] font-medium transition duration-200 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-accent2/60 disabled:opacity-50',
        shell
      )}
    >
      {icon ? <Icon name={icon} size={12} className={tint} /> : null}
      {children}
    </button>
  )
}

/**
 * Primary action. Codicons are forced grey globally, so the icon needs an
 * explicit override to match the label — the button's own
 * `[&_.codicon]:!text-white` below is that override, fixed white to match
 * `bg-accent2`'s fixed brand colour rather than the theme.
 */
export function PrimaryButton({
  icon,
  children,
  onClick,
  disabled,
  size = 'md'
}: {
  icon?: string
  children: ReactNode
  onClick(): void
  disabled?: boolean
  size?: 'sm' | 'md'
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[8px] bg-accent2 font-medium text-white',
        'transition duration-200 hover:brightness-105 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-accent2/60 disabled:opacity-50',
        '[&_.codicon]:!text-white [&_.codicon::before]:!text-white',
        size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-[11px]'
      )}
    >
      {/* No colour class here: the button's own `[&_.codicon]:!text-white`
          above already covers it — `codicon-white` tracks `--foreground`, so
          stacking it on top would have raced that fixed-white rule on
          specificity in every future stylesheet reorder. */}
      {icon ? <Icon name={icon} size={size === 'sm' ? 11 : 12} /> : null}
      {children}
    </button>
  )
}

export function fmtInt(n: number): string {
  return n.toLocaleString('en-US')
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export function fmtAge(ts?: number | string): string {
  if (ts === undefined) return '—'
  const ms = typeof ts === 'string' ? Date.parse(ts) : ts
  if (!Number.isFinite(ms)) return '—'
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return `${Math.floor(days / 30)}mo ago`
}
