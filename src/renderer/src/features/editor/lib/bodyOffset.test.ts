import { describe, it, expect } from 'vitest'
import { bodyOffset } from './bodyOffset'

describe('bodyOffset', () => {
  it('is zero for a note with no frontmatter', () => {
    expect(bodyOffset('# Title\n\ntext')).toBe(0)
  })

  it('skips the frontmatter block and the blank line after it', () => {
    const src = '---\ntype: project\n---\n\n# Title\n'
    expect(src.slice(bodyOffset(src))).toBe('# Title\n')
  })

  it('copes with no blank line after the closing fence', () => {
    const src = '---\ntype: project\n---\n# Title\n'
    expect(src.slice(bodyOffset(src))).toBe('# Title\n')
  })

  it('does not mistake a horizontal rule in the body for the closing fence', () => {
    const src = '---\ntype: project\n---\n\nabove\n\n---\n\nbelow\n'
    expect(src.slice(bodyOffset(src))).toBe('above\n\n---\n\nbelow\n')
  })

  it('is zero when the block is never closed', () => {
    expect(bodyOffset('---\ntype: project\n')).toBe(0)
  })

  it('is zero for three dashes that do not start the file', () => {
    expect(bodyOffset('# Title\n\n---\n\nrule\n')).toBe(0)
  })
})
