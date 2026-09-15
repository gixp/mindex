import { describe, it, expect } from 'vitest'
import { bracketedTargets, frontmatterLinkTargets, relationTargets } from './relations'

describe('bracketedTargets', () => {
  it('pulls links out of a string, an array and nothing else', () => {
    expect(bracketedTargets('see [[Acme]] and [[Globex]]')).toEqual(['Acme', 'Globex'])
    expect(bracketedTargets(['[[Ann]]', '[[Bob]]'])).toEqual(['Ann', 'Bob'])
    expect(bracketedTargets('Acme')).toEqual([])
    expect(bracketedTargets(42)).toEqual([])
    expect(bracketedTargets(null)).toEqual([])
  })

  it('drops the alias and the anchor, keeping the target', () => {
    expect(bracketedTargets('[[Acme Corp|Acme]]')).toEqual(['Acme Corp'])
    expect(bracketedTargets('[[Acme#Contacts]]')).toEqual(['Acme'])
  })
})

describe('relationTargets', () => {
  it('reads a bare value only when the key is declared', () => {
    expect(relationTargets('Acme', true)).toEqual(['Acme'])
    expect(relationTargets('Acme', false)).toEqual([])
  })

  it('reads a bracketed value whether the key is declared or not', () => {
    expect(relationTargets('[[Acme]]', false)).toEqual(['Acme'])
  })

  it('treats a blank value as no relation', () => {
    // The templates write `company: ""`, so this is the common case, not an
    // edge one — it must not count as a link to a note named "".
    expect(relationTargets('', true)).toEqual([])
    expect(relationTargets('   ', true)).toEqual([])
    expect(relationTargets([], true)).toEqual([])
  })

  it('decides per element, so a mixed list still reads as a list', () => {
    expect(relationTargets(['[[Ann]]', 'Bob'], true)).toEqual(['Ann', 'Bob'])
    expect(relationTargets(['[[Ann]]', 'Bob'], false)).toEqual(['Ann'])
  })

  it('takes only what is inside the brackets when a value has both', () => {
    expect(relationTargets('billed to [[Acme]] last year', true)).toEqual(['Acme'])
  })
})

describe('frontmatterLinkTargets', () => {
  it('collects every explicit link in the block, deduplicated', () => {
    const out = frontmatterLinkTargets({
      company: '[[Acme]]',
      project: '[[Acme]]',
      participants: ['[[Ann]]', '[[Bob]]'],
      area: 'Finance',
      amount: 100
    })
    expect(out.sort()).toEqual(['Acme', 'Ann', 'Bob'])
  })
})
