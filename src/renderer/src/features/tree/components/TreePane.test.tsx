// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@/test/setup'
import { installApiStub } from '@/test/apiStub'
import { useVaultStore } from '@/platform/workspace'
import type { NoteMeta } from '@shared/types'
import { TreePane } from './TreePane'

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
})
