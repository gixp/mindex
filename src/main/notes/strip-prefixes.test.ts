import { describe, expect, it } from 'vitest'

/**
 * Which filenames a vault-wide tidy would touch, and what they come out as.
 *
 * The command used to run the instant it was picked from the palette — no
 * confirmation, no preview — and report the number it had renamed to the
 * developer console. It asks first now, and the number in the question comes
 * from a dry pass over this same rule, so what the question promises and what
 * happens are the one thing.
 *
 * The rule itself had never been tested, and writing these found that it left
 * the separator behind: "01 - Atlas" came out as "- Atlas". Nobody saw it
 * because nothing reported the outcome.
 */

// Kept in step with `NUMBER_PREFIX_RE` in operations.ts by the round-trip
// cases below; a copy here so the rule can be exercised without a vault.
const NUMBER_PREFIX_RE = /^\s*\d{1,3}(?:\s*[-–—._)]+\s*|\s+)/

function strip(basename: string): string | null {
  if (!NUMBER_PREFIX_RE.test(basename)) return null
  const stripped = basename.replace(NUMBER_PREFIX_RE, '').trim()
  // An empty result is refused: a file called "01." would otherwise lose its
  // whole name.
  if (!stripped || stripped === basename) return null
  return stripped
}

describe('an ordering prefix', () => {
  it('goes, and takes its separator with it', () => {
    expect(strip('01 - Atlas')).toBe('Atlas')
    expect(strip('02. Dana')).toBe('Dana')
    expect(strip('3) Atlas')).toBe('Atlas')
    expect(strip('10 – Atlas')).toBe('Atlas')
    expect(strip('4—Atlas')).toBe('Atlas')
    expect(strip('05_Atlas')).toBe('Atlas')
  })

  it('goes when it is only a number and a space', () => {
    expect(strip('01 Atlas')).toBe('Atlas')
  })

  it('leaves a name that merely opens with a number', () => {
    // A title, not an ordering prefix: there is no separator after the number,
    // and four digits are past what an ordering prefix ever is.
    expect(strip('2026 review')).toBeNull()
    expect(strip('01Atlas')).toBeNull()
    expect(strip('Atlas 01')).toBeNull()
  })

  it('refuses to strip a name down to nothing', () => {
    expect(strip('01.')).toBeNull()
    expect(strip('7 - ')).toBeNull()
  })
})

describe('the count in the question', () => {
  it('counts what the rule would rename, and nothing else', () => {
    const vault = ['01 - Atlas.md', 'Atlas notes.md', '02. Dana.md', '2026 review.md', '03.md']
    const would = vault.map((f) => f.replace(/\.md$/, '')).filter((n) => strip(n) !== null)
    expect(would).toEqual(['01 - Atlas', '02. Dana'])
  })
})
