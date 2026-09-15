import { describe, it, expect } from 'vitest'
import type { Frontmatter, NoteMeta, NoteTypeId } from '@shared/types'
import { filterNotes } from './filter'

function note(
  relPath: string,
  opts: { type?: NoteTypeId; title?: string; fm?: Frontmatter; tags?: string[] } = {}
): NoteMeta {
  const base = (relPath.split('/').pop() ?? relPath).replace(/\.md$/, '')
  return {
    path: `/v/${relPath}`,
    relPath,
    title: opts.title ?? base,
    type: opts.type ?? 'untyped',
    frontmatter: opts.fm ?? {},
    tags: opts.tags ?? [],
    outgoingLinks: [],
    mtime: 0,
    size: 0,
    isDirectory: false
  }
}

const ACME = note('Organizations/Acme.md', { type: 'organization', title: 'Acme' })
const GLOBEX = note('Organizations/Globex.md', { type: 'organization', title: 'Globex' })

function names(notes: NoteMeta[]): string[] {
  return notes.map((n) => n.title).sort()
}

describe('scalar filters', () => {
  const notes = [
    note('a.md', { type: 'project', title: 'A', fm: { status: 'ACTIVE', budget: 100 } }),
    note('b.md', { type: 'project', title: 'B', fm: { status: 'DONE', budget: 900 } }),
    note('c.md', { type: 'project', title: 'C', fm: { status: 'PLANNING' } })
  ]

  it('returns everything when the expression holds no filters', () => {
    expect(filterNotes(notes, '')).toHaveLength(3)
    expect(filterNotes(notes, 'nonsense without a colon')).toHaveLength(3)
  })

  it('combines filters with and', () => {
    expect(names(filterNotes(notes, 'type:project status:ACTIVE'))).toEqual(['A'])
  })

  it('reads a comma list as any-of', () => {
    expect(names(filterNotes(notes, 'status:ACTIVE,PLANNING'))).toEqual(['A', 'C'])
  })

  it('reads a negated comma list as none-of', () => {
    expect(names(filterNotes(notes, 'status:!=DONE,PLANNING'))).toEqual(['A'])
  })

  it('compares numerically when both sides are numbers', () => {
    // Lexically "900" < "100" is false but "9" > "1", so a string comparison
    // would answer this one correctly by accident; 100 vs 90 would not.
    expect(names(filterNotes(notes, 'budget:>90'))).toEqual(['A', 'B'])
  })

  it('tests presence with * and absence with !*', () => {
    expect(names(filterNotes(notes, 'budget:*'))).toEqual(['A', 'B'])
    expect(names(filterNotes(notes, 'budget:!*'))).toEqual(['C'])
  })

  it('counts a blank string as absent', () => {
    const blank = [note('d.md', { title: 'D', fm: { area: '' } })]
    expect(names(filterNotes(blank, 'area:!*'))).toEqual(['D'])
    expect(filterNotes(blank, 'area:*')).toHaveLength(0)
  })

  it('matches a tag against the list, and ~ against part of a value', () => {
    const tagged = [note('e.md', { title: 'E', tags: ['finance', 'q1'] })]
    expect(filterNotes(tagged, 'tag:finance')).toHaveLength(1)
    expect(filterNotes(tagged, 'tag:&finance,q1')).toHaveLength(1)
    expect(filterNotes(tagged, 'tag:&finance,q2')).toHaveLength(0)
    expect(filterNotes(tagged, 'title:~e')).toHaveLength(1)
  })

  it('keeps a quoted value whole, spaces and commas included', () => {
    const quoted = [note('f.md', { title: 'F', fm: { company: 'Acme, Inc' } })]
    expect(filterNotes(quoted, 'company:"Acme, Inc"')).toHaveLength(1)
    // Unquoted, the comma is a list separator — neither half matches alone.
    expect(filterNotes(quoted, 'company:Acme,Inc')).toHaveLength(0)
  })
})

describe('relationship filters', () => {
  it('matches a declared relation written without brackets', () => {
    const p = note('Projects/P.md', { type: 'project', title: 'P', fm: { company: 'Acme' } })
    expect(names(filterNotes([ACME, p], 'type:project company:Acme'))).toEqual(['P'])
  })

  it('matches whichever way either side names the note', () => {
    const p = note('Projects/P.md', { type: 'project', title: 'P', fm: { company: '[[Acme]]' } })
    const notes = [ACME, GLOBEX, p]
    for (const expr of [
      'company:Acme',
      'company:[[Acme]]',
      'company:acme',
      'company:Acme.md',
      'company:Organizations/Acme',
      'company:"Organizations/Acme.md"'
    ]) {
      expect(names(filterNotes(notes, `type:project ${expr}`)), expr).toEqual(['P'])
    }
  })

  it('does not match a different note that merely sits nearby', () => {
    const p = note('Projects/P.md', { type: 'project', title: 'P', fm: { company: '[[Acme]]' } })
    expect(filterNotes([ACME, GLOBEX, p], 'type:project company:Globex')).toHaveLength(0)
  })

  it('treats a bracketed value as a relation even on an untyped note', () => {
    // No schema declares `owner`, but the brackets say what was meant.
    const n = note('n.md', { title: 'N', fm: { owner: '[[Acme|the client]]' } })
    expect(names(filterNotes([ACME, n], 'owner:Acme'))).toEqual(['N'])
  })

  it('leaves a plain string on an undeclared key as plain text', () => {
    // `area` is not a relation, so this must stay an exact-string comparison
    // and never resolve to a note.
    const n = note('n.md', { title: 'N', fm: { area: 'Acme' } })
    expect(filterNotes([ACME, n], 'area:Organizations/Acme')).toHaveLength(0)
    expect(filterNotes([ACME, n], 'area:Acme')).toHaveLength(1)
  })

  it('resolves each entry of a list relation', () => {
    const d = note('Calls/D.md', {
      type: 'call-debrief',
      title: 'D',
      fm: { participants: ['[[Ann]]', 'Bob'] }
    })
    const ann = note('People/Ann.md', { type: 'person', title: 'Ann' })
    const notes = [ann, d]
    expect(names(filterNotes(notes, 'participants:Ann'))).toEqual(['D'])
    expect(names(filterNotes(notes, 'participants:Bob'))).toEqual(['D'])
    expect(names(filterNotes(notes, 'participants:Ann,Carol'))).toEqual(['D'])
    expect(names(filterNotes(notes, 'participants:&Ann,Bob'))).toEqual(['D'])
    expect(filterNotes(notes, 'participants:&Ann,Carol')).toHaveLength(0)
    expect(filterNotes(notes, 'participants:!=Ann')).toHaveLength(1) // only Ann's own note
  })

  it('still compares two dead links to the same missing note as equal', () => {
    const p = note('Projects/P.md', { type: 'project', title: 'P', fm: { company: '[[Nowhere]]' } })
    expect(names(filterNotes([p], 'company:Nowhere'))).toEqual(['P'])
  })

  it('tests an empty relation with * and !*', () => {
    const withCo = note('Projects/P.md', {
      type: 'project',
      title: 'P',
      fm: { company: '[[Acme]]' }
    })
    const blank = note('Projects/Q.md', { type: 'project', title: 'Q', fm: { company: '' } })
    const missing = note('Projects/R.md', { type: 'project', title: 'R' })
    const notes = [ACME, withCo, blank, missing]
    expect(names(filterNotes(notes, 'type:project company:*'))).toEqual(['P'])
    expect(names(filterNotes(notes, 'type:project company:!*'))).toEqual(['Q', 'R'])
  })

  it('keeps ~ textual, so a half-remembered name still finds the link', () => {
    const p = note('Projects/P.md', { type: 'project', title: 'P', fm: { company: '[[Acme]]' } })
    expect(names(filterNotes([ACME, p], 'type:project company:~acm'))).toEqual(['P'])
  })
})
