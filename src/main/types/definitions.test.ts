import { describe, it, expect } from 'vitest'
import type { NoteTypeDef } from '@shared/note-types'
import { builtinDef, fieldsFromSpec, validateAgainstDef } from './definitions'
import { specOrUntyped } from './registry'

describe('fieldsFromSpec', () => {
  it('reads the enum values off the schema rather than a second list', () => {
    const fields = fieldsFromSpec(specOrUntyped('project'))
    const status = fields.find((f) => f.name === 'status')
    expect(status?.kind).toBe('select')
    expect(status?.options).toEqual([
      'ACTIVE',
      'PLANNING',
      'PAUSED',
      'DONE',
      'CANCELLED',
      'ARCHIVED'
    ])
  })

  it('never surfaces the fields Mindex owns', () => {
    const names = fieldsFromSpec(specOrUntyped('project')).map((f) => f.name)
    expect(names).not.toContain('type')
    expect(names).not.toContain('id')
    expect(names).not.toContain('tags')
  })

  it('marks a declared relation as a link, not as text', () => {
    // `company` is a plain z.string() — only `relations` on the spec says it
    // points at another note.
    const company = fieldsFromSpec(specOrUntyped('project')).find((f) => f.name === 'company')
    expect(company?.kind).toBe('relation')
    expect(company?.relationTo).toBe('organization')
  })

  it('reads numbers, booleans and lists apart from strings', () => {
    const goal = fieldsFromSpec(specOrUntyped('goal'))
    expect(goal.find((f) => f.name === 'target')?.kind).toBe('number')
    expect(goal.find((f) => f.name === 'auto_compute')?.kind).toBe('boolean')
    expect(
      fieldsFromSpec(specOrUntyped('call-debrief')).find((f) => f.name === 'participants')?.kind
    ).toBe('relation')
    expect(
      fieldsFromSpec(specOrUntyped('call-transcript')).find((f) => f.name === 'language')?.kind
    ).toBe('text')
  })

  it('calls a date field a date even though the schema says string', () => {
    // Declared z.string() on purpose — YAML hands back a Date for an unquoted
    // value, so the schema cannot be the one to tell them apart.
    expect(fieldsFromSpec(specOrUntyped('project')).find((f) => f.name === 'deadline')?.kind).toBe(
      'date'
    )
    expect(
      fieldsFromSpec(specOrUntyped('payment')).find((f) => f.name === 'receivedAt')?.kind
    ).toBe('date')
  })

  it('treats an optional field as not required', () => {
    expect(fieldsFromSpec(specOrUntyped('project')).every((f) => !f.required)).toBe(true)
  })
})

describe('builtinDef', () => {
  it('carries the template and reports where it came from', () => {
    const def = builtinDef('project')
    expect(def.origin).toBe('mindex')
    expect(def.overridden).toBe(false)
    expect(def.template).toContain('type: project')
    expect(def.defaultFolder).toBe('Projects')
  })
})

describe('validateAgainstDef', () => {
  const def: NoteTypeDef = {
    ...builtinDef('project'),
    fields: [
      { name: 'status', label: 'Status', kind: 'select', required: true, options: ['A', 'B'] },
      { name: 'budget', label: 'Budget', kind: 'number', required: false },
      { name: 'active', label: 'Active', kind: 'boolean', required: false },
      { name: 'people', label: 'People', kind: 'list', required: false },
      { name: 'free', label: 'Free', kind: 'select', required: false }
    ]
  }

  it('accepts a note that matches', () => {
    expect(validateAgainstDef(def, { status: 'A', budget: 10 })).toEqual({ ok: true, issues: [] })
  })

  it('names the allowed values when a choice is wrong', () => {
    const r = validateAgainstDef(def, { status: 'C' })
    expect(r.ok).toBe(false)
    expect(r.issues[0]).toContain('not one of A, B')
  })

  it('reports a required field only when it is actually absent', () => {
    expect(validateAgainstDef(def, {}).issues).toEqual(['status: required'])
    expect(validateAgainstDef(def, { status: '' }).issues).toEqual(['status: required'])
  })

  it('checks the shape of numbers, toggles and lists', () => {
    const r = validateAgainstDef(def, { status: 'A', budget: 'lots', active: 'yes', people: 'Ann' })
    expect(r.issues).toEqual([
      'budget: expected a number',
      'active: expected true or false',
      'people: expected a list'
    ])
  })

  it('leaves a choice with no declared values alone', () => {
    // A half-configured field must not light up every note in the vault.
    expect(validateAgainstDef(def, { status: 'A', free: 'anything' }).ok).toBe(true)
  })

  it('says nothing about fields the definition does not mention', () => {
    // Mindex is markdown-first: an unknown key is the user's business.
    expect(validateAgainstDef(def, { status: 'A', whatever: 1 }).ok).toBe(true)
  })
})
