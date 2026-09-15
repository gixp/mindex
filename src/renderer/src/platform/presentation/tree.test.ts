import { describe, expect, it } from 'vitest'
import type { NoteMeta } from '@shared/types'
import { buildTree, findFolderNode } from './tree'

function note(relPath: string): NoteMeta {
  return {
    path: `/vault/${relPath}`,
    relPath,
    title: relPath.split('/').pop() ?? relPath,
    mtime: 0
  } as NoteMeta
}

describe('buildTree', () => {
  it('leaves every provider’s context file out of the tree', () => {
    // All three names, not just the active provider's: switching CLI leaves
    // the previous one's file on disk, and it is the same kind of file.
    const tree = buildTree(
      [
        note('Projects/CLAUDE.md'),
        note('Projects/AGENTS.md'),
        note('Projects/GEMINI.md'),
        note('Projects/roadmap.md')
      ],
      'name-asc',
      'folders-first',
      ['Projects']
    )
    const names = findFolderNode(tree, 'Projects')?.children?.map((c) => c.name)
    expect(names).toEqual(['roadmap.md'])
  })

  it('keeps the folder even when the context file was its only entry', () => {
    // The folder is still a place the user can open and put notes in — it
    // must not vanish along with the bookkeeping file inside it.
    const tree = buildTree([note('Empty/CLAUDE.md')], 'name-asc', 'folders-first', ['Empty'])
    const folder = findFolderNode(tree, 'Empty')
    expect(folder).not.toBeNull()
    expect(folder?.children).toEqual([])
  })

  it('keeps a note that merely mentions a context name in its path', () => {
    // The rule is about the filename, not the path — a folder called
    // CLAUDE.md-notes, or a note deeper down, is the user's own.
    const tree = buildTree([note('CLAUDE.md.backup.md')], 'name-asc', 'folders-first', [])
    expect(tree.children?.map((c) => c.name)).toEqual(['CLAUDE.md.backup.md'])
  })

  it('still keeps ordinary notes at the root', () => {
    const tree = buildTree([note('CLAUDE.md'), note('inbox.md')], 'name-asc', 'folders-first', [])
    expect(tree.children?.map((c) => c.name)).toEqual(['inbox.md'])
  })
})
