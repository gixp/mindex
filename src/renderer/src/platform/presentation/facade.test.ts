import { describe, expect, it } from 'vitest'
import { resolveTreeIcon, overrideKeyFor } from './tree-icon'
import { folderLookFrom, noteLookFrom, defaultFolderLook } from './index'

/**
 * The facade answers exactly what the resolver under it answers.
 *
 * Two call sites — the file tree and the graph — used to call that resolver
 * directly and build its override key themselves, because they draw rows in a
 * loop and could not use the hook forms. They go through here now. What this
 * pins is that nothing changed on screen in the process: for the same inputs,
 * the same icon and the same colour come back.
 *
 * The key is the part worth guarding. A note's choice is stored under its
 * absolute path and a folder's under its vault-relative one, and swapping them
 * is silent — the lookup misses, and a row with a chosen icon looks exactly
 * like a row without one.
 */

const settings = {
  iconOverrides: { '/vault/a.md': 'rocket', Projects: 'briefcase' },
  iconColorOverrides: { '/vault/a.md': 'codicon-emerald' },
  provider: 'claude' as const
}

describe('the facade and the resolver agree', () => {
  it('on a note, keyed by its absolute path', () => {
    const direct = resolveTreeIcon(
      { kind: 'note', name: 'a.md', overrideKey: overrideKeyFor('note', '/vault/a.md', 'a.md') },
      settings.iconOverrides,
      settings.iconColorOverrides,
      settings.provider
    )
    const viaFacade = noteLookFrom(settings, '/vault/a.md', 'a.md')
    expect(viaFacade.icon).toBe(direct.icon)
    expect(viaFacade.colorClass).toBe(direct.colorClass)
    expect(viaFacade.icon).toBe('rocket')
  })

  it('on a folder, keyed by its relative path', () => {
    const direct = resolveTreeIcon(
      {
        kind: 'folder',
        name: 'Projects',
        overrideKey: overrideKeyFor('folder', '/vault/Projects', 'Projects'),
        expanded: true
      },
      settings.iconOverrides,
      settings.iconColorOverrides,
      settings.provider
    )
    const viaFacade = folderLookFrom(settings, 'Projects', 'Projects', true)
    expect(viaFacade.icon).toBe(direct.icon)
    expect(viaFacade.icon).toBe('briefcase')
  })

  it('on a note with nothing chosen for it', () => {
    const viaFacade = noteLookFrom(settings, '/vault/b.md', 'b.md')
    expect(viaFacade.icon).not.toBe('rocket')
    expect(viaFacade.label).toBe('b')
  })
})

describe('the default a folder would get', () => {
  it('is the vault root’s own mark for the root', () => {
    // The root is keyed by the empty path. The icon picker's "Default" swatch
    // previews this, and used to spell it out itself.
    expect(defaultFolderLook('', 'My vault').icon).toBe('folder-library')
  })

  it('is a plain folder for anything else, and ignores a stored choice', () => {
    expect(defaultFolderLook('Projects', 'Projects').icon).toBe('folder')
  })
})
