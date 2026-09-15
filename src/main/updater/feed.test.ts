import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchReleaseNotes } from './feed'

/**
 * 0.3.7 published `"description": "null"` and `"notes": ["null"]`, and the app
 * printed the word under the version number. The workflow that produced it is
 * fixed, but every feed already published is out of reach from here — so the
 * app has to refuse the word too.
 */

function feedReturning(body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => body }) as unknown as Response)
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchReleaseNotes', () => {
  it('drops the words a missing value arrives as', async () => {
    feedReturning({ version: '0.3.7', description: 'null', notes: ['null', 'undefined'] })

    const notes = await fetchReleaseNotes()

    expect(notes).toEqual({ version: '0.3.7', description: '', notes: [] })
  })

  it('keeps a real summary and real bullets', async () => {
    feedReturning({
      version: '0.4.0',
      description: 'Faster search.',
      notes: ['Search is quicker', 'Fixed a crash']
    })

    const notes = await fetchReleaseNotes()

    expect(notes).toEqual({
      version: '0.4.0',
      description: 'Faster search.',
      notes: ['Search is quicker', 'Fixed a crash']
    })
  })

  it('treats an empty or absent summary as absent', async () => {
    feedReturning({ version: '0.4.0', description: '   ' })

    const notes = await fetchReleaseNotes()

    expect(notes).toMatchObject({ description: '', notes: [] })
  })

  it('refuses a feed with no version at all', async () => {
    feedReturning({ description: 'orphan' })

    expect(await fetchReleaseNotes()).toBeNull()
  })
})
