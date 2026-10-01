import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { NoteMeta } from '@shared/types'

/**
 * The operations that move and destroy the user's own files.
 *
 * Written before the folder restructure moves this module, so that "did the
 * move change anything?" has an answer. The emphasis is deliberately on the
 * refusals rather than the happy paths: a rename that fails is an annoyance,
 * and a delete that succeeds where it should have refused is not recoverable.
 *
 * The index, history, comments, templates and analytics are stubbed — they are
 * collaborators with their own storage, and none of them is what these tests
 * are asking about. The filesystem is real, in a temp directory.
 */

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/mindex-test-app-config' }
}))

vi.mock('@main/telemetry/analytics', () => ({ capture: vi.fn() }))
vi.mock('@main/history/store', () => ({ rekeyHistory: vi.fn(async () => {}) }))
vi.mock('@main/comments/store', () => ({ rekeyComments: vi.fn(async () => {}) }))
vi.mock('@main/templates/engine', () => ({
  getTemplateForType: vi.fn(async () => null),
  instantiate: vi.fn((s: string) => s)
}))
vi.mock('@main/types/registry', () => ({
  specOrUntyped: vi.fn(() => ({ id: 'untyped', label: 'Untyped', fields: [] })),
  detectType: vi.fn(() => 'untyped')
}))
vi.mock('@main/types/definitions', () => ({ readVaultDef: vi.fn(async () => null) }))

// A stand-in index: the real one watches the filesystem and keeps its own
// store. These tests care that the operations *tell* it what changed and read
// the right entries back, not how it remembers them.
const notes = new Map<string, NoteMeta>()
const changes: Array<{ kind: string; path: string }> = []

vi.mock('@main/index/indexer', () => ({
  applyFileChange: vi.fn(async (e: { kind: string; path: string }) => {
    changes.push(e)
    if (e.kind === 'unlink') notes.delete(e.path)
    // The real index reads the file back and stores an entry; the operations
    // then look that entry up and fail loudly if it is missing. Mirroring
    // that here is what makes those failure branches reachable in a test.
    if (e.kind === 'add') notes.set(e.path, metaFor(e.path))
  }),
  forgetCreatedAt: vi.fn(),
  listAllNotes: vi.fn(() => [...notes.values()]),
  getNoteMeta: vi.fn((abs: string) => notes.get(abs) ?? null),
  getNoteByRelPath: vi.fn(
    (rel: string) => [...notes.values()].find((n) => n.relPath === rel) ?? null
  )
}))

import { setVault } from '@main/vault/state'
import {
  deleteFolder,
  deleteNote,
  moveFolder,
  moveNote,
  renameFolder,
  renameNote
} from './operations'

let root: string

function metaFor(abs: string): NoteMeta {
  return meta(path.relative(root, abs).split(path.sep).join('/'))
}

function meta(rel: string): NoteMeta {
  return {
    path: path.join(root, rel),
    relPath: rel,
    title: path.basename(rel, '.md'),
    type: 'untyped',
    frontmatter: {},
    tags: [],
    outgoingLinks: [],
    mtime: Date.now(),
    size: 1,
    isDirectory: false
  }
}

async function seed(rel: string, body = 'body'): Promise<string> {
  const abs = path.join(root, rel)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, body)
  if (rel.endsWith('.md')) notes.set(abs, meta(rel))
  return abs
}

const exists = (rel: string): Promise<boolean> =>
  fs
    .access(path.join(root, rel))
    .then(() => true)
    .catch(() => false)

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'mindex-notes-')))
  setVault({ root, name: 'test', openedAt: Date.now() })
  notes.clear()
  changes.length = 0
})

afterEach(async () => {
  setVault(null)
  await fs.rm(root, { recursive: true, force: true })
})

describe('renaming a note', () => {
  it('renames the file on disk', async () => {
    await seed('old.md', 'content')
    await seed('other.md', 'x')
    await renameNote(path.join(root, 'old.md'), 'new')
    expect(await exists('new.md')).toBe(true)
    expect(await exists('old.md')).toBe(false)
  })

  it('keeps the content', async () => {
    await seed('old.md', 'the body survives')
    await renameNote(path.join(root, 'old.md'), 'new')
    expect(await fs.readFile(path.join(root, 'new.md'), 'utf8')).toBe('the body survives')
  })

  it('rewrites links pointing at it from other notes', async () => {
    await seed('target.md', 'x')
    await seed('linker.md', 'see [[target]] for more')
    await renameNote(path.join(root, 'target.md'), 'renamed')
    expect(await fs.readFile(path.join(root, 'linker.md'), 'utf8')).toContain('[[renamed]]')
  })

  it('refuses to rename a file the agent CLI owns', async () => {
    await seed('CLAUDE.md', 'context')
    await expect(renameNote(path.join(root, 'CLAUDE.md'), 'notes')).rejects.toThrow(
      /Refusing to rename/
    )
    // The refusal is worthless if the file moved anyway.
    expect(await exists('CLAUDE.md')).toBe(true)
  })

  it('keeps the extension when the new name already carries one', async () => {
    await seed('old.md')
    await renameNote(path.join(root, 'old.md'), 'new.md')
    expect(await exists('new.md')).toBe(true)
    expect(await exists('new.md.md')).toBe(false)
  })
})

describe('moving a note', () => {
  it('moves it into the target folder', async () => {
    await seed('note.md', 'body')
    await fs.mkdir(path.join(root, 'archive'), { recursive: true })
    await moveNote(path.join(root, 'note.md'), 'archive')
    expect(await exists('archive/note.md')).toBe(true)
    expect(await exists('note.md')).toBe(false)
  })

  it('refuses to move a file the agent CLI owns', async () => {
    await seed('CLAUDE.md', 'context')
    await expect(moveNote(path.join(root, 'CLAUDE.md'), 'archive')).rejects.toThrow(
      /Refusing to move/
    )
    expect(await exists('CLAUDE.md')).toBe(true)
  })
})

describe('deleting a note', () => {
  it('removes the file', async () => {
    await seed('note.md')
    await deleteNote(path.join(root, 'note.md'))
    expect(await exists('note.md')).toBe(false)
  })

  it('tells the index the note is gone', async () => {
    const abs = await seed('note.md')
    await deleteNote(abs)
    expect(changes).toContainEqual({ kind: 'unlink', path: abs })
  })

  it('allows deleting an agent-owned file, unlike rename and move', async () => {
    // Documented difference: a half-renamed managed file confuses every tool
    // that looks for it, whereas a deleted one is simply regenerated.
    await seed('CLAUDE.md', 'context')
    await deleteNote(path.join(root, 'CLAUDE.md'))
    expect(await exists('CLAUDE.md')).toBe(false)
  })
})

describe('moving a folder', () => {
  it('moves the folder and everything under it', async () => {
    await seed('src/a.md', 'a')
    await seed('src/deep/b.md', 'b')
    await fs.mkdir(path.join(root, 'dest'), { recursive: true })
    await moveFolder(path.join(root, 'src'), 'dest')
    expect(await exists('dest/src/a.md')).toBe(true)
    expect(await exists('dest/src/deep/b.md')).toBe(true)
    expect(await exists('src')).toBe(false)
  })

  it('refuses to move the vault root', async () => {
    await expect(moveFolder(root, 'somewhere')).rejects.toThrow(/Refusing to move vault root/)
  })

  it('refuses to move a folder inside itself', async () => {
    await seed('parent/child/note.md')
    await expect(moveFolder(path.join(root, 'parent'), 'parent/child')).rejects.toThrow(
      /into itself/
    )
    expect(await exists('parent/child/note.md')).toBe(true)
  })
})

describe('deleting a folder', () => {
  it('removes the folder and its contents', async () => {
    await seed('doomed/a.md')
    await seed('doomed/deep/b.md')
    await deleteFolder(path.join(root, 'doomed'))
    expect(await exists('doomed')).toBe(false)
  })

  it('tells the index about every note that was inside', async () => {
    const a = await seed('doomed/a.md')
    const b = await seed('doomed/deep/b.md')
    await deleteFolder(path.join(root, 'doomed'))
    expect(changes).toContainEqual({ kind: 'unlink', path: a })
    expect(changes).toContainEqual({ kind: 'unlink', path: b })
  })

  it('leaves neighbouring folders alone', async () => {
    await seed('doomed/a.md')
    await seed('keeper/b.md')
    await deleteFolder(path.join(root, 'doomed'))
    expect(await exists('keeper/b.md')).toBe(true)
  })

  it('refuses to delete the vault root', async () => {
    await seed('note.md')
    await expect(deleteFolder(root)).rejects.toThrow(/Refusing to delete vault root/)
    expect(await exists('note.md')).toBe(true)
  })

  it('refuses the vault root even when the path spells it indirectly', async () => {
    // `<root>/anything/..` resolves back to the root. If the guard compared
    // the raw string instead of the resolved one, this would delete the whole
    // vault — the single worst thing in this file.
    await seed('note.md')
    await expect(deleteFolder(path.join(root, 'anything', '..'))).rejects.toThrow(
      /Refusing to delete vault root/
    )
    expect(await exists('note.md')).toBe(true)
  })

  it('refuses a folder outside the vault', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'mindex-outside-'))
    await fs.writeFile(path.join(outside, 'precious.txt'), 'do not delete')
    try {
      await expect(deleteFolder(outside)).rejects.toThrow()
      await expect(fs.access(path.join(outside, 'precious.txt'))).resolves.toBeUndefined()
    } finally {
      await fs.rm(outside, { recursive: true, force: true })
    }
  })
})

describe('hostile input — the guarantee the restructure must not break', () => {
  it('strips path separators out of a new note name instead of following them', async () => {
    await seed('note.md', 'body')
    await renameNote(path.join(root, 'note.md'), '../../escaped')
    // The separators become harmless characters, so the note stays put.
    expect(await exists('note.md')).toBe(false)
    const left = await fs.readdir(root)
    expect(left.some((n) => n.includes('escaped') && n.endsWith('.md'))).toBe(true)
    expect(await exists('../escaped.md')).toBe(false)
  })

  it('refuses to move a note to a folder outside the vault', async () => {
    await seed('note.md', 'body')
    await expect(moveNote(path.join(root, 'note.md'), '../../elsewhere')).rejects.toThrow(
      /escapes vault/
    )
    expect(await exists('note.md')).toBe(true)
  })

  it('refuses to move a folder outside the vault', async () => {
    await seed('folder/note.md')
    await expect(moveFolder(path.join(root, 'folder'), '../../elsewhere')).rejects.toThrow(
      /escapes vault/
    )
    expect(await exists('folder/note.md')).toBe(true)
  })

  it('refuses to rename a note onto an existing one', async () => {
    await seed('a.md', 'keep me')
    await seed('b.md', 'other')
    await expect(renameNote(path.join(root, 'b.md'), 'a')).rejects.toThrow(/already exists/)
    expect(await fs.readFile(path.join(root, 'a.md'), 'utf8')).toBe('keep me')
    expect(await exists('b.md')).toBe(true)
  })

  it('refuses to move a note onto an existing one in the destination', async () => {
    await seed('note.md', 'moving')
    await seed('dest/note.md', 'already there')
    await expect(moveNote(path.join(root, 'note.md'), 'dest')).rejects.toThrow(/already exists/)
    expect(await fs.readFile(path.join(root, 'dest/note.md'), 'utf8')).toBe('already there')
  })

  /**
   * Renaming a folder, which until now could not be done at all: the sidebar
   * offered Rename on a note and nothing on a folder, so a folder created as
   * "Untitled folder" stayed that way unless you rebuilt it by hand.
   */
  describe('renameFolder', () => {
    it('renames the folder and carries its notes with it', async () => {
      await seed('old/note.md', 'body')
      const r = await renameFolder(path.join(root, 'old'), 'new')
      expect(r.relPath).toBe('new')
      expect(await exists('old')).toBe(false)
      expect(await fs.readFile(path.join(root, 'new/note.md'), 'utf8')).toBe('body')
    })

    it('keeps the folder where it is, only changing its name', async () => {
      await seed('parent/old/note.md')
      const r = await renameFolder(path.join(root, 'parent/old'), 'new')
      expect(r.relPath).toBe('parent/new')
      expect(await exists('parent/new/note.md')).toBe(true)
    })

    it('renames a folder with nothing in it', async () => {
      await fs.mkdir(path.join(root, 'empty'), { recursive: true })
      await renameFolder(path.join(root, 'empty'), 'named')
      expect(await exists('named')).toBe(true)
      expect(await exists('empty')).toBe(false)
    })

    it('tells the index the folder moved, so an empty one does not linger', async () => {
      await fs.mkdir(path.join(root, 'empty/inner'), { recursive: true })
      changes.length = 0
      await renameFolder(path.join(root, 'empty'), 'named')
      expect(changes).toContainEqual({ kind: 'unlinkDir', path: path.join(root, 'empty') })
      expect(changes).toContainEqual({ kind: 'addDir', path: path.join(root, 'named') })
      expect(changes).toContainEqual({ kind: 'addDir', path: path.join(root, 'named/inner') })
    })

    it('refuses to rename onto a folder that is already there', async () => {
      await seed('a/note.md', 'keep me')
      await seed('b/note.md', 'other')
      await expect(renameFolder(path.join(root, 'b'), 'a')).rejects.toThrow(/already exists/)
      expect(await fs.readFile(path.join(root, 'a/note.md'), 'utf8')).toBe('keep me')
    })

    it('refuses to rename the vault root', async () => {
      await expect(renameFolder(root, 'something')).rejects.toThrow(/vault root/)
    })

    it('refuses a name that would climb out of the vault', async () => {
      await seed('folder/note.md')
      await renameFolder(path.join(root, 'folder'), '../escaped')
      // The separators are stripped rather than honoured, so the folder is
      // renamed in place instead of landing beside the vault.
      expect(await exists('../escaped')).toBe(false)
      const left = await fs.readdir(root)
      expect(left.some((n) => n.includes('escaped'))).toBe(true)
    })
  })
})
