import { describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import type { FileChangeEvent } from '@shared/types'

// runner.ts's import graph reaches `electron` transitively (folderContext/api.ts
// imports `shell`, and settings/app-settings.ts -> util/paths.ts imports
// `app`) — neither is exercised by resolveTouchedFolder itself, but the
// module can't load under plain Node/Vitest without this shim. `vi.mock`
// calls are hoisted above imports by vitest, so this runs before the
// `./runner` import below regardless of textual order.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/mindex-test-app-config' },
  shell: {
    trashItem: vi.fn(),
    openPath: vi.fn(),
    showItemInFolder: vi.fn(),
    openExternal: vi.fn()
  }
}))

import { markSelfWrite, resolveTouchedFolder } from './runner'

const VAULT_ROOT = path.resolve('/vault')

function file(rel: string): FileChangeEvent {
  return { kind: 'add', path: path.join(VAULT_ROOT, rel) }
}

function addDir(rel: string): FileChangeEvent {
  return { kind: 'addDir', path: path.join(VAULT_ROOT, rel) }
}

function unlinkDir(rel: string): FileChangeEvent {
  return { kind: 'unlinkDir', path: path.join(VAULT_ROOT, rel) }
}

describe('resolveTouchedFolder', () => {
  it('addDir returns the new directory itself, not its parent', () => {
    const result = resolveTouchedFolder(VAULT_ROOT, addDir('Organizations'))
    expect(result).toBe(path.join(VAULT_ROOT, 'Organizations'))
  })

  it('addDir for a nested new folder still returns its own path', () => {
    const result = resolveTouchedFolder(VAULT_ROOT, addDir('Development/Organizations'))
    expect(result).toBe(path.join(VAULT_ROOT, 'Development/Organizations'))
  })

  it('unlinkDir is always ignored', () => {
    expect(resolveTouchedFolder(VAULT_ROOT, unlinkDir('Organizations'))).toBeNull()
  })

  it('file add/change/unlink resolve to the parent folder, unchanged from before', () => {
    for (const kind of ['add', 'change', 'unlink'] as const) {
      const event: FileChangeEvent = { kind, path: path.join(VAULT_ROOT, 'People/note.md') }
      expect(resolveTouchedFolder(VAULT_ROOT, event)).toBe(path.join(VAULT_ROOT, 'People'))
    }
  })

  it('respects the self-write window', () => {
    const absPath = path.join(VAULT_ROOT, 'Projects/note.md')
    markSelfWrite(absPath)
    expect(resolveTouchedFolder(VAULT_ROOT, { kind: 'change', path: absPath })).toBeNull()
  })

  it('ignores managed context filenames', () => {
    expect(resolveTouchedFolder(VAULT_ROOT, file('Projects/CLAUDE.md'))).toBeNull()
    expect(resolveTouchedFolder(VAULT_ROOT, file('Projects/AGENTS.md'))).toBeNull()
  })

  it('ignores common lockfiles and .DS_Store', () => {
    expect(resolveTouchedFolder(VAULT_ROOT, file('Projects/package-lock.json'))).toBeNull()
    expect(resolveTouchedFolder(VAULT_ROOT, file('Projects/.DS_Store'))).toBeNull()
  })

  it('ignores dot-prefixed basenames', () => {
    expect(resolveTouchedFolder(VAULT_ROOT, file('Projects/.hidden'))).toBeNull()
  })

  it('ignores paths inside SKIP directories, for files and for addDir itself', () => {
    expect(resolveTouchedFolder(VAULT_ROOT, file('.git/HEAD'))).toBeNull()
    expect(resolveTouchedFolder(VAULT_ROOT, file('Projects/node_modules/pkg/index.js'))).toBeNull()
    expect(resolveTouchedFolder(VAULT_ROOT, addDir('Projects/node_modules'))).toBeNull()
    expect(resolveTouchedFolder(VAULT_ROOT, addDir('.mindex'))).toBeNull()
  })

  it('excludes the vault root itself, for both a root-level file and an addDir equal to root', () => {
    expect(resolveTouchedFolder(VAULT_ROOT, file('note.md'))).toBeNull()
    expect(resolveTouchedFolder(VAULT_ROOT, addDir(''))).toBeNull()
  })

  it('ignores paths outside the vault root', () => {
    const outside: FileChangeEvent = { kind: 'add', path: path.resolve('/elsewhere/note.md') }
    expect(resolveTouchedFolder(VAULT_ROOT, outside)).toBeNull()
  })
})
