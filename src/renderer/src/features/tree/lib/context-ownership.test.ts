import { describe, it, expect } from 'vitest'
import type { ContextOverview, ContextStaleness, FolderContextMetrics } from '@shared/suggestions'
import type { FolderStatusEntry, FolderSyncStatus } from '@shared/types'
import { ownedContextWork } from '@/features/tree/lib/context-ownership'

function metrics(folderRel: string, staleness: ContextStaleness): FolderContextMetrics {
  return {
    folderRel,
    hasContextFile: staleness !== 'missing',
    aiDisabled: false,
    contextBytes: 0,
    contextTokensApprox: 0,
    purpose: '',
    noteCount: 1,
    noteBytes: 10,
    staleness
  }
}

function overviewOf(folders: FolderContextMetrics[]): ContextOverview {
  return {
    root: { hasContextFile: true, bytes: 0, tokensApprox: 0, excerpt: '', purpose: '' },
    folders,
    totals: {
      folders: folders.length,
      withContext: 0,
      contextBytes: 0,
      contextTokensApprox: 0,
      notes: 0,
      noteBytes: 0
    },
    builtAt: 0
  }
}

function statuses(entries: Record<string, FolderSyncStatus>): Record<string, FolderStatusEntry> {
  const out: Record<string, FolderStatusEntry> = {}
  for (const [folderRel, status] of Object.entries(entries)) {
    out[folderRel] = { folderRel, status }
  }
  return out
}

// Projects/ holds two stale subfolders; Archive/ is fine.
const OVERVIEW = overviewOf([
  metrics('Projects', 'fresh'),
  metrics('Projects/Alpha', 'behind'),
  metrics('Projects/Beta', 'behind'),
  metrics('Projects/Beta/Deep', 'missing'),
  metrics('Archive', 'fresh')
])

describe('ownedContextWork', () => {
  it('gives an expanded folder only its own work', () => {
    // Alpha and Beta each have a row of their own on screen; Projects must not
    // repeat them, which is what produced the old disabled button.
    expect(ownedContextWork('Projects', false, {}, OVERVIEW)).toEqual({
      running: [],
      failed: [],
      stale: [],
      missing: []
    })
  })

  it('gives a visible stale folder its own button', () => {
    const owned = ownedContextWork('Projects/Alpha', false, {}, OVERVIEW)
    expect(owned.stale).toEqual(['Projects/Alpha'])
  })

  it('hands a collapsed folder everything beneath it', () => {
    const owned = ownedContextWork('Projects', true, {}, OVERVIEW)
    expect(owned.stale).toEqual(['Projects/Alpha', 'Projects/Beta'])
    expect(owned.missing).toEqual(['Projects/Beta/Deep'])
  })

  it('stops at the first collapsed ancestor, so exactly one row claims a folder', () => {
    // Projects expanded, Beta collapsed: Beta owns Deep, Projects does not.
    const projects = ownedContextWork('Projects', false, {}, OVERVIEW)
    const beta = ownedContextWork('Projects/Beta', true, {}, OVERVIEW)
    expect(projects.missing).toEqual([])
    expect(beta.stale).toEqual(['Projects/Beta'])
    expect(beta.missing).toEqual(['Projects/Beta/Deep'])
  })

  it('does not reach across a sibling with a shared name prefix', () => {
    // "Projects" must not swallow "Projects Archive" — the boundary is a
    // path separator, not a string prefix.
    const overview = overviewOf([
      metrics('Projects', 'fresh'),
      metrics('Projects Archive', 'behind')
    ])
    expect(ownedContextWork('Projects', true, {}, overview).stale).toEqual([])
  })

  it('sorts a live pending status and disk staleness into the same bucket', () => {
    // A folder touched this session is only known to `byFolder`; one that went
    // stale while the app was closed is only known to the overview.
    const owned = ownedContextWork(
      'Projects',
      true,
      statuses({ 'Projects/Gamma': 'pending' }),
      OVERVIEW
    )
    expect(owned.stale).toEqual(['Projects/Alpha', 'Projects/Beta', 'Projects/Gamma'])
  })

  it('lets running and failed win over stale for the same folder', () => {
    const byFolder = statuses({ 'Projects/Alpha': 'running', 'Projects/Beta': 'failed' })
    const owned = ownedContextWork('Projects', true, byFolder, OVERVIEW)
    expect(owned.running).toEqual(['Projects/Alpha'])
    expect(owned.failed).toEqual(['Projects/Beta'])
    expect(owned.stale).toEqual([])
  })

  it('leaves a folder excluded from context alone', () => {
    const excluded = metrics('Vendor', 'missing')
    excluded.aiDisabled = true
    const owned = ownedContextWork('Vendor', false, {}, overviewOf([excluded]))
    expect(owned.missing).toEqual([])
  })

  it('finds nothing when the overview has not loaded yet', () => {
    expect(ownedContextWork('Projects', true, {}, null)).toEqual({
      running: [],
      failed: [],
      stale: [],
      missing: []
    })
  })
})
