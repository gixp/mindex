import { describe, expect, it } from 'vitest'
import { loneUrl } from '@/features/editor/lib/lone-url'

describe('loneUrl', () => {
  it('accepts a bare http(s) URL', () => {
    expect(loneUrl('https://example.com')).toBe('https://example.com')
    expect(loneUrl('http://example.com/path?q=1')).toBe('http://example.com/path?q=1')
  })

  it('trims surrounding whitespace', () => {
    expect(loneUrl('  https://example.com  ')).toBe('https://example.com')
  })

  it('rejects a URL with trailing prose — the whole paste must be the URL', () => {
    expect(loneUrl('see https://example.com for more')).toBeNull()
  })

  it('rejects plain text', () => {
    expect(loneUrl('not a url')).toBeNull()
  })

  it('rejects a non-http(s) scheme', () => {
    expect(loneUrl('mailto:a@b.com')).toBeNull()
    expect(loneUrl('ftp://example.com')).toBeNull()
  })

  it('rejects empty input', () => {
    expect(loneUrl('')).toBeNull()
    expect(loneUrl('   ')).toBeNull()
  })
})
