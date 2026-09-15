import { describe, expect, it, vi } from 'vitest'
import {
  activeDocumentPath,
  documentPathOf,
  folderRelFromPath,
  folderViewPath,
  graphFolderFromPath,
  graphViewPath,
  GRAPH_HOME_PATH,
  isFolderViewPath,
  isGraphPath,
  isSkillViewPath,
  isTypeViewPath,
  isVirtualPath,
  openDocument,
  setDocumentHost,
  skillPathFromView,
  skillViewPath,
  typeIdFromPath,
  typeViewPath
} from './documents'

/**
 * These addresses moved here from the editor's own store, where the rest of
 * the app had to reach in for them. Nothing about what they mean changed, so
 * what is pinned here is exactly that: the strings they produce and the
 * strings they recognise, spelled out rather than derived, so the move cannot
 * have quietly altered one.
 */
describe('the address of a view', () => {
  it('round-trips a folder', () => {
    expect(folderViewPath('Projects/Atlas')).toBe('mindex://folder/Projects/Atlas')
    expect(folderRelFromPath('mindex://folder/Projects/Atlas')).toBe('Projects/Atlas')
    expect(isFolderViewPath('mindex://folder/Projects/Atlas')).toBe(true)
    expect(isFolderViewPath('/vault/note.md')).toBe(false)
  })

  it('round-trips a skill, which lives outside the vault', () => {
    expect(skillViewPath('/home/me/.claude/skills/x.md')).toBe(
      'mindex://skill//home/me/.claude/skills/x.md'
    )
    expect(skillPathFromView('mindex://skill//home/me/.claude/skills/x.md')).toBe(
      '/home/me/.claude/skills/x.md'
    )
    expect(isSkillViewPath('mindex://skill//x.md')).toBe(true)
  })

  it('round-trips a note type', () => {
    expect(typeViewPath('meeting')).toBe('mindex://type/meeting')
    expect(typeIdFromPath('mindex://type/meeting')).toBe('meeting')
    expect(isTypeViewPath('mindex://type/meeting')).toBe(true)
  })

  it('keeps the whole-vault graph on the bare address', () => {
    // The scoped form has a trailing slash and the bare one does not, which is
    // what stops a tab opened before scoping existed from being reinterpreted.
    expect(graphViewPath('')).toBe(GRAPH_HOME_PATH)
    expect(graphViewPath('Notes')).toBe('mindex://graph/Notes')
    expect(graphFolderFromPath(GRAPH_HOME_PATH)).toBe('')
    expect(graphFolderFromPath('mindex://graph/Notes')).toBe('Notes')
    expect(isGraphPath(GRAPH_HOME_PATH)).toBe(true)
    expect(isGraphPath('mindex://graph/Notes')).toBe(true)
    expect(isGraphPath('mindex://folder/Notes')).toBe(false)
  })

  it('knows which addresses have a file behind them', () => {
    expect(isVirtualPath('mindex://graph')).toBe(true)
    expect(isVirtualPath('/vault/note.md')).toBe(false)
    expect(documentPathOf('/vault/note.md')).toBe('/vault/note.md')
    // A skill tab is virtual, but the file behind it is real — comments are
    // stored per file and have to follow it.
    expect(documentPathOf('mindex://skill//x.md')).toBe('/x.md')
    expect(documentPathOf('mindex://graph')).toBeNull()
    expect(documentPathOf(null)).toBeNull()
  })
})

describe('the door', () => {
  it('reaches whatever registered itself', async () => {
    const open = vi.fn(async () => undefined)
    setDocumentHost({ open, activePath: () => '/vault/a.md', subscribe: () => () => undefined })

    await openDocument('/vault/b.md')

    expect(open).toHaveBeenCalledWith('/vault/b.md')
    expect(activeDocumentPath()).toBe('/vault/a.md')
  })

  it('does nothing at all before anything registers', async () => {
    // Not a throw. This stands in for a test that renders one component on its
    // own, and failing there would report a broken component when the only
    // thing missing is the rest of the app.
    setDocumentHost({
      open: async () => undefined,
      activePath: () => null,
      subscribe: () => () => undefined
    })
    await expect(openDocument('/vault/a.md')).resolves.toBeUndefined()
    expect(activeDocumentPath()).toBeNull()
  })
})
