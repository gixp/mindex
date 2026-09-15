import { describe, expect, it } from 'vitest'
import { searchEntries, type SettingGroup } from './declare'

interface Shape {
  showDates?: boolean
  showIcons?: boolean
  showFolders?: boolean
  position?: string
}

const GROUP: SettingGroup<Shape> = {
  title: 'Appearance',
  alsoFoundBy: 'tree',
  rows: [
    {
      kind: 'toggle',
      label: 'Date',
      field: 'showDates',
      icon: 'history',
      hint: 'Adds a timestamp to every row.'
    },
    {
      kind: 'choice',
      label: 'Position',
      field: 'position',
      whenUnset: 'inline',
      options: [
        { value: 'inline', icon: 'a', label: 'Same line' },
        { value: 'below', icon: 'b', label: 'Below' }
      ]
    },
    {
      kind: 'tiles',
      label: 'Icons',
      items: [
        { field: 'showIcons', icon: 'file', label: 'Files', hint: 'Icon on file rows.' },
        { field: 'showFolders', icon: 'folder', label: 'Folders', hint: 'Icon on folder rows.' }
      ]
    }
  ]
}

/**
 * The index used to be a second list kept in step by remembering. These check
 * the properties that made deriving it worth doing at all.
 */
describe('searchEntries', () => {
  const entries = searchEntries('sidebar-left', GROUP)

  it('gives every setting its own result, tiles included', () => {
    // One entry per card would land someone searching "wrap titles" on a
    // result labelled "Appearance", leaving them to find it again.
    expect(entries.map((e) => e.label)).toEqual(['Date', 'Position', 'Files', 'Folders'])
  })

  it('makes a setting findable by its hint, not only its label', () => {
    // The load-bearing case: the hints are the only place these are described
    // in words a person would type. "Date" is not findable by "timestamp".
    const date = entries.find((e) => e.label === 'Date')
    expect(date?.terms).toContain('timestamp')
  })

  it('carries the group title and its extra words onto every row', () => {
    for (const e of entries) {
      expect(e.terms).toContain('appearance')
      expect(e.terms).toContain('tree')
    }
  })

  it('makes a choice findable by its options', () => {
    const position = entries.find((e) => e.label === 'Position')
    expect(position?.terms).toContain('same line')
    expect(position?.terms).toContain('below')
  })

  it('lowercases and strips punctuation, since the query is matched raw', () => {
    // `terms.includes(q)` against a lowercased query — a stray capital or a
    // full stop in a hint would make that word unmatchable.
    for (const e of entries) {
      expect(e.terms).toBe(e.terms.toLowerCase())
      expect(e.terms).not.toMatch(/[.,()]/)
    }
  })

  it('carries the section through, so a result knows where to go', () => {
    expect(entries.every((e) => e.section === 'sidebar-left')).toBe(true)
  })
})
