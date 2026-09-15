import { describe, expect, it } from 'vitest'
import { BLOCK_TYPE_COMMANDS, COMMANDS } from './slashCommands'

/**
 * The one list behind both menus that convert a block.
 *
 * The slash menu and the block-type selector in the selection toolbar offer
 * the same operation from two places. Written out twice they would drift —
 * one would learn a new block type, or change which command makes a quote, and
 * the other would not.
 *
 * So there is one list, and membership is earned rather than declared: a
 * command that can recognise itself is one that converts. A command that
 * inserts something new has nothing to recognise.
 */
describe('BLOCK_TYPE_COMMANDS', () => {
  it('is exactly the commands that can recognise themselves', () => {
    expect(BLOCK_TYPE_COMMANDS).toEqual(COMMANDS.filter((c) => c.isActive))
    expect(BLOCK_TYPE_COMMANDS.length).toBeGreaterThan(0)
  })

  it('covers the block types a person actually turns things into', () => {
    const ids = BLOCK_TYPE_COMMANDS.map((c) => c.id)
    expect(ids).toEqual(
      expect.arrayContaining([
        'text',
        'h1',
        'h2',
        'h3',
        'bullet',
        'ordered',
        'todo',
        'quote',
        'code'
      ])
    )
  })

  it('leaves out the ones that insert rather than convert', () => {
    // An image is not something a paragraph can become. Offering it in a
    // "turn into" menu would either do nothing or destroy the block.
    const ids = BLOCK_TYPE_COMMANDS.map((c) => c.id)
    for (const inserted of ['image', 'video', 'table', 'chart', 'separator']) {
      expect(ids).not.toContain(inserted)
    }
  })

  it('gives every entry something to draw', () => {
    // The selector's trigger is a mark, not a word — an entry with neither
    // would render as an empty button.
    for (const c of BLOCK_TYPE_COMMANDS) {
      expect(c.icon ?? c.glyph).toBeTruthy()
    }
  })
})
