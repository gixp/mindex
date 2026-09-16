import { describe, it, expect } from 'vitest'
import { looksLikeRepoRef, slugifyRepoName, toCloneUrl } from './github-url'

describe('looksLikeRepoRef', () => {
  it('accepts the URL forms git itself takes', () => {
    expect(looksLikeRepoRef('https://github.com/gixp/mindex.git')).toBe(true)
    expect(looksLikeRepoRef('http://example.com/x.git')).toBe(true)
    expect(looksLikeRepoRef('git@github.com:gixp/mindex.git')).toBe(true)
    expect(looksLikeRepoRef('ssh://git@host/x.git')).toBe(true)
  })

  it('accepts owner/repo shorthand', () => {
    expect(looksLikeRepoRef('gixp/mindex')).toBe(true)
    expect(looksLikeRepoRef('inkeep/open-knowledge')).toBe(true)
    expect(looksLikeRepoRef('a/b.c_d-e')).toBe(true)
  })

  it('treats a bare search term as a search term', () => {
    expect(looksLikeRepoRef('mindex')).toBe(false)
    expect(looksLikeRepoRef('my notes')).toBe(false)
    expect(looksLikeRepoRef('')).toBe(false)
  })

  it('does not read a URL path as shorthand', () => {
    // Two slashes and a scheme — matching this as `owner/repo` would build
    // `https://github.com/https://…`.
    expect(toCloneUrl('https://github.com/a/b')).toBe('https://github.com/a/b')
  })

  it('ignores surrounding whitespace', () => {
    expect(looksLikeRepoRef('  gixp/mindex  ')).toBe(true)
  })
})

describe('toCloneUrl', () => {
  it('expands shorthand', () => {
    expect(toCloneUrl('gixp/mindex')).toBe('https://github.com/gixp/mindex.git')
  })

  it('leaves a URL alone', () => {
    expect(toCloneUrl('git@github.com:gixp/mindex.git')).toBe('git@github.com:gixp/mindex.git')
  })

  it('trims', () => {
    expect(toCloneUrl('  https://x/y.git ')).toBe('https://x/y.git')
  })
})

describe('slugifyRepoName', () => {
  it('keeps what GitHub allows', () => {
    expect(slugifyRepoName('my-notes_v2.1')).toBe('my-notes_v2.1')
  })

  it('folds spaces and punctuation to dashes', () => {
    expect(slugifyRepoName('My Notes!')).toBe('My-Notes')
    expect(slugifyRepoName('a/b')).toBe('a-b')
  })

  it('collapses a run of illegal characters into one dash', () => {
    expect(slugifyRepoName('a   b')).toBe('a-b')
  })

  it('does not start or end with a dash', () => {
    expect(slugifyRepoName('  !!hello!!  ')).toBe('hello')
  })

  it('caps the length GitHub accepts', () => {
    expect(slugifyRepoName('x'.repeat(300))).toHaveLength(100)
  })

  it('gives back nothing for a name with nothing usable in it', () => {
    // The dialog treats an empty result as "cannot publish yet", rather than
    // sending GitHub a name it will reject.
    expect(slugifyRepoName('!!!')).toBe('')
  })
})
