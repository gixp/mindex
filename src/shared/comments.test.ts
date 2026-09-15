import { describe, it, expect } from 'vitest'
import { createAnchor, refindAnchor, type CommentAnchor } from './comments'

const BODY = 'The quick brown fox jumps over the lazy dog.'

function anchorOn(body: string, quote: string): CommentAnchor {
  const start = body.indexOf(quote)
  return createAnchor(body, start, start + quote.length)
}

describe('createAnchor', () => {
  it('captures the quote with its surroundings', () => {
    const a = anchorOn(BODY, 'brown fox')
    expect(a.exact).toBe('brown fox')
    expect(BODY.endsWith(a.suffix, a.end + a.suffix.length)).toBe(true)
    expect(a.prefix.endsWith('quick ')).toBe(true)
  })

  it('clamps a range that runs past the end of the body', () => {
    const a = createAnchor('short', 2, 999)
    expect(a.exact).toBe('ort')
    expect(a.end).toBe(5)
  })
})

describe('refindAnchor', () => {
  it('finds an untouched quote without moving it', () => {
    const a = anchorOn(BODY, 'brown fox')
    expect(refindAnchor(BODY, a)).toEqual({
      status: 'anchored',
      start: BODY.indexOf('brown fox'),
      end: BODY.indexOf('brown fox') + 'brown fox'.length,
      moved: false
    })
  })

  it('follows the quote when text is inserted above it', () => {
    const a = anchorOn(BODY, 'brown fox')
    const edited = `A new first line.\n\n${BODY}`
    const r = refindAnchor(edited, a)
    expect(r.status).toBe('anchored')
    if (r.status !== 'anchored') return
    expect(edited.slice(r.start, r.end)).toBe('brown fox')
    expect(r.moved).toBe(true)
  })

  it('orphans a quote that no longer exists', () => {
    const a = anchorOn(BODY, 'brown fox')
    expect(refindAnchor('Something else entirely.', a)).toEqual({ status: 'orphaned' })
  })

  it('picks the right copy when the quote repeats, using the surroundings', () => {
    // Both sentences contain "the plan"; only the context tells them apart.
    const body = 'Alpha needs the plan today. Beta needs the plan tomorrow.'
    const second = body.lastIndexOf('the plan')
    const a = createAnchor(body, second, second + 'the plan'.length)

    // Rewrite the first sentence so offsets shift, keeping both copies.
    const edited =
      'Alpha (rewritten, much longer now) needs the plan today. Beta needs the plan tomorrow.'
    const r = refindAnchor(edited, a)
    expect(r.status).toBe('anchored')
    if (r.status !== 'anchored') return
    // The second copy — the one that was commented on — not the first.
    expect(r.start).toBe(edited.lastIndexOf('the plan'))
    expect(edited.slice(r.start, r.end)).toBe('the plan')
    expect(edited.slice(0, r.start).endsWith('Beta needs ')).toBe(true)
  })

  it('does not drift onto a nearer copy just because text moved', () => {
    // Distance only breaks ties — context has to win over proximity, or an
    // edit above the comment would silently re-point it at the wrong copy.
    const body = 'one: target here. two: target there.'
    const start = body.lastIndexOf('target')
    const a = createAnchor(body, start, start + 'target'.length)
    const edited = `padding padding padding\n${body}`
    const r = refindAnchor(edited, a)
    expect(r.status).toBe('anchored')
    if (r.status !== 'anchored') return
    expect(r.start).toBe(edited.lastIndexOf('target'))
  })

  it('keeps two comments on the same words apart by their occurrence', () => {
    // The case that made this necessary: the same phrase twice, identical
    // context around both, so only the index can tell them apart.
    const body = 'note: review this. note: review this.'
    const first = createAnchor(body, body.indexOf('review this'), body.indexOf('review this') + 11)
    const second = createAnchor(
      body,
      body.lastIndexOf('review this'),
      body.lastIndexOf('review this') + 11
    )
    expect(first.occurrence).toBe(0)
    expect(second.occurrence).toBe(1)

    // Shift everything along; each must still land on its own copy.
    const edited = `prefix line\n${body}`
    const r1 = refindAnchor(edited, first)
    const r2 = refindAnchor(edited, second)
    expect(r1.status).toBe('anchored')
    expect(r2.status).toBe('anchored')
    if (r1.status !== 'anchored' || r2.status !== 'anchored') return
    expect(r1.start).toBe(edited.indexOf('review this'))
    expect(r2.start).toBe(edited.lastIndexOf('review this'))
    expect(r1.start).not.toBe(r2.start)
  })

  it('still resolves an anchor written before occurrences existed', () => {
    const body = 'The quick brown fox jumps over the lazy dog.'
    const legacy: CommentAnchor = {
      exact: 'brown fox',
      prefix: 'The quick ',
      suffix: ' jumps',
      start: 999,
      end: 999
    }
    const r = refindAnchor(body, legacy)
    expect(r.status).toBe('anchored')
    if (r.status !== 'anchored') return
    expect(body.slice(r.start, r.end)).toBe('brown fox')
  })

  it('treats an empty quote as unlocatable rather than matching everywhere', () => {
    const a: CommentAnchor = { exact: '', prefix: '', suffix: '', start: 0, end: 0 }
    expect(refindAnchor(BODY, a)).toEqual({ status: 'orphaned' })
  })

  it('reports moved:false only when the offset was still correct', () => {
    const a = anchorOn(BODY, 'lazy dog')
    const edited = BODY.replace('quick ', '')
    const r = refindAnchor(edited, a)
    expect(r.status).toBe('anchored')
    if (r.status !== 'anchored') return
    expect(r.moved).toBe(true)
    expect(edited.slice(r.start, r.end)).toBe('lazy dog')
  })
})
