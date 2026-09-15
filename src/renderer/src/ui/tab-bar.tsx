import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './icon'
import { cn } from '@/ui/cn'

export interface TabItem {
  id: string
  title: string
  leading?: React.ReactNode
  unclosable?: boolean
  tooltip?: string
  compact?: boolean
  className?: string
  iconOnly?: boolean
  brand?: boolean
  pinned?: boolean
}

export interface TabContextItem {
  label: string
  icon?: string
  destructive?: boolean
  onClick(): void
}

export const TAB_DRAG_MIME = 'application/x-mindex-tab'

interface TabBarProps {
  tabs: TabItem[]
  activeId: string | null
  onSelect(id: string): void
  onClose?(id: string): void
  onAdd?(): void
  onRename?(id: string, next: string): void
  onReorder?(fromId: string, toId: string): void
  contextMenu?(id: string, e?: React.MouseEvent): TabContextItem[]
  className?: string
  addLabel?: string
  addIcon?: string
  addIconClassName?: string
  addText?: string
  rightSlot?: React.ReactNode
  dragMime?: string
  wrap?: boolean
  addSpacing?: boolean
  /** Resting background for an inactive tab. Defaults to a subtle grey tint;
   *  overridden where a tab bar sits over a surface that grey tint doesn't
   *  read against (e.g. the header, where tabs should match the right
   *  sidebar's own card background instead). */
  inactiveTabClassName?: string
  /** Background for the active tab. Defaults to `bg-accent`; overridden
   *  alongside `inactiveTabClassName` where the active and inactive tabs
   *  should read as the same surface rather than a highlighted one. */
  activeTabClassName?: string
  /** Corner radius for a tab pill. Defaults to `rounded-r3`. */
  tabRadiusClassName?: string
}

interface MenuState {
  tabId: string
  x: number
  y: number
  items: TabContextItem[]
}

export function TabBar({
  tabs,
  activeId,
  onSelect,
  onClose,
  onAdd,
  onRename,
  onReorder,
  contextMenu,
  className,
  addLabel = 'Add tab',
  addIcon = 'add',
  addIconClassName,
  addText,
  rightSlot,
  dragMime = TAB_DRAG_MIME,
  wrap = false,
  addSpacing = false,
  inactiveTabClassName,
  activeTabClassName,
  tabRadiusClassName
}: TabBarProps): JSX.Element {
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [overflow, setOverflow] = useState({ left: false, right: false })

  useEffect(() => {
    if (!menu) return
    function onMouseDown(e: MouseEvent): void {
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return
      setMenu(null)
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setMenu(null)
    }
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingId])

  const updateOverflow = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const { scrollLeft, scrollWidth, clientWidth } = el
    setOverflow({
      left: scrollLeft > 1,
      right: scrollLeft + clientWidth < scrollWidth - 1
    })
  }, [])

  useEffect(() => {
    updateOverflow()
    const el = scrollRef.current
    if (!el) return
    el.addEventListener('scroll', updateOverflow, { passive: true })
    const ro = new ResizeObserver(updateOverflow)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', updateOverflow)
      ro.disconnect()
    }
  }, [updateOverflow, tabs.length])

  function scrollByDir(dir: -1 | 1): void {
    scrollRef.current?.scrollBy({ left: dir * 220, behavior: 'smooth' })
  }

  function startRename(t: TabItem): void {
    if (!onRename) return
    setRenameValue(t.title)
    setRenamingId(t.id)
  }

  function commitRename(): void {
    if (!renamingId) return
    const id = renamingId
    setRenamingId(null)
    if (renameValue.trim()) onRename?.(id, renameValue.trim())
  }

  return (
    <div className={cn('flex w-full min-w-0', wrap ? 'items-start' : 'items-center', className)}>
      {!wrap && overflow.left ? (
        <button
          type="button"
          onClick={() => scrollByDir(-1)}
          title="Scroll tabs left"
          aria-label="Scroll tabs left"
          className="shrink-0 inline-flex items-center justify-center h-7 w-5 rounded-md text-muted-foreground hover:text-foreground hover:bg-bg-3"
        >
          <Icon name="chevron-left" size={14} />
        </button>
      ) : null}

      <div
        ref={scrollRef}
        // The element that actually overflows, so `scrollWidth` here is the
        // width the tabs really want. The wrapper outside it is stretched by
        // flex, which makes its scrollWidth merely its own size.
        data-tab-scroller=""
        onWheel={(e) => {
          const el = scrollRef.current
          if (!el) return
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
            el.scrollLeft += e.deltaY
          }
        }}
        className={cn(
          'flex items-center gap-1 min-w-0 flex-1',
          wrap
            ? 'flex-wrap py-1'
            : 'overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
        )}
      >
        {tabs.map((t) => {
          const isActive = t.id === activeId
          const isRenaming = renamingId === t.id
          const canDrag = !!onReorder && !t.pinned && !isRenaming
          const isDropTarget = dropTargetId === t.id && dragId !== null && dragId !== t.id
          return (
            <div
              key={t.id}
              data-active={isActive}
              draggable={canDrag}
              onDragStart={(e) => {
                if (!canDrag) return
                setDragId(t.id)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData(dragMime, t.id)
              }}
              onDragOver={(e) => {
                if (!onReorder || dragId === null || t.pinned) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                if (dropTargetId !== t.id) setDropTargetId(t.id)
              }}
              onDragLeave={() => {
                if (dropTargetId === t.id) setDropTargetId(null)
              }}
              onDrop={(e) => {
                if (!onReorder || t.pinned) return
                e.preventDefault()
                const from = e.dataTransfer.getData(dragMime) || dragId
                setDragId(null)
                setDropTargetId(null)
                if (from && from !== t.id) onReorder(from, t.id)
              }}
              onDragEnd={() => {
                setDragId(null)
                setDropTargetId(null)
              }}
              onClick={() => {
                if (isRenaming) return
                onSelect(t.id)
              }}
              onDoubleClick={() => startRename(t)}
              onContextMenu={(e) => {
                e.preventDefault()
                if (isRenaming || !contextMenu) return
                onSelect(t.id)
                const items = contextMenu(t.id, e)
                if (items.length === 0) return
                setMenu({ tabId: t.id, x: e.clientX, y: e.clientY, items })
              }}
              onMouseDown={(e) => {
                if (isRenaming) return
                if (e.button === 1 && onClose && !t.unclosable) {
                  e.preventDefault()
                  onClose(t.id)
                }
              }}
              className={cn(
                'group inline-flex items-center h-7 select-none text-xs transition-colors',
                tabRadiusClassName ?? 'rounded-r3',
                t.compact ? 'gap-1 pl-2 pr-1.5' : 'gap-1.5 pl-2.5 pr-1.5',
                isRenaming ? 'cursor-text' : 'cursor-pointer',
                t.brand
                  ? // Pinned brand chip — accent styling, fixed first tab.
                    cn(
                      'shrink-0 px-2.5 font-semibold tracking-tight bg-transparent',
                      isActive
                        ? 'bg-accent text-foreground'
                        : 'bg-bg-3 text-foreground hover:bg-bg-4'
                    )
                  : isActive
                    ? cn(
                        'shrink-0 max-w-[220px] text-foreground',
                        activeTabClassName ?? 'bg-accent'
                      )
                    : // Inactive tabs now carry a resting background so every
                      cn(
                        'shrink-0 max-w-[140px] text-muted-foreground hover:text-foreground',
                        inactiveTabClassName ?? 'bg-bg-3 hover:bg-bg-4'
                      ),
                isDropTarget ? 'ring-1 ring-accent-foreground/40' : '',
                dragId === t.id ? 'opacity-50' : '',
                t.className
              )}
              title={t.tooltip ?? t.title}
            >
              {t.leading ? (
                <span className="shrink-0 inline-flex items-center self-center">{t.leading}</span>
              ) : null}
              {isRenaming ? (
                <input
                  ref={renameInputRef}
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      commitRename()
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      setRenamingId(null)
                    }
                  }}
                  onBlur={commitRename}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="flex-1 min-w-0 bg-transparent border-none outline-none text-xs text-foreground"
                />
              ) : t.iconOnly ? (
                <span className="sr-only">{t.title}</span>
              ) : isActive && !t.brand ? (
                <span className="min-w-0 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {t.title}
                </span>
              ) : (
                <span className="truncate">{t.title}</span>
              )}
              {onClose && !t.unclosable ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onClose(t.id)
                  }}
                  title="Close tab"
                  aria-label="Close tab"
                  className="shrink-0 inline-flex items-center justify-center h-3 w-3 transition-colors [&:hover_.codicon]:!text-foreground [&:hover_.codicon::before]:!text-foreground"
                >
                  <Icon name="close" size={12} />
                </button>
              ) : null}
            </div>
          )
        })}
        {onAdd ? (
          <button
            type="button"
            onClick={onAdd}
            title={addLabel}
            aria-label={addLabel}
            className={cn(
              'shrink-0 inline-flex items-center justify-center text-muted-foreground transition-colors hover:text-foreground [&:hover_.codicon]:!text-foreground [&:hover_.codicon::before]:!text-foreground',
              // Icon-only: sized to the close button inside a tab, so the two
              // glyphs in the strip match instead of the + sitting a size up.
              // The text variant keeps the taller box — it needs the padding.
              addText ? 'h-7 px-2 text-[11px]' : 'h-3 w-3',
              addSpacing ? 'ml-1.5' : ''
            )}
          >
            {addText ? (
              <span>{addText}</span>
            ) : (
              <Icon name={addIcon} size={12} className={addIconClassName} />
            )}
          </button>
        ) : null}
      </div>

      {!wrap && overflow.right ? (
        <button
          type="button"
          onClick={() => scrollByDir(1)}
          title="Scroll tabs right"
          aria-label="Scroll tabs right"
          className="shrink-0 inline-flex items-center justify-center h-7 w-5 rounded-md text-muted-foreground hover:text-foreground hover:bg-bg-3"
        >
          <Icon name="chevron-right" size={14} />
        </button>
      ) : null}

      {rightSlot ? <div className="ml-1 shrink-0">{rightSlot}</div> : null}

      {menu
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              data-mindex-floating="true"
              style={{ position: 'fixed', top: menu.y, left: menu.x, zIndex: 100 }}
              className="w-max min-w-[220px] rounded-lg border border-bd-2 bg-bg-2 shadow-s2 py-1.5 text-[13px] whitespace-nowrap"
            >
              {menu.items.map((item, i) => (
                <button
                  key={i}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenu(null)
                    item.onClick()
                  }}
                  className={cn(
                    'w-full text-left px-4 py-1.5 leading-snug inline-flex items-center gap-2 transition-colors [&:hover_.codicon]:!text-foreground [&:hover_.codicon::before]:!text-foreground',
                    item.destructive
                      ? 'text-red-400 hover:text-red-300 hover:bg-red-500/10'
                      : 'text-foreground hover:bg-bg-3'
                  )}
                >
                  {item.icon ? <Icon name={item.icon} size={12} /> : null}
                  <span>{item.label}</span>
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </div>
  )
}
