import { describe, it, expect } from 'vitest'
import { decodeEntities, extractText, extractTitle, loneUrl } from './web-page'

describe('loneUrl', () => {
  it('recognises an address on its own', () => {
    expect(loneUrl('  https://example.com/a?b=1  ')).toBe('https://example.com/a?b=1')
  })
  it('is null for an address inside a sentence', () => {
    expect(loneUrl('see https://example.com for detail')).toBeNull()
  })
  it('is null for ordinary text and for other schemes', () => {
    expect(loneUrl('just words')).toBeNull()
    expect(loneUrl('file:///etc/passwd')).toBeNull()
  })
})

describe('extractTitle', () => {
  it('prefers the sharing title over the tab title', () => {
    const html = `<title>Site — Page</title><meta property="og:title" content="The real title">`
    expect(extractTitle(html)).toBe('The real title')
  })
  it('falls back to the tab title, collapsed', () => {
    expect(extractTitle('<title>\n  Spread\n  out\n</title>')).toBe('Spread out')
  })
  it('is null when there is none', () => {
    expect(extractTitle('<p>no title here</p>')).toBeNull()
  })
})

describe('extractText', () => {
  it('drops a stylesheet and a script rather than reading them as words', () => {
    const html = '<style>.a{color:red}</style><script>var x=1</script><p>Real words</p>'
    expect(extractText(html)).toBe('Real words')
  })
  it('turns block ends into line breaks', () => {
    expect(extractText('<p>One</p><p>Two</p>')).toBe('One\nTwo')
  })
  it('cuts to the limit', () => {
    expect(extractText(`<p>${'x'.repeat(100)}</p>`, 10)).toHaveLength(10)
  })
})

describe('decodeEntities', () => {
  it('handles names, decimals and hex', () => {
    expect(decodeEntities('a &amp; b &#233; c &#x2014; d')).toBe('a & b é c — d')
  })
  it('leaves something it does not know alone', () => {
    expect(decodeEntities('&notareal;')).toBe('&notareal;')
  })
})
