import { describe, expect, it } from 'vitest'
import { modeIconFor } from './mode-vocabulary'

describe('modeIconFor', () => {
  it('tells one assistant’s six modes apart', () => {
    const icons = [
      modeIconFor('default', 'Manual'),
      modeIconFor('acceptEdits', 'Accept Edits'),
      modeIconFor('plan', 'Plan'),
      modeIconFor('auto', 'Auto'),
      modeIconFor('dontAsk', "Don't Ask"),
      modeIconFor('bypassPermissions', 'Bypass Permissions')
    ]
    expect(new Set(icons).size).toBe(icons.length)
  })

  it('tells another assistant’s three apart, in its own words', () => {
    // The point of the exercise: these used to fall to one neutral icon each,
    // so three different modes looked identical.
    const ask = modeIconFor('ask', 'Ask for approval')
    const approve = modeIconFor('approve', 'Approve for me')
    const full = modeIconFor('full-access', 'Full access')
    expect(new Set([ask, approve, full]).size).toBe(3)
    expect(full).toBe('rocket')
  })

  it('tells a third assistant’s apart too', () => {
    const icons = [
      modeIconFor('default', 'Default'),
      modeIconFor('autoEdit', 'Auto Edit'),
      modeIconFor('yolo', 'YOLO')
    ]
    expect(new Set(icons).size).toBe(3)
    expect(modeIconFor('yolo', 'YOLO')).toBe('rocket')
  })

  it('reads a name written as one word', () => {
    expect(modeIconFor('acceptEdits')).toBe('edit')
    expect(modeIconFor('bypass_permissions')).toBe('rocket')
  })

  it('prefers the narrower reading when two could apply', () => {
    // "Auto edit" both edits and is automatic. It is the editing one.
    expect(modeIconFor('autoEdit', 'Auto Edit')).toBe('edit')
  })

  it('does not mistake a longer word for the whole word', () => {
    expect(modeIconFor('autocomplete', 'Autocomplete')).not.toBe('zap')
  })

  it('admits when it recognises nothing', () => {
    expect(modeIconFor('zx9', 'Zx9')).toBeNull()
  })
})

describe('asking is always a hand', () => {
  it('whatever words the assistant wraps it in', () => {
    // The one the user pointed at: a mode whose whole job is to stop and ask
    // must not be drawn as the one that edits without asking.
    for (const [id, label] of [
      ['ask', 'Ask for approval'],
      ['approval', 'Ask for approval'],
      ['ask-for-approval', 'Ask for approval'],
      ['default', 'Manual'],
      ['suggest', 'Suggest']
    ] as const) {
      expect(modeIconFor(id, label)).toBe('hand')
    }
  })

  it('but approving in advance is not asking', () => {
    expect(modeIconFor('approve', 'Approve for me')).toBe('edit')
  })
})
