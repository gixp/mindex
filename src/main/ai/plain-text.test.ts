import { describe, it, expect } from 'vitest'
import { projectPlain, toSourceRange } from './plain-text'

/** Locate `quote` in the plain view and give back the real source range. */
function locate(source: string, quote: string): string | null {
  const p = projectPlain(source)
  const at = p.text.indexOf(quote)
  if (at === -1) return null
  const range = toSourceRange(p, at, at + quote.length, source)
  return range ? source.slice(range.start, range.end) : null
}

describe('projectPlain', () => {
  it('drops emphasis but keeps the words', () => {
    expect(projectPlain('the plan is **five dollars** a month').text).toBe(
      'the plan is five dollars a month'
    )
  })

  it('drops heading marks, bullets, numbers and quote marks', () => {
    const src = '## Pricing\n- one\n2. two\n> quoted\n'
    expect(projectPlain(src).text).toBe('Pricing\none\ntwo\nquoted\n')
  })

  it('drops a task box', () => {
    expect(projectPlain('- [ ] call Ann\n').text).toBe('call Ann\n')
  })

  it('keeps a link’s words and drops its target', () => {
    expect(projectPlain('see [the docs](https://example.com) now').text).toBe('see the docs now')
  })

  it('drops an image entirely', () => {
    expect(projectPlain('a ![alt text](pic.png) b').text).toBe('a  b')
  })

  it('shows a wikilink the way the editor does', () => {
    expect(projectPlain('see [[Pricing]]').text).toBe('see Pricing')
    expect(projectPlain('see [[Pricing|our prices]]').text).toBe('see our prices')
  })

  it('unescapes a protected character', () => {
    expect(projectPlain('a \\* b').text).toBe('a * b')
  })

  it('leaves plain text exactly as it is', () => {
    const src = 'nothing to strip here.\nsecond line.\n'
    expect(projectPlain(src).text).toBe(src)
  })
})

describe('mapping back to the file', () => {
  it('takes in the marks around a bold word at the very start', () => {
    // Starting inside the `**` and replacing would leave them behind, opening
    // emphasis that never closes and italicising the rest of the note.
    expect(locate('**five dollars** a month', 'five dollars a month')).toBe(
      '**five dollars** a month'
    )
  })

  it('recovers the formatting a plain selection crossed', () => {
    // The case the old code refused: the person selected a sentence whose
    // middle is bold, and the editor handed over the words without the marks.
    const src = 'The plan is **five dollars** a month.'
    expect(locate(src, 'plan is five dollars a month')).toBe('plan is **five dollars** a month')
  })

  it('recovers a heading', () => {
    expect(locate('## Pricing and terms\n', 'Pricing and terms')).toBe('Pricing and terms')
  })

  it('recovers a passage containing a link', () => {
    const src = 'Read [the docs](https://example.com) first.'
    expect(locate(src, 'Read the docs first.')).toBe('Read [the docs](https://example.com) first.')
  })

  it('recovers a passage containing a wikilink alias', () => {
    const src = 'See [[Pricing|our prices]] for detail.'
    expect(locate(src, 'See our prices for detail.')).toBe('See [[Pricing|our prices]] for detail.')
  })

  it('spans several lines through a bullet list', () => {
    const src = 'Notes:\n- **one** thing\n- two things\n'
    expect(locate(src, 'one thing\ntwo things')).toBe('**one** thing\n- two things')
  })

  it('is null for a passage that is not there', () => {
    expect(locate('nothing like it', 'absent passage')).toBeNull()
  })
})
