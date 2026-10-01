// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@/test/setup'
import { installApiStub } from '@/test/apiStub'
import { useVaultStore } from '@/platform/workspace'
import type { NoteMeta } from '@shared/types'
import { TreePane } from './TreePane'
import { requestTreeInlineRenameFolder } from '@/platform/presentation/tree-events'

function note(relPath: string): NoteMeta {
  return {
    path: `/vault/${relPath}`,
    relPath,
    title: relPath,
    type: 'note',
    frontmatter: {},
    tags: [],
    outgoingLinks: [],
    mtime: 0,
    size: 0,
    isDirectory: false
  }
}

beforeEach(() => {
  installApiStub()
  useVaultStore.setState({
    vault: { root: '/vault', name: 'Test vault', openedAt: 0 },
    notes: [note('hello.md')],
    dirs: []
  })
})

describe('TreePane', () => {
  it('renders a note from the vault store', () => {
    render(<TreePane />)
    // treeDisplayName strips the .md extension for a plain note.
    expect(screen.getByText('hello')).toBeInTheDocument()
  })

  /**
   * A folder with nothing in it is not implied by any note's path, so the
   * sidebar only knows about it through the index's own folder list. It used
   * to be dropped outright on Windows — see `vaultRelativeDirs`.
   */
  it('shows a folder that has no notes in it', () => {
    useVaultStore.setState({ dirs: ['/vault/Empty folder'] })
    render(<TreePane />)
    expect(screen.getAllByText('Empty folder').length).toBeGreaterThan(0)
  })

  /**
   * Renaming a folder. Both halves of it: that the row turns into an input
   * when something asks it to, and that committing sends the folder the
   * operation that renames a folder rather than the one that renames a note.
   */
  it('renames a folder inline, through the folder operation', async () => {
    const renameFolder = vi.fn(async () => ({ ok: true as const, data: undefined }))
    installApiStub({ notes: { renameFolder } })
    useVaultStore.setState({ dirs: ['/vault/Untitled folder'] })
    render(<TreePane />)

    requestTreeInlineRenameFolder({ relPath: 'Untitled folder' })

    const input = await screen.findByDisplayValue('Untitled folder')
    fireEvent.change(input, { target: { value: 'Research' } })
    fireEvent.blur(input)

    await waitFor(() =>
      expect(renameFolder).toHaveBeenCalledWith('/vault/Untitled folder', 'Research')
    )
  })

  it('leaves a folder alone when the name is unchanged', async () => {
    const renameFolder = vi.fn(async () => ({ ok: true as const, data: undefined }))
    installApiStub({ notes: { renameFolder } })
    useVaultStore.setState({ dirs: ['/vault/Notes'] })
    render(<TreePane />)

    requestTreeInlineRenameFolder({ relPath: 'Notes' })
    const input = await screen.findByDisplayValue('Notes')
    fireEvent.blur(input)

    await waitFor(() => expect(screen.queryByDisplayValue('Notes')).not.toBeInTheDocument())
    expect(renameFolder).not.toHaveBeenCalled()
  })
})
