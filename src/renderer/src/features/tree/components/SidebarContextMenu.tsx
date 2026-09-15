import { useEffect, useRef } from 'react'
import { Icon } from '@/ui/icon'
import { cn } from '@/ui/cn'

/**
 * The right-click menu the sidebar panes share.
 *
 * Lifted out of `TypesPane`, which had it inline, at the point a second pane
 * needed one. A third copy of "position at the pointer, close on outside click
 * or Escape" is how the three quietly stop behaving alike.
 */

export interface SidebarMenuItem {
  label: string
  icon?: string
  destructive?: boolean
  /** Drawn as a rule above this item, for separating destructive actions. */
  separatorBefore?: boolean
  onClick(): void
}

export interface SidebarMenuState {
  x: number
  y: number
}

export function SidebarContextMenu({
  state,
  items,
  onClose
}: {
  state: SidebarMenuState
  items: SidebarMenuItem[]
  onClose(): void
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onMouseDown(e: MouseEvent): void {
      if (ref.current && ref.current.contains(e.target as Node)) return
      onClose()
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // Clamp to the window: a right-click near the bottom edge otherwise opens a
  // menu whose last items cannot be reached.
  const height = items.length * 26 + 8
  const top = Math.min(state.y, Math.max(8, window.innerHeight - height - 8))
  const left = Math.min(state.x, Math.max(8, window.innerWidth - 188))

  return (
    <div
      ref={ref}
      role="menu"
      style={{ position: 'fixed', top, left, zIndex: 50 }}
      className="w-[180px] rounded-[10px] border border-bd-2 bg-bg-2 px-1 py-1 text-[12px] shadow-s2"
    >
      {items.map((item, i) => (
        <div key={i}>
          {item.separatorBefore ? <div className="my-1 h-px bg-border" /> : null}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClose()
              item.onClick()
            }}
            className={cn(
              'flex w-full items-center gap-2 truncate rounded-md px-2.5 py-1 text-left leading-snug transition-colors',
              item.destructive
                ? 'text-red-400 hover:bg-red-500/15 hover:text-red-300'
                : 'text-foreground hover:bg-accent'
            )}
          >
            {item.icon ? <Icon name={item.icon} size={12} className="codicon-inherit" /> : null}
            <span className="truncate">{item.label}</span>
          </button>
        </div>
      ))}
    </div>
  )
}
