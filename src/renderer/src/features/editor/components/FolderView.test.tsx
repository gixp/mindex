// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@/test/setup'
import { installApiStub } from '@/test/apiStub'
import { useVaultStore } from '@/platform/workspace'
import type { NoteMeta } from '@shared/types'
import { FolderView } from './FolderView'

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

describe('FolderView', () => {
  it('renders a card for a note at the root folder', () => {
    // '' is the root folder — findFolderNode('') returns the tree root
    // itself, so this doesn't depend on a specific subfolder existing.
    render(<FolderView folderRel="" />)
    expect(screen.getByText('hello')).toBeInTheDocument()
  })
})
