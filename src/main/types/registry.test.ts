import { describe, it, expect } from 'vitest'
import { detectType, validateFrontmatter } from './registry'

describe('validateFrontmatter', () => {
  it('accepts a well-formed typed note', () => {
    const r = validateFrontmatter('project', {
      type: 'project',
      status: 'ACTIVE',
      priority: 'P1'
    })
    expect(r).toEqual({ ok: true, issues: [] })
  })

  it('reports the offending field for a bad enum value', () => {
    const r = validateFrontmatter('project', { type: 'project', status: 'active' })
    expect(r.ok).toBe(false)
    expect(r.issues).toHaveLength(1)
    expect(r.issues[0]).toMatch(/^status: /)
  })

  it('ignores properties the schema does not declare', () => {
    // Users add their own fields freely; only declared fields are checked.
    const r = validateFrontmatter('project', { type: 'project', myOwnField: 'whatever' })
    expect(r).toEqual({ ok: true, issues: [] })
  })

  it('accepts a YAML date where the schema declares a string', () => {
    // gray-matter parses an unquoted `deadline: 2026-01-01` into a Date. Every
    // date-ish field is declared as a string, so without normalisation this is
    // a false alarm on most projects in a vault.
    const r = validateFrontmatter('project', {
      type: 'project',
      deadline: new Date('2026-01-01T00:00:00.000Z')
    })
    expect(r).toEqual({ ok: true, issues: [] })
  })

  it('accepts anything for an untyped note', () => {
    const r = validateFrontmatter('untyped', { whatever: 1 })
    expect(r).toEqual({ ok: true, issues: [] })
  })
})

describe('detectType', () => {
  it('prefers an explicit type field', () => {
    expect(detectType({ type: 'person' }, 'Anywhere/x.md')).toBe('person')
  })

  it('falls back to the default folder when no type is declared', () => {
    expect(detectType({}, 'Projects/x.md')).toBe('project')
    expect(detectType({}, 'Finance/Payments/x.md')).toBe('payment')
  })

  it('returns untyped for a folder no type claims', () => {
    expect(detectType({}, 'Random/x.md')).toBe('untyped')
  })

  it('returns untyped for an unrecognised type and path', () => {
    expect(detectType({ type: 'not-a-real-type' }, 'x.md')).toBe('untyped')
  })
})
