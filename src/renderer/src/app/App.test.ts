// @vitest-environment jsdom
//
// jsdom, not the default 'node', even though normalizePanelSizes itself is
// pure: importing App.tsx also imports every component it renders (terminal,
// graph, etc.), and some of those touch `window`/`document` at module load
// time, not just when rendered.
import { describe, expect, it } from 'vitest'
import '@/test/setup'
import { DEFAULT_PANEL_SIZES, normalizePanelSizes } from './App'

describe('normalizePanelSizes', () => {
  it('falls back to the default split when given undefined', () => {
    // Pinned to the constant rather than to its numbers: this is asserting
    // that the fallback *is* the default, not what the default happens to be
    // this month. Written out, it failed the day the split was widened —
    // which told nobody anything, because nothing was wrong.
    expect(normalizePanelSizes(undefined)).toEqual(DEFAULT_PANEL_SIZES)
  })

  it('leaves an already-normalized split alone', () => {
    expect(normalizePanelSizes({ left: 25, center: 45, right: 30 })).toEqual({
      left: 25,
      center: 45,
      right: 30
    })
  })

  it('corrects small floating-point drift without triggering migration', () => {
    // Sums to 99, not 100 — close enough (within 1) that this should be a
    // plain proportional rescale, not the old-coordinate-system migration
    // below (which kicks in only past that 1-point tolerance).
    expect(normalizePanelSizes({ left: 19.8, center: 39.6, right: 39.6 })).toEqual({
      left: 20,
      center: 40,
      right: 40
    })
  })

  it('falls back to the default split when everything is zero', () => {
    expect(normalizePanelSizes({ left: 0, center: 0, right: 0 })).toEqual(DEFAULT_PANEL_SIZES)
  })

  it('migrates the old coordinate system (left as % of window, not of the group)', () => {
    // A pre-migration save: `left` was already a percentage of the whole
    // window, while `center`/`right` were percentages of what remained —
    // together they total roughly 100 + the leftover, not 100, which is what
    // should trip the migration branch rather than a plain rescale.
    const result = normalizePanelSizes({ left: 20, center: 62.5, right: 37.5 })
    expect(result.left).toBeCloseTo(20)
    expect(result.center + result.right).toBeCloseTo(80)
    // The old center:right ratio (62.5:37.5, i.e. 5:3) survives the
    // conversion — only `left`'s meaning changes.
    expect(result.center / result.right).toBeCloseTo(62.5 / 37.5)
  })
})
