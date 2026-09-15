import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Lives here, beside the main-process tests, rather than next to the
 * stylesheet it reads.
 *
 * It has to read the file from disk: the rule under test is a cascade rule,
 * jsdom does not implement enough of the cascade to reproduce it, and vitest
 * resolves CSS imports to nothing. Reading from disk means Node types, and the
 * window's own TypeScript configuration does not have them and should not gain
 * them for one test.
 */
const css = readFileSync(join(__dirname, '../../renderer/src/styles/globals.css'), 'utf8')

/**
 * A codicon's glyph is a `::before` pseudo-element.
 *
 * The default colour used to be set on it — `:where(.codicon)::before { color:
 * grey }` — which looked safe because `:where()` carries no specificity. It
 * was not safe, because specificity is not what decides this: a declaration
 * matching an element directly beats a value that element would otherwise
 * inherit, whatever the specificity. So the glyph took its grey from that rule
 * rather than inheriting what the element had been given, and every plain
 * colour class on an icon did nothing at all.
 *
 * Two things in the product were broken by it and nobody could see why: the
 * icon picker's Accent swatch, and folders falling back to grey instead of to
 * the standardized accent. Both write an ordinary `text-*` class.
 *
 * This reads the stylesheet rather than the DOM on purpose. The bug is in a
 * cascade rule, jsdom does not implement enough of the cascade to reproduce
 * it, and the thing worth pinning is the rule itself.
 */
describe('the default icon colour', () => {
  it('is not set on the glyph, so an ordinary colour class can reach it', () => {
    // Comments mention the old selector by name — strip them first, or this
    // passes and fails on prose.
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(rules).not.toMatch(/:where\(\.codicon\)::before/)
  })

  it('is still set on the element itself, so an icon with no class has one', () => {
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(rules).toMatch(/:where\(\.codicon\)\s*\{[^}]*color:/)
  })

  it('leaves the named helpers naming the glyph, which is what they are for', () => {
    // `.codicon-red` and friends mean "this colour, whatever else is on the
    // element" — they keep both halves and their !important deliberately.
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(rules).toMatch(/\.codicon\.codicon-red::before/)
    expect(rules).toMatch(/\.codicon\.codicon-blue::before/)
  })
})
