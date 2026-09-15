// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { installApiStub } from '@/test/apiStub'
import { makeLeaf } from '@/platform/tab-layout'
import { useNotificationsStore } from '@/platform/notifications'
import { useEditorStore } from './store'

/**
 * A note that cannot be written says so.
 *
 * `save` handled exactly one failure: a write conflict. Every other reason a
 * write can fail — no permission, a full disk, the file deleted underneath, a
 * read-only volume — was dropped. The note stayed dirty, nothing reached the
 * disk, and nothing on screen said anything. With autosave silent and no
 * unsaved marker anywhere, that is an hour of typing into a file nobody is
 * writing.
 */

const PATH = '/vault/Notes/idea.md'

function seedOpenNote(): void {
  const leaf = makeLeaf(['tab-1'], 'tab-1')
  useEditorStore.setState({
    layout: leaf,
    activeGroupId: leaf.id,
    activeTabId: 'tab-1',
    activePath: PATH,
    tabPaths: { 'tab-1': PATH },
    openPaths: [PATH],
    docs: {
      [PATH]: {
        meta: { path: PATH, relPath: 'Notes/idea.md', frontmatter: {}, mtime: 1 },
        body: 'some words',
        dirty: true,
        loading: false,
        reloadNonce: 0
      }
    } as never
  })
}

function refuseWith(error: string): void {
  installApiStub({ notes: { write: async () => ({ ok: false, error }) } })
}

beforeEach(() => {
  useNotificationsStore.setState({ errorModal: { open: false, title: '', message: '' } })
  seedOpenNote()
})

describe('a write that fails for a reason other than a conflict', () => {
  it('is put in front of the person, naming the file and the reason', async () => {
    refuseWith('EACCES: permission denied')

    await useEditorStore.getState().save(PATH)

    const notice = useNotificationsStore.getState().errorModal
    expect(notice.open).toBe(true)
    expect(notice.message).toContain('idea.md')
    expect(notice.message).toContain('permission denied')
  })

  it('leaves the note dirty, so nothing typed is thrown away', async () => {
    refuseWith('ENOSPC: no space left on device')

    await useEditorStore.getState().save(PATH)

    const doc = useEditorStore.getState().docs[PATH]
    expect(doc?.dirty).toBe(true)
    expect(doc?.body).toBe('some words')
  })

  it('says it once, not once per keystroke', async () => {
    // Autosave retries on every change, so a failing disk would otherwise
    // stack one dialog per character typed.
    refuseWith('EACCES: permission denied')
    await useEditorStore.getState().save(PATH)
    useNotificationsStore.setState({ errorModal: { open: false, title: '', message: '' } })

    await useEditorStore.getState().save(PATH)

    expect(useNotificationsStore.getState().errorModal.open).toBe(false)
  })

  it('says it again when the reason changes', async () => {
    refuseWith('EACCES: permission denied')
    await useEditorStore.getState().save(PATH)
    useNotificationsStore.setState({ errorModal: { open: false, title: '', message: '' } })

    refuseWith('ENOSPC: no space left on device')
    await useEditorStore.getState().save(PATH)

    expect(useNotificationsStore.getState().errorModal.message).toContain('no space left')
  })

  it('stays quiet when the write succeeds', async () => {
    installApiStub({
      notes: {
        write: async () => ({
          ok: true,
          data: { path: PATH, relPath: 'Notes/idea.md', frontmatter: {}, mtime: 2 }
        })
      }
    })

    await useEditorStore.getState().save(PATH)

    expect(useNotificationsStore.getState().errorModal.open).toBe(false)
    expect(useEditorStore.getState().docs[PATH]?.dirty).toBe(false)
  })
})

describe('a write conflict', () => {
  it('still goes to its own dialog, not this one', async () => {
    // The two are different questions: a conflict asks which copy to keep,
    // this one reports that neither could be written.
    installApiStub({
      notes: { write: async () => ({ ok: false, code: 'WRITE_CONFLICT', error: 'changed' }) }
    })

    await useEditorStore.getState().save(PATH)

    expect(useNotificationsStore.getState().errorModal.open).toBe(false)
    expect(useEditorStore.getState().docs[PATH]?.conflict).toBe(true)
  })
})
