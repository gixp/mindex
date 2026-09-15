import { describe, expect, it } from 'vitest'
import { IPC } from './ipc-channels'

/**
 * The channel strings are built from names now rather than written out, so
 * these check the building — a mistyped channel used to be caught by reading
 * the file and is now caught here.
 */

const domains = Object.entries(IPC) as Array<[string, Record<string, string>]>

describe('the channel for an operation', () => {
  it('is its domain and its name joined by a colon, without exception', () => {
    for (const [domain, ops] of domains) {
      for (const [name, channel] of Object.entries(ops)) {
        expect(channel, `${domain}.${name}`).toBe(`${domain}:${name}`)
      }
    }
  })

  it('spells out a few by hand, so the rule itself is pinned', () => {
    expect(IPC.comments.list).toBe('comments:list')
    expect(IPC.notes.write).toBe('notes:write')
    expect(IPC.vault.openWithMigration).toBe('vault:openWithMigration')
    expect(IPC.events.fileChange).toBe('events:fileChange')
  })
})

describe('the set of channels', () => {
  it('is not empty and has no duplicates across domains', () => {
    const all = domains.flatMap(([, ops]) => Object.values(ops))
    expect(all.length).toBeGreaterThan(150)
    expect(new Set(all).size, 'two operations sharing a channel').toBe(all.length)
  })

  it('has no empty domain', () => {
    for (const [domain, ops] of domains) {
      expect(Object.keys(ops).length, domain).toBeGreaterThan(0)
    }
  })
})
