import { describe, expect, it } from 'vitest'
import { snippetFor } from './snippet'

const LONG = 'lorem ipsum dolor sit amet '.repeat(40)

describe('snippetFor', () => {
  it('returns a short note whole, with whitespace flattened', () => {
    expect(snippetFor('# Acme\n\nA client\tsince 2024.\n', 'acme')).toBe(
      '# Acme A client since 2024.'
    )
  })

  it('centres the window on the first matching term', () => {
    const body = `${LONG} the quick brownfox jumped ${LONG}`
    const snippet = snippetFor(body, 'brownfox')
    expect(snippet).toContain('brownfox')
    expect(snippet.startsWith('…')).toBe(true)
    expect(snippet.endsWith('…')).toBe(true)
  })

  it('picks the earliest of several matching terms', () => {
    const body = `alpha ${LONG} omega ${LONG}`
    expect(snippetFor(body, 'omega alpha')).toContain('alpha')
  })

  it('falls back to the opening when nothing literally matches', () => {
    // A fuzzy or prefix hit matches a form of the word that is not in the text.
    const snippet = snippetFor(LONG, 'zzzz')
    expect(snippet.startsWith('lorem ipsum')).toBe(true)
    expect(snippet.endsWith('…')).toBe(true)
  })

  it('ignores one-character noise in the query', () => {
    const body = `${LONG} needle ${LONG}`
    expect(snippetFor(body, 'a needle')).toContain('needle')
  })

  it('never runs away with a long body', () => {
    expect(snippetFor(LONG, 'dolor').length).toBeLessThanOrEqual(340)
  })
})
