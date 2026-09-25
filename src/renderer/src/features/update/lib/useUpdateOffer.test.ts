import { describe, expect, it } from 'vitest'
import { decideOffer } from './useUpdateOffer'

/**
 * The rule the corner notice and the header button both read. They used to be
 * one card that was always on screen while an update existed, so there was
 * nothing to decide; now closing the notice must not lose the offer, and the
 * two must never disagree about whether there is one.
 */

const base = { version: '0.3.8', dismissed: undefined, closedFor: null }

describe('decideOffer', () => {
  it('offers nothing when there is nothing to offer', () => {
    expect(decideOffer({ ...base, phase: 'idle' })).toMatchObject({ offered: false, shown: false })
    expect(decideOffer({ ...base, phase: 'checking' })).toMatchObject({ offered: false })
    expect(decideOffer({ ...base, phase: undefined })).toMatchObject({ offered: false })
  })

  it('offers nothing when the feed named no version', () => {
    expect(decideOffer({ ...base, phase: 'available', version: undefined })).toMatchObject({
      offered: false,
      shown: false
    })
  })

  it('shows a new version, once', () => {
    expect(decideOffer({ ...base, phase: 'available' })).toMatchObject({
      offered: true,
      shown: true
    })
  })

  it('keeps offering a version that was closed for this sitting, without showing it', () => {
    // The whole reason the header button exists: closing is not refusing.
    expect(decideOffer({ ...base, phase: 'available', closedFor: '0.3.8' })).toMatchObject({
      offered: true,
      shown: false
    })
  })

  it('keeps offering a version turned down for good', () => {
    expect(decideOffer({ ...base, phase: 'available', dismissed: '0.3.8' })).toMatchObject({
      offered: true,
      shown: false
    })
  })

  it('shows a version dismissed when a different one was turned down', () => {
    expect(decideOffer({ ...base, phase: 'available', dismissed: '0.3.7' })).toMatchObject({
      shown: true
    })
  })

  it('leaves work already under way to the startup screen', () => {
    // Still offered — the header keeps its button — but not drawn a second
    // time in the corner, where it was a duplicate of the bar in the middle
    // of the window.
    for (const phase of ['downloading', 'installing'] as const) {
      expect(decideOffer({ ...base, phase })).toMatchObject({
        offered: true,
        shown: false,
        working: true
      })
    }
  })

  it('shows a staged or failed update despite an earlier dismissal', () => {
    // That dismissal answered "not this version". This is that version, part
    // way installed — a different question, and one still worth asking.
    for (const phase of ['ready', 'manual', 'error'] as const) {
      expect(decideOffer({ ...base, phase, dismissed: '0.3.8' })).toMatchObject({ shown: true })
      expect(decideOffer({ ...base, phase, closedFor: '0.3.8' })).toMatchObject({ shown: false })
    }
  })
})
