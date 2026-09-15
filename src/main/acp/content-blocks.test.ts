import { describe, expect, it } from 'vitest'
import { fileLink, promptBlocks } from './content-blocks'

describe('a file as a link', () => {
  it('carries the name and an address the protocol will accept', () => {
    const block = fileLink('/Users/x/Vault/Projects/Roadmap.md')
    expect(block).toEqual({
      type: 'resource_link',
      name: 'Roadmap.md',
      uri: 'file:///Users/x/Vault/Projects/Roadmap.md'
    })
  })

  it('encodes what a URL cannot hold raw', () => {
    // The far end validates this as a URL. A space or a hash in a file name is
    // ordinary, and unencoded it makes the whole block invalid.
    const block = fileLink('/Users/x/My Notes/a#b.md')
    expect(block && 'uri' in block ? block.uri : '').toBe('file:///Users/x/My%20Notes/a%23b.md')
  })

  it('refuses a path it would have to guess a root for', () => {
    // Everything here comes from a picker or the open editor, so a relative
    // path means a caller that did not resolve it. One fewer link beats an
    // invented one.
    expect(fileLink('Projects/Roadmap.md')).toBeNull()
    expect(fileLink('   ')).toBeNull()
  })
})

describe('a turn', () => {
  it('puts what was attached before what was asked', () => {
    const blocks = promptBlocks('what changed?', ['/v/a.md', '/v/b.md'])
    expect(blocks.map((b) => b.type)).toEqual(['resource_link', 'resource_link', 'text'])
    expect(blocks[2]).toEqual({ type: 'text', text: 'what changed?' })
  })

  it('is just text when nothing is attached', () => {
    expect(promptBlocks('hello')).toEqual([{ type: 'text', text: 'hello' }])
  })

  it('is just links when nothing was typed', () => {
    // Handing over files without a question is still a turn.
    const blocks = promptBlocks('   ', ['/v/a.md'])
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.type).toBe('resource_link')
  })

  it('never sends an empty prompt', () => {
    expect(promptBlocks('', [])).toEqual([{ type: 'text', text: '' }])
  })

  it('drops a path it cannot address and keeps the rest', () => {
    const blocks = promptBlocks('go', ['relative.md', '/v/real.md'])
    expect(blocks.filter((b) => b.type === 'resource_link')).toHaveLength(1)
  })
})
