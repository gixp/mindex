import type { ReactNode } from 'react'
import { Icon } from '@/ui/icon'
import { cn } from '@/ui/cn'

/**
 * One row in the left sidebar, in the one shape they all share.
 *
 * Explorer, Skills and Types each drew their own `.tree-row` with their own
 * chevron and their own indent, which is why they had already drifted: the
 * expanded state showed a guide line under a folder and nothing under a skill.
 * A row is a row — where it appears should not change how it behaves.
 */
export function SidebarRow({
  label,
  icon,
  iconClassName,
  depth = 0,
  active = false,
  expandable = false,
  expanded = false,
  trailing,
  title,
  onClick,
  onIconDoubleClick,
  onContextMenu
}: {
  label: ReactNode
  icon?: string
  iconClassName?: string
  /** Nesting level; each step is the width of one chevron column. */
  depth?: number
  active?: boolean
  /** Draws the chevron column. A row without one still gets its indent. */
  expandable?: boolean
  expanded?: boolean
  trailing?: ReactNode
  title?: string
  onClick?(): void
  onIconDoubleClick?(): void
  onContextMenu?(e: React.MouseEvent): void
}): JSX.Element {
  return (
    <div
      className="tree-row"
      style={{ paddingLeft: `${10 + depth * CHEVRON_COL}px` }}
      data-active={active}
      title={title}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {expandable ? (
        <Icon
          name={expanded ? 'chevron-down' : 'chevron-right'}
          size={12}
          className="shrink-0 text-muted-foreground"
        />
      ) : null}

      {icon ? (
        <span
          onClick={onIconDoubleClick ? (e) => e.stopPropagation() : undefined}
          onDoubleClick={
            onIconDoubleClick
              ? (e) => {
                  e.stopPropagation()
                  onIconDoubleClick()
                }
              : undefined
          }
          title={onIconDoubleClick ? 'Double-click to change icon' : undefined}
          className={cn('shrink-0', onIconDoubleClick && 'cursor-pointer')}
        >
          <Icon name={icon} size={14} className={iconClassName} />
        </span>
      ) : null}

      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing ? <span className="ml-auto flex shrink-0 items-center">{trailing}</span> : null}
    </div>
  )
}

/** Width of the chevron column, and so of one level of indent. */
const CHEVRON_COL = 18

/**
 * The children of an expanded row, with the guide line back to their parent.
 *
 * The line is what makes a deep tree readable — you can follow it up to see
 * what a row belongs to. Skills had none, so an open skill's files floated
 * free of it.
 */
export function SidebarChildren({
  depth = 0,
  children
}: {
  depth?: number
  children: ReactNode
}): JSX.Element {
  return (
    <div
      className="border-l border-border/70"
      style={{ marginLeft: `${15 + depth * CHEVRON_COL}px` }}
    >
      {children}
    </div>
  )
}
