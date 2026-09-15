import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// `util/paths.ts` imports `app` at module load to find the app config
// directory. None of what is tested here uses it — the vault temp directory is
// derived from the vault root — but the module graph will not load without it.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/mindex-test-app-config' }
}))

import { setVault } from './state'
import {
  deleteFile,
  isIgnoredVaultPath,
  listMarkdownFiles,
  listVaultDirs,
  listVaultFiles,
  readNoteFile,
  renameFile,
  resolveInVault,
  writeNoteFile
} from './fs-ops'

/**
 * The layer every note read and write goes through.
 *
 * Worth its own tests for two reasons. It is the only thing standing between a
 * path that came from the window and the rest of the disk, and it is about to
 * be moved by the folder restructure — so these exist to say whether the move
 * changed behaviour, which is a question that cannot be answered by tests
 * written afterwards.
 */

let root: string

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'mindex-vault-')))
  setVault({ root, name: 'test', openedAt: Date.now() })
})

afterEach(async () => {
  setVault(null)
  await fs.rm(root, { recursive: true, force: true })
})

async function write(rel: string, body = 'x'): Promise<void> {
  const abs = path.join(root, rel)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, body)
}

function rels(abs: string[]): string[] {
  return abs.map((p) => path.relative(root, p).split(path.sep).join('/')).sort()
}

describe('resolveInVault', () => {
  it('resolves a plain relative path inside the vault', () => {
    expect(resolveInVault('note.md')).toBe(path.join(root, 'note.md'))
  })

  it('resolves a nested path', () => {
    expect(resolveInVault('a/b/note.md')).toBe(path.join(root, 'a', 'b', 'note.md'))
  })

  it('allows the vault root itself', () => {
    expect(resolveInVault('.')).toBe(root)
  })

  it('refuses to climb out with ..', () => {
    expect(() => resolveInVault('../escape.md')).toThrow(/escapes vault/)
  })

  it('refuses to climb out through a subfolder', () => {
    expect(() => resolveInVault('a/../../escape.md')).toThrow(/escapes vault/)
  })

  it('refuses an absolute path elsewhere on disk', () => {
    expect(() => resolveInVault('/etc/passwd')).toThrow(/escapes vault/)
  })

  it('refuses a sibling directory whose name starts with the vault name', () => {
    // `${root}-evil` shares a string prefix with the root but is not inside it.
    // A containment check written with startsWith rather than a relative path
    // would let this through.
    expect(() => resolveInVault(`${root}-evil/note.md`)).toThrow(/escapes vault/)
  })

  it('throws when no vault is open', () => {
    setVault(null)
    expect(() => resolveInVault('note.md')).toThrow(/No vault is open/)
  })

  /**
   * Found by these tests, not by a report. The containment check used to ask
   * whether the relative path *started with* two dots, which is true both for
   * "climb out of here" and for an ordinary name that happens to begin with
   * two dots. So a note called `..draft.md` at the top of the vault was
   * refused every read, write, rename and delete, with a message claiming it
   * was outside the vault. Nested ones worked by accident.
   */
  describe('names that merely begin with dots are ordinary names', () => {
    it('accepts a note whose name starts with two dots', () => {
      expect(resolveInVault('..draft.md')).toBe(path.join(root, '..draft.md'))
    })

    it('accepts a note whose name starts with three dots', () => {
      expect(resolveInVault('...notes.md')).toBe(path.join(root, '...notes.md'))
    })

    it('accepts a folder whose name starts with two dots', () => {
      expect(resolveInVault('..archive/note.md')).toBe(path.join(root, '..archive', 'note.md'))
    })

    it('still refuses a real climb-out, which is the whole point', () => {
      expect(() => resolveInVault('..')).toThrow(/escapes vault/)
      expect(() => resolveInVault('../sibling.md')).toThrow(/escapes vault/)
      expect(() => resolveInVault('a/../../out.md')).toThrow(/escapes vault/)
    })

    it('round-trips a dot-prefixed note through write and read', async () => {
      await writeNoteFile('..draft.md', 'body')
      expect(await readNoteFile('..draft.md')).toBe('body')
    })
  })
})

describe('reading and writing a note', () => {
  it('round-trips content', async () => {
    await writeNoteFile('note.md', '# hello')
    expect(await readNoteFile('note.md')).toBe('# hello')
  })

  it('creates missing parent folders on write', async () => {
    await writeNoteFile('a/b/deep.md', 'body')
    expect(await readNoteFile('a/b/deep.md')).toBe('body')
  })

  it('overwrites an existing note', async () => {
    await writeNoteFile('note.md', 'first')
    await writeNoteFile('note.md', 'second')
    expect(await readNoteFile('note.md')).toBe('second')
  })

  it('leaves no temp file behind after a write', async () => {
    await writeNoteFile('note.md', 'body')
    const tmpDir = path.join(root, '.mindex', 'tmp')
    const left = await fs.readdir(tmpDir).catch(() => [])
    expect(left).toEqual([])
  })

  it('refuses to write outside the vault', async () => {
    await expect(writeNoteFile('../escape.md', 'body')).rejects.toThrow(/escapes vault/)
  })

  it('refuses to read outside the vault', async () => {
    await expect(readNoteFile('../../etc/hosts')).rejects.toThrow(/escapes vault/)
  })
})

describe('deleteFile', () => {
  it('removes the file', async () => {
    await write('note.md')
    await deleteFile('note.md')
    await expect(fs.access(path.join(root, 'note.md'))).rejects.toThrow()
  })

  it('is silent about a file that is already gone', async () => {
    await expect(deleteFile('never-existed.md')).resolves.toBeUndefined()
  })

  it('refuses to delete outside the vault', async () => {
    await expect(deleteFile('../escape.md')).rejects.toThrow(/escapes vault/)
  })
})

describe('renameFile', () => {
  it('moves a note to a new name', async () => {
    await write('old.md', 'body')
    await renameFile('old.md', 'new.md')
    expect(await fs.readFile(path.join(root, 'new.md'), 'utf8')).toBe('body')
    await expect(fs.access(path.join(root, 'old.md'))).rejects.toThrow()
  })

  it('creates the destination folder when it does not exist', async () => {
    await write('old.md', 'body')
    await renameFile('old.md', 'moved/into/here.md')
    expect(await fs.readFile(path.join(root, 'moved/into/here.md'), 'utf8')).toBe('body')
  })

  it('refuses to overwrite an existing file', async () => {
    await write('a.md', 'keep me')
    await write('b.md', 'other')
    await expect(renameFile('b.md', 'a.md')).rejects.toThrow(/already exists/)
    // The guard is only worth anything if the target really survives.
    expect(await fs.readFile(path.join(root, 'a.md'), 'utf8')).toBe('keep me')
  })

  it('refuses a destination outside the vault', async () => {
    await write('note.md')
    await expect(renameFile('note.md', '../escaped.md')).rejects.toThrow(/escapes vault/)
  })

  it('refuses a source outside the vault', async () => {
    await expect(renameFile('../outside.md', 'note.md')).rejects.toThrow(/escapes vault/)
  })
})

describe('isIgnoredVaultPath', () => {
  it('ignores files inside the app’s own folder', () => {
    expect(isIgnoredVaultPath(path.join(root, '.mindex', 'cache.json'), root)).toBe(true)
  })

  it('ignores files inside every CLI config folder, not just one', () => {
    for (const dir of ['.claude', '.codex', '.gemini']) {
      expect(isIgnoredVaultPath(path.join(root, dir, 'skill.md'), root)).toBe(true)
    }
  })

  it('ignores version control and dependency folders', () => {
    expect(isIgnoredVaultPath(path.join(root, '.git', 'config'), root)).toBe(true)
    expect(isIgnoredVaultPath(path.join(root, 'node_modules', 'x', 'y.md'), root)).toBe(true)
  })

  it('ignores OS clutter files wherever they sit', () => {
    expect(isIgnoredVaultPath(path.join(root, '.DS_Store'), root)).toBe(true)
    expect(isIgnoredVaultPath(path.join(root, 'notes', '.DS_Store'), root)).toBe(true)
  })

  it('ignores anything outside the vault', () => {
    expect(isIgnoredVaultPath('/somewhere/else/note.md', root)).toBe(true)
  })

  it('keeps an ordinary note', () => {
    expect(isIgnoredVaultPath(path.join(root, 'notes', 'real.md'), root)).toBe(false)
  })

  it('keeps a folder that merely starts with an ignored name', () => {
    expect(isIgnoredVaultPath(path.join(root, '.gitignore-notes', 'real.md'), root)).toBe(false)
  })
})

describe('walking the vault', () => {
  beforeEach(async () => {
    await write('root.md')
    await write('folder/nested.md')
    await write('folder/deeper/leaf.md')
    await write('drawing.excalidraw')
    await write('image.png')
    await write('.DS_Store')
    await write('.mindex/cache.json')
    await write('.claude/skills/generated.md')
    await write('node_modules/pkg/readme.md')
  })

  it('lists every real file and nothing ignored', async () => {
    expect(rels(await listVaultFiles())).toEqual([
      'drawing.excalidraw',
      'folder/deeper/leaf.md',
      'folder/nested.md',
      'image.png',
      'root.md'
    ])
  })

  it('lists only notes and drawings when asked for markdown', async () => {
    expect(rels(await listMarkdownFiles())).toEqual([
      'drawing.excalidraw',
      'folder/deeper/leaf.md',
      'folder/nested.md',
      'root.md'
    ])
  })

  it('lists folders, skipping the ignored ones', async () => {
    expect(rels(await listVaultDirs())).toEqual(['folder', 'folder/deeper'])
  })

  it('agrees with isIgnoredVaultPath about every file it returns', async () => {
    // The two answers used to disagree — the watcher indexed files the walk
    // skipped. Anything the walk yields must also pass the ignore check.
    for (const abs of await listVaultFiles()) {
      expect(isIgnoredVaultPath(abs, root), abs).toBe(false)
    }
  })
})
