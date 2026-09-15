// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/platform/api', () => ({ api: () => ({}) }))

import { useUiStore } from '@/platform/app-settings'
import { folderLook, iconVisibility, noteLook } from './index'

/**
 * The point of this module is that the person's own choice of icon is
 * honoured everywhere, so that is what most of these assert — including the
 * two ways it used to silently not be: reaching for the extension default
 * alone, and looking the choice up under the wrong identity.
 */

const ABS = '/vault/Projects/plan.md'
const REL = 'Projects'

function setOverrides(icons: Record<string, string>, colors: Record<string, string> = {}): void {
  useUiStore.setState({ iconOverrides: icons, iconColorOverrides: colors })
}

beforeEach(() => {
  useUiStore.setState({
    iconOverrides: {},
    iconColorOverrides: {},
    showFileIcons: true,
    showFolderIcons: true
  })
})

describe('a note', () => {
  it('falls back to the icon for its kind of file', () => {
    expect(noteLook(ABS, 'plan.md').icon).toBe('markdown')
    expect(noteLook('/vault/notes.pdf', 'notes.pdf').icon).toBe('file-pdf')
    expect(noteLook('/vault/thing.unknown', 'thing.unknown').icon).toBe('file')
  })

  it('falls back to the colour for its kind of file', () => {
    expect(noteLook(ABS, 'plan.md').colorClass).toBe('codicon-blue')
  })

  it('uses the icon the person picked instead', () => {
    setOverrides({ [ABS]: 'rocket' })
    expect(noteLook(ABS, 'plan.md').icon).toBe('rocket')
  })

  it('uses the colour the person picked', () => {
    setOverrides({}, { [ABS]: 'codicon-red' })
    expect(noteLook(ABS, 'plan.md').colorClass).toBe('codicon-red')
  })

  it('treats a cleared colour as "no choice" rather than as a colour', () => {
    // Stored as an empty string when someone clears it; `??` would keep the
    // empty string and paint nothing.
    setOverrides({}, { [ABS]: '' })
    expect(noteLook(ABS, 'plan.md').colorClass).not.toBe('')
  })

  it('ignores a choice stored against a different file', () => {
    setOverrides({ '/vault/other.md': 'rocket' })
    expect(noteLook(ABS, 'plan.md').icon).not.toBe('rocket')
  })

  it('strips the extension for the label', () => {
    expect(noteLook(ABS, 'plan.md').label).toBe('plan')
  })
})

describe('a folder', () => {
  it('is closed or open depending on what it is', () => {
    expect(folderLook(REL, 'Projects', false).icon).toBe('folder')
    expect(folderLook(REL, 'Projects', true).icon).toBe('folder-opened')
  })

  it('uses the icon the person picked', () => {
    setOverrides({ [REL]: 'archive' })
    expect(folderLook(REL, 'Projects').icon).toBe('archive')
  })

  it('always has a colour, even with no choice made', () => {
    expect(folderLook(REL, 'Projects').colorClass).toBeTruthy()
  })
})

describe('the two identities are not interchangeable', () => {
  /**
   * A note's choice is keyed by absolute path and a folder's by the
   * vault-relative one. Looking either up with the other silently finds
   * nothing, which is indistinguishable from "never chose an icon" — the
   * exact failure this module exists to end.
   */
  it('does not find a folder choice when asking about a note', () => {
    setOverrides({ Projects: 'archive' })
    expect(noteLook('/vault/Projects', 'Projects').icon).not.toBe('archive')
  })

  it('does not find a note choice when asking about a folder', () => {
    setOverrides({ '/vault/Projects': 'archive' })
    expect(folderLook('Projects', 'Projects').icon).not.toBe('archive')
  })
})

describe('whether icons are drawn at all', () => {
  it('reports both switches', () => {
    useUiStore.setState({ showFileIcons: false, showFolderIcons: true })
    expect(iconVisibility()).toEqual({ files: false, folders: true })
  })
})
