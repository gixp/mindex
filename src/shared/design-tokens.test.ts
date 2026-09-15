import { describe, expect, it } from 'vitest'
import { LAYERS } from './design-tokens'

/**
 * The ladder is only useful while it is a ladder.
 *
 * These do not check the numbers — those are a design decision and change on
 * purpose. They check the two properties a reader relies on when they pick a
 * rung by name: that the names are listed in the order they stack, and that no
 * two of them mean the same thing. Both are the kind of mistake a rename or a
 * copy-pasted line makes silently, and neither shows up until something is
 * drawn behind something else.
 */
describe('LAYERS', () => {
  const values = Object.values(LAYERS).map(Number)

  it('is listed in stacking order, so reading the file tells you what covers what', () => {
    expect(values).toEqual([...values].sort((a, b) => a - b))
  })

  it('gives every rung its own value', () => {
    // Two names on one number is a coin toss decided by which class the
    // stylesheet happens to emit last.
    expect(new Set(values).size).toBe(values.length)
  })

  it('is all whole numbers — a stacking value cannot be fractional', () => {
    for (const [name, raw] of Object.entries(LAYERS)) {
      expect(Number.isInteger(Number(raw)), name).toBe(true)
    }
  })
})
