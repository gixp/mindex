import { useEffect, useRef } from 'react'
import { Icon } from '@/ui/icon'
import { cn } from '@/ui/cn'
import { useUiStore } from '@/platform/app-settings'

export interface MentionItem {
  value: string
  label: string
  sub?: string
  icon?: string
  iconKind?: 'file' | 'command'
}

interface Props {
  items: MentionItem[]
  activeIndex: number
  onPick(index: number): void
  onHover(index: number): void
}

export function MentionPopover({ items, activeIndex, onPick, onHover }: Props): JSX.Element | null {
  const listRef = useRef<HTMLDivElement>(null)
  const showFileIcons = useUiStore((s) => s.showFileIcons)

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  if (items.length === 0) return null
  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-0 right-0 mb-1 z-docked max-h-60 overflow-y-auto rounded-lg border border-bd-2 bg-bg-2 py-1 shadow-s2"
    >
      {items.map((item, i) => (
        <button
          key={`${item.value}-${i}`}
          type="button"
          data-idx={i}
          onMouseDown={(e) => {
            e.preventDefault()
            onPick(i)
          }}
          onMouseEnter={() => onHover(i)}
          className={cn(
            'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px]',
            i === activeIndex ? 'bg-bg-3 text-foreground' : 'text-muted-foreground'
          )}
        >
          {item.icon && (item.iconKind !== 'file' || showFileIcons) ? (
            <Icon name={item.icon} size={13} className="shrink-0 text-muted-foreground" />
          ) : null}
          <span className="shrink-0 truncate max-w-[45%] text-foreground">{item.label}</span>
          {item.sub ? (
            <span className="min-w-0 flex-1 truncate text-muted-foreground/80">{item.sub}</span>
          ) : null}
        </button>
      ))}
    </div>
  )
}
