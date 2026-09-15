export interface LeafGroup {
  kind: 'leaf'
  id: string
  tabIds: string[]
  activeId: string
}

export interface SplitGroup {
  kind: 'split'
  id: string
  dir: 'row' | 'col'
  children: LayoutNode[]
}

export type LayoutNode = LeafGroup | SplitGroup

export type DropEdge = 'left' | 'right' | 'top' | 'bottom' | 'center'

function genId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `grp-${Math.random().toString(36).slice(2)}`
}

export function makeLeaf(tabIds: string[], activeId?: string): LeafGroup {
  return {
    kind: 'leaf',
    id: genId(),
    tabIds,
    activeId: activeId ?? tabIds[0] ?? ''
  }
}

export function allLeaves(node: LayoutNode): LeafGroup[] {
  if (node.kind === 'leaf') return [node]
  return node.children.flatMap(allLeaves)
}

export function allTabIds(node: LayoutNode): string[] {
  return allLeaves(node).flatMap((l) => l.tabIds)
}

export function firstLeaf(node: LayoutNode): LeafGroup {
  return allLeaves(node)[0]!
}

export function findLeafByTab(node: LayoutNode, tabId: string): LeafGroup | undefined {
  return allLeaves(node).find((l) => l.tabIds.includes(tabId))
}

export function findGroup(node: LayoutNode, groupId: string): LeafGroup | undefined {
  return allLeaves(node).find((l) => l.id === groupId)
}

function mapLeaves(node: LayoutNode, fn: (l: LeafGroup) => LeafGroup): LayoutNode {
  if (node.kind === 'leaf') return fn(node)
  return { ...node, children: node.children.map((c) => mapLeaves(c, fn)) }
}

function prune(node: LayoutNode): LayoutNode | null {
  if (node.kind === 'leaf') return node.tabIds.length > 0 ? node : null
  const kept = node.children.map(prune).filter((c): c is LayoutNode => c !== null)
  if (kept.length === 0) return null
  if (kept.length === 1) return kept[0]!
  const flat: LayoutNode[] = []
  for (const c of kept) {
    if (c.kind === 'split' && c.dir === node.dir) flat.push(...c.children)
    else flat.push(c)
  }
  return { ...node, children: flat }
}

export function removeTab(node: LayoutNode, tabId: string): LayoutNode | null {
  const mapped = mapLeaves(node, (leaf) => {
    if (!leaf.tabIds.includes(tabId)) return leaf
    const idx = leaf.tabIds.indexOf(tabId)
    const tabIds = leaf.tabIds.filter((id) => id !== tabId)
    let activeId = leaf.activeId
    if (activeId === tabId) activeId = tabIds[idx] ?? tabIds[idx - 1] ?? tabIds[0] ?? ''
    return { ...leaf, tabIds, activeId }
  })
  return prune(mapped)
}

/**
 * A view of the tree with only the tabs `keep` accepts — for the right
 * sidebar's Chat UI / CLI split, where the stored layout holds both kinds of
 * tab but only one kind is ever on screen at once.
 *
 * Purely a render-time projection: never write the result back over `layout`.
 * The tabs `keep` rejects are not gone, just filtered out of this one view of
 * the tree — switching the view back re-derives them from the same
 * untouched, still-current `layout`.
 */
export function filterLayout(
  node: LayoutNode,
  keep: (tabId: string) => boolean
): LayoutNode | null {
  const mapped = mapLeaves(node, (leaf) => {
    const tabIds = leaf.tabIds.filter(keep)
    const activeId = tabIds.includes(leaf.activeId) ? leaf.activeId : (tabIds[0] ?? '')
    return { ...leaf, tabIds, activeId }
  })
  return prune(mapped)
}

export function insertTab(node: LayoutNode, groupId: string, tabId: string): LayoutNode {
  return mapLeaves(node, (leaf) => {
    if (leaf.id !== groupId) return leaf
    const tabIds = leaf.tabIds.includes(tabId) ? leaf.tabIds : [...leaf.tabIds, tabId]
    return { ...leaf, tabIds, activeId: tabId }
  })
}

export function replaceTabInGroup(
  node: LayoutNode,
  groupId: string,
  oldId: string,
  newId: string
): LayoutNode {
  return mapLeaves(node, (leaf) => {
    if (leaf.id !== groupId || !leaf.tabIds.includes(oldId)) return leaf
    return {
      ...leaf,
      tabIds: leaf.tabIds.map((id) => (id === oldId ? newId : id)),
      activeId: leaf.activeId === oldId ? newId : leaf.activeId
    }
  })
}

export function setActive(node: LayoutNode, groupId: string, tabId: string): LayoutNode {
  return mapLeaves(node, (leaf) =>
    leaf.id === groupId && leaf.tabIds.includes(tabId) ? { ...leaf, activeId: tabId } : leaf
  )
}

export function reorderInGroup(
  node: LayoutNode,
  groupId: string,
  fromId: string,
  toId: string
): LayoutNode {
  return mapLeaves(node, (leaf) => {
    if (leaf.id !== groupId) return leaf
    const from = leaf.tabIds.indexOf(fromId)
    const to = leaf.tabIds.indexOf(toId)
    if (from === -1 || to === -1 || from === to) return leaf
    const tabIds = leaf.tabIds.slice()
    const [moved] = tabIds.splice(from, 1)
    tabIds.splice(to, 0, moved!)
    return { ...leaf, tabIds }
  })
}

function splitAt(
  node: LayoutNode,
  targetGroupId: string,
  edge: Exclude<DropEdge, 'center'>,
  newLeaf: LeafGroup
): LayoutNode {
  const dir: SplitGroup['dir'] = edge === 'left' || edge === 'right' ? 'row' : 'col'
  const before = edge === 'left' || edge === 'top'
  function rec(n: LayoutNode): LayoutNode {
    if (n.kind === 'leaf') {
      if (n.id !== targetGroupId) return n
      const children = before ? [newLeaf, n] : [n, newLeaf]
      return { kind: 'split', id: genId(), dir, children }
    }
    return { ...n, children: n.children.map(rec) }
  }
  return prune(rec(node)) ?? node
}

export function dropTab(
  node: LayoutNode,
  tabId: string,
  targetGroupId: string,
  edge: DropEdge
): { tree: LayoutNode; groupId: string } {
  const sourceLeaf = findLeafByTab(node, tabId)

  if (edge === 'center') {
    if (sourceLeaf?.id === targetGroupId) return { tree: node, groupId: targetGroupId }
    const removed = removeTab(node, tabId)
    if (!removed) return { tree: node, groupId: targetGroupId }
    return { tree: insertTab(removed, targetGroupId, tabId), groupId: targetGroupId }
  }

  if (sourceLeaf?.id === targetGroupId && sourceLeaf.tabIds.length <= 1) {
    return { tree: node, groupId: targetGroupId }
  }

  const removed = removeTab(node, tabId)
  if (!removed) return { tree: node, groupId: targetGroupId }
  const newLeaf = makeLeaf([tabId], tabId)
  return {
    tree: splitAt(removed, targetGroupId, edge, newLeaf),
    groupId: newLeaf.id
  }
}
