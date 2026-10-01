import type { NoteMeta } from '@shared/types'
import { isManagedOrSidecarFilename } from '@shared/managed-files'
import { isContextFilename } from '@shared/context-filename'

export interface TreeNode {
  name: string
  type: 'folder' | 'note'
  path: string // abs path for note, posix rel for folder
  children?: TreeNode[]
  meta?: NoteMeta
}

export type TreeSort = 'name-asc' | 'name-desc' | 'mtime-desc' | 'mtime-asc'
export type TreeGroup = 'folders-first' | 'files-first'

export function folderMtime(node: TreeNode): number {
  if (node.type === 'note') return node.meta?.mtime ?? 0
  let max = 0
  for (const c of node.children ?? []) {
    const m = folderMtime(c)
    if (m > max) max = m
  }
  return max
}

/**
 * The index's folder list, as vault-relative posix paths.
 *
 * The index stores absolute paths in the separator the machine uses, so on
 * Windows they arrive as `C:\vault\Notes` while everything the tree is
 * built from — a note's `relPath`, a folder node's `path` — is posix. Both
 * sides are normalised here before they are compared, because the naive
 * version (`startsWith(root + '/')`) matched nothing at all on Windows: the
 * whole folder list was dropped, so a folder with no notes in it never
 * appeared in the sidebar until a file was created inside it, which is
 * when the note's own path finally implied it.
 */
export function vaultRelativeDirs(dirs: string[], vaultRoot: string): string[] {
  const toPosix = (p: string): string => p.split('\\').join('/')
  const root = toPosix(vaultRoot).replace(/\/+$/, '')
  if (!root) return []
  const prefix = `${root}/`
  const out: string[] = []
  for (const dir of dirs) {
    const p = toPosix(dir)
    if (p.startsWith(prefix)) out.push(p.slice(prefix.length))
  }
  return out
}

/**
 * Builds the same sorted/grouped tree the sidebar renders, so any other view
 * (e.g. the center-panel folder grid) that needs "the same rules as the
 * tree" can reuse this instead of re-implementing the sort/group semantics.
 *
 * Per-folder context files are left out entirely. They are not notes — they
 * are what Mindex writes *about* a folder for the assistant to read — and one
 * of them sits in almost every folder, so listing them doubles the visible
 * size of the tree with rows nobody navigates by. They have a door of their
 * own now: the Context button on a folder's own page opens that folder's
 * file. Left out here rather than run through the hide/reveal machinery so
 * there is a single rule, and so "Show hidden" stays about the user's own
 * choices instead of re-listing bookkeeping under a different heading.
 */
export function buildTree(
  notes: NoteMeta[],
  sortBy: TreeSort = 'name-asc',
  group: TreeGroup = 'folders-first',
  dirRelPaths: string[] = []
): TreeNode {
  const root: TreeNode = { name: '', type: 'folder', path: '', children: [] }
  const ensureFolder = (relPath: string): TreeNode => {
    const parts = relPath.split('/')
    let node = root
    for (let i = 0; i < parts.length; i++) {
      const folderName = parts[i] ?? ''
      if (!folderName) continue
      const folderPath = parts.slice(0, i + 1).join('/')
      let child = node.children?.find((c) => c.type === 'folder' && c.name === folderName)
      if (!child) {
        child = { name: folderName, type: 'folder', path: folderPath, children: [] }
        node.children?.push(child)
      }
      node = child
    }
    return node
  }
  for (const dir of dirRelPaths) ensureFolder(dir)
  for (const note of notes) {
    if (isContextFilename(note.relPath.split('/').pop() ?? '')) continue
    const parts = note.relPath.split('/')
    const parent = parts.length > 1 ? ensureFolder(parts.slice(0, -1).join('/')) : root
    parent.children?.push({
      name: parts[parts.length - 1] ?? note.relPath,
      type: 'note',
      path: note.path,
      meta: note
    })
  }
  function cmp(a: TreeNode, b: TreeNode): number {
    if (a.type !== b.type) {
      const foldersFirst = group === 'folders-first'
      if (a.type === 'folder') return foldersFirst ? -1 : 1
      return foldersFirst ? 1 : -1
    }
    if (a.type === 'note' && b.type === 'note') {
      const am = isManagedOrSidecarFilename(a.name)
      const bm = isManagedOrSidecarFilename(b.name)
      if (am !== bm) return am ? -1 : 1
    }
    switch (sortBy) {
      case 'name-desc':
        return b.name.localeCompare(a.name)
      case 'mtime-desc':
        return folderMtime(b) - folderMtime(a) || a.name.localeCompare(b.name)
      case 'mtime-asc':
        return folderMtime(a) - folderMtime(b) || a.name.localeCompare(b.name)
      case 'name-asc':
      default:
        return a.name.localeCompare(b.name)
    }
  }
  function sort(n: TreeNode): void {
    if (!n.children) return
    n.children.sort(cmp)
    for (const c of n.children) sort(c)
  }
  sort(root)
  return root
}

/** Walks a built tree down to the node for a folder-relative path ('' = root). */
export function findFolderNode(root: TreeNode, folderRel: string): TreeNode | null {
  if (!folderRel) return root
  let node = root
  for (const part of folderRel.split('/')) {
    const next = node.children?.find((c) => c.type === 'folder' && c.name === part)
    if (!next) return null
    node = next
  }
  return node
}
