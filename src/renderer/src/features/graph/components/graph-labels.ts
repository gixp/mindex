import type { GraphNode } from '@shared/graph'
import { displayName } from '@/platform/presentation'

/**
 * What a node is called — character for character what the tree row says.
 *
 * The graph used to build its own label (title, or the basename with `.md`
 * stripped), which is close enough to be wrong: the shared name gives a
 * managed file its label ("Context"), turns `.some-dotfile.md` into
 * "Some Dotfile", and — the case that actually bites — strips the extension
 * ONLY for extensions it has an icon for. A `.canvas` file keeps its
 * extension in the tree, so it has to keep it here.
 *
 * The one place the tree overrides all of that is a hidden row, which shows
 * the full relative path instead of a name, so that a file you have revealed
 * is identifiable rather than just present.
 */
export function graphNodeLabel(node: GraphNode, hidden: ReadonlySet<string>): string {
  if (node.kind === 'folder') return node.name
  if (hidden.has(node.id)) return node.relPath
  return displayName(node.name, node.title)
}
