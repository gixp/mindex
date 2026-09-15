import { describe, it, expect } from 'vitest'
import { asToggle } from './toggle-option'
import type { AcpConfigOption } from '@shared/acp'

const option = (over: Partial<AcpConfigOption>): AcpConfigOption => ({
  id: 'fast',
  label: 'Fast mode',
  type: 'select',
  values: [],
  ...over
})

describe('asToggle', () => {
  it('recognises the shape Claude actually reports', () => {
    // Not `type: 'boolean'` — an ordinary choice between two values named on
    // and off. Keying off the type alone caught nothing, and the setting kept
    // rendering as two rows to pick between.
    const t = asToggle(
      option({
        currentValue: 'off',
        values: [
          { value: 'on', label: 'On' },
          { value: 'off', label: 'Off' }
        ]
      })
    )
    expect(t).toEqual({ id: 'fast', label: 'Fast mode', on: false, next: 'on' })
  })

  it('reads the on state and offers the way back', () => {
    const t = asToggle(
      option({
        currentValue: 'on',
        values: [
          { value: 'on', label: 'On' },
          { value: 'off', label: 'Off' }
        ]
      })
    )
    expect(t).toMatchObject({ on: true, next: 'off' })
  })

  it('handles a declared boolean, and sends a real boolean back', () => {
    const t = asToggle(option({ type: 'boolean', currentValue: true, values: [] }))
    expect(t).toEqual({ id: 'fast', label: 'Fast mode', on: true, next: false })
  })

  it('takes the other spellings of the same idea', () => {
    for (const [a, b] of [
      ['true', 'false'],
      ['enabled', 'disabled'],
      ['yes', 'no']
    ]) {
      const t = asToggle(
        option({
          currentValue: b,
          values: [
            { value: a!, label: a! },
            { value: b!, label: b! }
          ]
        })
      )
      expect(t).toMatchObject({ on: false, next: a })
    }
  })

  it('leaves a genuine either/or as a list', () => {
    // Two values, but a choice rather than a switch — it has no off.
    expect(
      asToggle(
        option({
          id: 'collaboration_mode',
          currentValue: 'plan',
          values: [
            { value: 'plan', label: 'Plan first' },
            { value: 'direct', label: 'Work directly' }
          ]
        })
      )
    ).toBeNull()
  })

  it('leaves anything with more than two values alone', () => {
    expect(
      asToggle(
        option({
          values: [
            { value: 'on', label: 'On' },
            { value: 'off', label: 'Off' },
            { value: 'auto', label: 'Auto' }
          ]
        })
      )
    ).toBeNull()
  })
})
