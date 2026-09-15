// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { installApiStub } from '@/test/apiStub'
import { makeLeaf } from '@/platform/tab-layout'
import { useEditorStore } from './store'

/**
 * Closing a tab closes that tab.
 *
 * It used to close every tab showing the same file, because the action took a
 * path and fanned out over `tabPaths`. Two tabs legitimately converge on one
 * path — a split view of the same note, or back/forward walking two tabs onto
 * it — and both carry the same title, which is how this was first reported:
 * "closing one of two identically named tabs closes both".
 */

const PATH = '/vault/Notes/idea.md'
const OTHER = '/vault/Notes/other.md'

/** Two tabs in one pane, both showing `paths`, with the first active. */
function seed(paths: [string, string]): { first: string; second: string } {
  const first = 'tab-1'
  const second = 'tab-2'
  const leaf = makeLeaf([first, second], first)
  useEditorStore.setState({
    layout: leaf,
    activeGroupId: leaf.id,
    activeTabId: first,
    activePath: paths[0],
    tabPaths: { [first]: paths[0], [second]: paths[1] },
    openPaths: [...new Set(paths)],
    docs: Object.fromEntries(
      [...new Set(paths)].map((p) => [
        p,
        { meta: null, body: '', dirty: false, loading: false, reloadNonce: 0 }
      ])
    ) as never
  })
  return { first, second }
}

beforeEach(() => {
  installApiStub()
})

describe('closeTab', () => {
  it('leaves the other tab open when both show the same file', async () => {
    const { first, second } = seed([PATH, PATH])
    await useEditorStore.getState().closeTab(first)

    const s = useEditorStore.getState()
    expect(Object.keys(s.tabPaths)).toEqual([second])
    expect(s.tabPaths[second]).toBe(PATH)
    // The file is still on screen, so its content must not have been dropped.
    expect(s.openPaths).toContain(PATH)
    expect(s.docs[PATH]).toBeDefined()
  })

  it('drops the file once its last tab goes', async () => {
    const { first, second } = seed([PATH, PATH])
    await useEditorStore.getState().closeTab(first)
    await useEditorStore.getState().closeTab(second)

    const s = useEditorStore.getState()
    expect(s.openPaths).not.toContain(PATH)
    expect(s.docs[PATH]).toBeUndefined()
  })

  it('does not disturb a tab showing a different file', async () => {
    const { first, second } = seed([PATH, OTHER])
    await useEditorStore.getState().closeTab(first)

    const s = useEditorStore.getState()
    expect(Object.keys(s.tabPaths)).toEqual([second])
    expect(s.tabPaths[second]).toBe(OTHER)
    expect(s.docs[OTHER]).toBeDefined()
    expect(s.docs[PATH]).toBeUndefined()
  })

  it('ignores a tab id that is not open', async () => {
    const { first, second } = seed([PATH, OTHER])
    await useEditorStore.getState().closeTab('tab-does-not-exist')

    expect(Object.keys(useEditorStore.getState().tabPaths).sort()).toEqual([first, second])
  })
})
