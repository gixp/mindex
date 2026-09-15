import { describe, expect, it } from 'vitest'
import { flattenPurpose, summarizePurpose } from './purpose-summary'

describe('summarizePurpose', () => {
  it('is empty when there is nothing written', () => {
    expect(summarizePurpose('')).toBe('')
    expect(summarizePurpose(undefined)).toBe('')
    expect(summarizePurpose(null)).toBe('')
  })

  it('flattens a bullet list into one running line', () => {
    expect(summarizePurpose('- Client work\n- Invoices\n- Contracts')).toBe(
      'Client work Invoices Contracts'
    )
  })

  it('drops the markdown that would read as noise inline', () => {
    expect(summarizePurpose('Notes on **deep work** and `focus`, see [the book](/b.md).')).toBe(
      'Notes on deep work and focus, see the book.'
    )
  })

  it('prefers a wikilink’s alias over its target', () => {
    expect(summarizePurpose('Everything about [[projects/atlas|Atlas]].')).toBe(
      'Everything about Atlas.'
    )
  })

  it('cuts a long purpose on a word boundary', () => {
    const long = 'word '.repeat(80).trim()
    const out = summarizePurpose(long)
    expect(out.endsWith('…')).toBe(true)
    expect(out.length).toBeLessThanOrEqual(151)
    expect(out).not.toContain('wor…')
  })

  it('does not leave a dangling comma before the ellipsis', () => {
    const long = `${'a'.repeat(140)}, ${'b'.repeat(40)}`
    expect(summarizePurpose(long)).not.toContain(',…')
  })
})

describe('flattenPurpose', () => {
  it('keeps the whole text, unlike the card version', () => {
    const long = 'word '.repeat(80).trim()
    expect(flattenPurpose(long)).toBe(long)
    expect(flattenPurpose(long).endsWith('…')).toBe(false)
  })

  it('still strips markup and joins lines', () => {
    // The heading itself never reaches here — the context parser has already
    // taken `## Purpose` off and handed over only what was under it — so the
    // markers this has to deal with are the ones inside the body.
    expect(flattenPurpose('- **Client** work\n- Invoices, _quarterly_')).toBe(
      'Client work Invoices, quarterly'
    )
  })
})
