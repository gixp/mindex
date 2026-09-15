import { describe, expect, it } from 'vitest'

/**
 * Where a `[[` picker should open, and over what.
 *
 * The detection itself lives in `NoteEditor.tsx` next to the slash menu's, and
 * both are a regex over the text of the block up to the caret. The regex is
 * the part worth pinning: it decides whether the feature works mid-sentence,
 * which is the whole reason it exists, and the range it implies is what a pick
 * deletes — get that wrong and accepting a note eats the words beside it.
 */

const TRIGGER = /\[\[([^\][\n]*)$/

function detect(textBeforeCaret: string): { query: string; from: number } | null {
  const m = TRIGGER.exec(textBeforeCaret)
  if (!m) return null
  const query = m[1] ?? ''
  // Mirrors the editor: caret position, back past the query and both brackets.
  return { query, from: textBeforeCaret.length - query.length - 2 }
}

describe('opening the picker', () => {
  it('opens on the brackets alone', () => {
    expect(detect('[[')).toEqual({ query: '', from: 0 })
  })

  it('opens mid-sentence, unlike the slash menu', () => {
    // The slash menu deliberately fires only at the start of a block. A link
    // belongs inside a sentence, so the same restriction here would have made
    // the feature useless exactly where it is wanted.
    const text = 'as covered in [[atl'
    expect(detect(text)).toEqual({ query: 'atl', from: text.length - 5 })
  })

  it('takes everything typed after the brackets as the query', () => {
    expect(detect('[[Project Atlas')?.query).toBe('Project Atlas')
  })

  it('stays shut on a single bracket', () => {
    expect(detect('[not a link')).toBeNull()
  })

  it('closes once the link is finished', () => {
    // The closing brackets end the query, so a completed link stops offering
    // to be completed again every time the caret passes it.
    expect(detect('[[Atlas]]')).toBeNull()
  })

  it('reopens for a second link on the same line', () => {
    const text = 'see [[Atlas]] and [[bor'
    expect(detect(text)?.query).toBe('bor')
  })

  it('does not run past the end of a line', () => {
    expect(detect('[[Atlas\nplain text')).toBeNull()
  })
})

describe('the range a pick replaces', () => {
  it('covers both brackets and the typed query, and nothing before them', () => {
    const text = 'link to [[atl'
    const hit = detect(text)
    expect(hit).not.toBeNull()
    // `from` lands on the first bracket; the editor deletes from there through
    // `query.length + 2`, which is exactly the text the person typed.
    expect(text.slice(hit?.from)).toBe('[[atl')
  })
})
