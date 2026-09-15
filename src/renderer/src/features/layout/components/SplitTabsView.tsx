import { Fragment, useState } from 'react'
import { createPortal } from 'react-dom'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import type { DropEdge, LayoutNode, LeafGroup } from '@/platform/tab-layout'
import { cn } from '@/ui/cn'
import { TabBar as SharedTabBar, type TabContextItem, type TabItem } from '@/ui/tab-bar'

/**
 * The controls belonging to the open document, kept strictly on one line.
 *
 * Whatever a feature puts here — a mode switch, a comment count, the two
 * buttons a folder view adds — arrives as a fragment with no box of its own,
 * so without this it laid out as inline content and broke onto a second line
 * as soon as the pane was narrow. A second line there pushes the tab strip's
 * own row out of alignment across a split, which is the kind of thing that
 * looks like a rendering fault rather than a squeeze.
 *
 * `shrink-0` keeps the row at its content width, so what gives instead is the
 * tab strip beside it, which already scrolls and truncates for exactly this.
 * The gap lives here too, for the same reason: spacing between the controls is
 * a property of the row, not something each control should carry as a margin
 * and get wrong differently.
 */
const RIGHT_SLOT_ROW = 'flex shrink-0 flex-nowrap items-center gap-2 whitespace-nowrap'

export interface SplitTabsViewProps {
  layout: LayoutNode
  activeGroupId: string
  dragMime: string
  renderTabItem(id: string): TabItem
  renderBody(id: string, visible: boolean): React.ReactNode
  onSelect(id: string): void
  onClose(id: string): void
  onAdd(groupId: string): void
  onRename?(id: string, next: string): void
  onReorder(fromId: string, toId: string): void
  onDrop(tabId: string, targetGroupId: string, edge: DropEdge): void
  onFocusGroup(groupId: string): void
  addLabel?: string
  rightSlot?(groupId: string): React.ReactNode
  contextMenu?(id: string, e?: React.MouseEvent): TabContextItem[]
  wrapTabs?: boolean
  addSpacing?: boolean
  surfaceClassName?: string
  tabRowClassName?: string
  /** Passed straight through to the shared tab bar — see its own doc
   *  comments. */
  inactiveTabClassName?: string
  activeTabClassName?: string
  tabRadiusClassName?: string
  /** Where `rightSlot` renders: beside the tabs in the tab row (default), or
   *  floating over the top-right corner of the body, clear of the tab row. */
  rightSlotPlacement?: 'top' | 'overlay'
  /** When set, the active group's tab row portals into this element (e.g. a
   *  slot in the header) instead of rendering inline. Groups other than the
   *  active one always render their tab row inline — there is only one
   *  portal target, so a split's non-active groups have nowhere else to put
   *  theirs. */
  tabRowPortalTarget?: HTMLElement | null
}

export function SplitTabsView(props: SplitTabsViewProps): JSX.Element {
  return <div className="h-full">{renderNode(props.layout, props)}</div>
}

function renderNode(node: LayoutNode, props: SplitTabsViewProps): JSX.Element {
  if (node.kind === 'leaf') return <TabGroup key={node.id} leaf={node} props={props} />
  const structureKey = `${node.id}:${node.children.map((c) => c.id).join(',')}`
  return (
    <PanelGroup key={structureKey} direction={node.dir === 'row' ? 'horizontal' : 'vertical'}>
      {node.children.map((child, i) => (
        <Fragment key={child.id}>
          {i > 0 ? (
            <PanelResizeHandle
              className={cn(
                'bg-border hover:bg-accent-1/60 transition-colors',
                node.dir === 'row' ? 'w-px' : 'h-px'
              )}
            />
          ) : null}
          <Panel id={child.id} order={i} minSize={12}>
            {renderNode(child, props)}
          </Panel>
        </Fragment>
      ))}
    </PanelGroup>
  )
}

function TabGroup({ leaf, props }: { leaf: LeafGroup; props: SplitTabsViewProps }): JSX.Element {
  const {
    dragMime,
    renderTabItem,
    renderBody,
    onSelect,
    onClose,
    onAdd,
    onRename,
    onReorder,
    onDrop,
    onFocusGroup,
    activeGroupId,
    addLabel,
    rightSlot,
    contextMenu,
    wrapTabs,
    addSpacing,
    surfaceClassName,
    tabRowClassName,
    inactiveTabClassName,
    activeTabClassName,
    tabRadiusClassName,
    rightSlotPlacement = 'top',
    tabRowPortalTarget
  } = props

  const isActiveGroup = activeGroupId === leaf.id
  const usePortalTabRow = isActiveGroup && !!tabRowPortalTarget
  const items: TabItem[] = leaf.tabIds.map((id) => renderTabItem(id))
  const [dropEdge, setDropEdge] = useState<DropEdge | null>(null)

  function edgeFromEvent(e: React.DragEvent): DropEdge {
    const r = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width
    const y = (e.clientY - r.top) / r.height
    const m = 0.22
    if (x < m) return 'left'
    if (x > 1 - m) return 'right'
    if (y < m) return 'top'
    if (y > 1 - m) return 'bottom'
    return 'center'
  }

  function isTabDrag(e: React.DragEvent): boolean {
    return e.dataTransfer.types.includes(dragMime)
  }

  const tabBar = (
    <SharedTabBar
      tabs={items}
      activeId={leaf.activeId}
      onSelect={onSelect}
      onClose={onClose}
      onAdd={() => onAdd(leaf.id)}
      onRename={onRename}
      onReorder={onReorder}
      addLabel={addLabel}
      dragMime={dragMime}
      contextMenu={contextMenu}
      wrap={wrapTabs}
      addSpacing={addSpacing}
      inactiveTabClassName={inactiveTabClassName}
      activeTabClassName={activeTabClassName}
      tabRadiusClassName={tabRadiusClassName}
    />
  )

  const topSlot = rightSlotPlacement === 'top' && rightSlot ? rightSlot(leaf.id) : null
  const overlaySlot = rightSlotPlacement === 'overlay' && rightSlot ? rightSlot(leaf.id) : null

  return (
    <div
      className={cn('flex h-full flex-col', surfaceClassName ?? 'bg-card')}
      onMouseDownCapture={() => {
        if (!isActiveGroup) onFocusGroup(leaf.id)
      }}
    >
      {usePortalTabRow ? (
        createPortal(
          <>
            <div className="min-w-0 flex-1 overflow-hidden">{tabBar}</div>
            {topSlot ? <div className={RIGHT_SLOT_ROW}>{topSlot}</div> : null}
          </>,
          tabRowPortalTarget!
        )
      ) : (
        // The bar holds two things that are not the same kind of thing: the
        // tabs, and whatever controls belong to the open document. They used
        // to share one padded box, so the box's padding was being tuned to
        // whichever was taller — which is where the lopsided bottom padding
        // came from. Each keeps its own padding now, and the tab side's is
        // about tabs.
        <div className={cn('shrink-0 flex gap-1', wrapTabs ? 'items-start' : 'items-center')}>
          <div
            className={cn(
              'flex-1 min-w-0',
              tabRowClassName ?? 'p-2',
              wrapTabs ? '' : 'overflow-hidden'
            )}
          >
            {tabBar}
          </div>
          {/* Same padding as the tab side, so the gap above the controls
              matches the gap to their right instead of being whatever
              centring left over. */}
          {topSlot ? (
            <div className={cn(RIGHT_SLOT_ROW, tabRowClassName ?? 'p-2')}>{topSlot}</div>
          ) : null}
        </div>
      )}
      <div
        className="relative flex-1 min-h-0"
        onDragOver={(e) => {
          if (!isTabDrag(e)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          setDropEdge(edgeFromEvent(e))
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return
          setDropEdge(null)
        }}
        onDrop={(e) => {
          if (!isTabDrag(e)) return
          e.preventDefault()
          const id = e.dataTransfer.getData(dragMime)
          const edge = edgeFromEvent(e)
          setDropEdge(null)
          if (id) onDrop(id, leaf.id, edge)
        }}
      >
        {leaf.tabIds.map((id) => (
          <div
            key={id}
            className={cn('absolute inset-0', id === leaf.activeId ? 'block' : 'hidden')}
          >
            {renderBody(id, id === leaf.activeId)}
          </div>
        ))}
        {dropEdge ? <DropHighlight edge={dropEdge} /> : null}
        {overlaySlot ? (
          <div className="absolute right-2 top-2 z-pane flex items-center gap-1 titlebar-no-drag">
            {overlaySlot}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function DropHighlight({ edge }: { edge: DropEdge }): JSX.Element {
  const pos: Record<DropEdge, string> = {
    left: 'left-0 top-0 bottom-0 w-1/2',
    right: 'right-0 top-0 bottom-0 w-1/2',
    top: 'left-0 right-0 top-0 h-1/2',
    bottom: 'left-0 right-0 bottom-0 h-1/2',
    center: 'inset-0'
  }
  return (
    <div className="pointer-events-none absolute inset-0 z-workspace">
      <div
        className={cn('absolute bg-accent-1/25 border-2 border-accent-1/70 rounded-sm', pos[edge])}
      />
    </div>
  )
}
