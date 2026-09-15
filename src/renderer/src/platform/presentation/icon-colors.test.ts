import { describe, expect, it } from 'vitest'
import { DEFAULT_ICON_COLOR, ICON_COLORS, iconColorValue } from './icon-colors'
import { DEFAULT_FOLDER_ICON_COLOR } from './tree-icon'

describe('the icon palette', () => {
  it('offers the colour a folder already is', () => {
    // The folder default has to be a swatch you can pick, not merely a shade
    // the palette happens to contain — otherwise "put it back" and "choose
    // this one" produce different classes for the same colour.
    //
    // It used to have to be the *first* swatch, back when the default was the
    // palette's blue and blue leads the row. The default is grey now and the
    // row still leads with blue, because those are two separate decisions:
    // which colour a folder is when nobody chose, and which colour a person
    // reaches for first when they do.
    expect(ICON_COLORS.some((c) => c.cls === DEFAULT_FOLDER_ICON_COLOR)).toBe(true)
  })

  it('offers no swatch that means "no colour"', () => {
    // Clearing is the reset button. A swatch that meant "clear the override"
    // had to borrow whatever colour clearing produced, which is how it ended
    // up identical to the swatch beside it.
    expect(ICON_COLORS.every((c) => c.cls !== null)).toBe(true)
  })

  it('gives every swatch its own class, so none is a duplicate of another', () => {
    const classes = ICON_COLORS.map((c) => c.cls)
    expect(new Set(classes).size).toBe(classes.length)
  })

  it('still resolves a colour someone picked before it was retired', () => {
    // An override set on purpose must outlive the button that set it. The
    // accent is no longer offered; a folder already carrying it must not
    // quietly turn grey.
    expect(iconColorValue('text-accent-1')).not.toBe(DEFAULT_ICON_COLOR)
  })

  it('falls back to grey for something it genuinely does not know', () => {
    expect(iconColorValue('text-nonsense-999')).toBe(DEFAULT_ICON_COLOR)
    expect(iconColorValue(null)).toBe(DEFAULT_ICON_COLOR)
  })
})
