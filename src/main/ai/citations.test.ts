import { describe, it, expect } from 'vitest'
import { lineAt, locateQuote, resolveCitations } from './citations'

const BODY = [
  '# Pricing', // line 1
  '', // 2
  'The plan is five dollars a month.', // 3
  'It renews on the first.', // 4
  '', // 5
  'The plan is five dollars a month.', // 6 — a deliberate repeat
  'Contact: ann@example.com', // 7
  ''
].join('\n')

describe('lineAt', () => {
  it('is 1 at or before the start', () => {
    expect(lineAt(BODY, 0)).toBe(1)
    expect(lineAt(BODY, -5)).toBe(1)
  })
  it('counts newlines up to the offset', () => {
    expect(lineAt(BODY, BODY.indexOf('five dollars'))).toBe(3)
    expect(lineAt(BODY, BODY.indexOf('ann@example.com'))).toBe(7)
  })
  it('clamps past the end', () => {
    expect(lineAt(BODY, BODY.length + 100)).toBe(8)
  })
})

describe('locateQuote', () => {
  it('finds a verbatim single-line quote', () => {
    expect(locateQuote(BODY, 'It renews on the first.')).toEqual({ lineStart: 4, lineEnd: 4 })
  })

  it('takes the first occurrence when a quote repeats', () => {
    expect(locateQuote(BODY, 'The plan is five dollars a month.')).toEqual({
      lineStart: 3,
      lineEnd: 3
    })
  })

  it('spans the lines a multi-line quote covers', () => {
    const quote = 'five dollars a month.\nIt renews on the first.'
    expect(locateQuote(BODY, quote)).toEqual({ lineStart: 3, lineEnd: 4 })
  })

  it('matches when the model reflowed the inner whitespace', () => {
    const quote = 'The plan   is five dollars\n a month.'
    expect(locateQuote(BODY, quote)).toEqual({ lineStart: 3, lineEnd: 3 })
  })

  it('returns null for a passage that is not there', () => {
    expect(locateQuote(BODY, 'The plan is ten dollars a month.')).toBeNull()
  })

  it('returns null for an empty or whitespace quote', () => {
    expect(locateQuote(BODY, '')).toBeNull()
    expect(locateQuote(BODY, '   \n  ')).toBeNull()
  })
})

describe('resolveCitations', () => {
  const bodies = new Map([['Pricing.md', BODY]])

  it('attaches a line range when the quote is found', () => {
    const out = resolveCitations([{ path: 'Pricing.md', quote: 'It renews on the first.' }], bodies)
    expect(out).toEqual([
      { path: 'Pricing.md', quote: 'It renews on the first.', lineStart: 4, lineEnd: 4 }
    ])
  })

  it('keeps a citation with no range when the quote is gone', () => {
    const out = resolveCitations([{ path: 'Pricing.md', quote: 'nowhere in the note' }], bodies)
    expect(out).toEqual([{ path: 'Pricing.md', quote: 'nowhere in the note' }])
  })

  it('keeps a citation with no range when the path is unknown', () => {
    const out = resolveCitations([{ path: 'Missing.md', quote: 'anything' }], bodies)
    expect(out).toEqual([{ path: 'Missing.md', quote: 'anything' }])
  })

  it('de-duplicates identical path+quote pairs', () => {
    const out = resolveCitations(
      [
        { path: 'Pricing.md', quote: 'It renews on the first.' },
        { path: 'Pricing.md', quote: 'It renews on the first.' }
      ],
      bodies
    )
    expect(out).toHaveLength(1)
  })
})
