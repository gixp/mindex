import { describe, it, expect } from 'vitest'
import { changedSpan } from './changedSpan'

describe('changedSpan', () => {
  it('is empty when nothing changed', () => {
    expect(changedSpan('same', 'same')).toEqual({ removed: '', added: '' })
  })

  it('keeps only the replaced passage out of a long note', () => {
    const before = '# Title\n\nkeep this\nThe plan is five dollars a month.\nkeep this too\n'
    const after = '# Title\n\nkeep this\nFive dollars a month.\nkeep this too\n'
    // Only as far as the texts actually diverge — "dollars a month." is
    // identical in both and is not part of the decision.
    expect(changedSpan(before, after)).toEqual({
      removed: 'The plan is five',
      added: 'Five'
    })
  })

  it('reports a pure insertion with nothing removed', () => {
    expect(changedSpan('a c', 'a b c')).toEqual({ removed: '', added: 'b' })
  })

  it('reports a pure deletion with nothing added', () => {
    expect(changedSpan('a b c', 'a c')).toEqual({ removed: 'b', added: '' })
  })

  it('widens to whole words rather than cutting mid-word', () => {
    // The bare character diff here is "ed" against "ing", which is unreadable
    // on its own — the reader has to rebuild the word to see what happened.
    expect(changedSpan('it renewed today', 'it renewing today')).toEqual({
      removed: 'renewed',
      added: 'renewing'
    })
  })

  it('handles a change at the very start', () => {
    expect(changedSpan('Alpha tail', 'Beta tail')).toEqual({
      removed: 'Alpha',
      added: 'Beta'
    })
  })

  it('handles a change at the very end', () => {
    expect(changedSpan('head Alpha', 'head Beta')).toEqual({
      removed: 'Alpha',
      added: 'Beta'
    })
  })

  it('handles one side being empty', () => {
    expect(changedSpan('', 'new text')).toEqual({ removed: '', added: 'new text' })
    expect(changedSpan('old text', '')).toEqual({ removed: 'old text', added: '' })
  })
})
