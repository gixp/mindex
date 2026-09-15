import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VaultSettings } from '@shared/types'

const getVault = vi.fn()
vi.mock('@/platform/api', () => ({ api: () => ({ settings: { getVault } }) }))

import {
  clearVaultSettings,
  getVaultSettings,
  loadVaultSettings,
  onVaultSettings,
  resetVaultSettingsForTest
} from './vault-settings'

/**
 * The replay behaviour is the point of this module, so it is what most of
 * these check. Without it, anything that starts listening after a vault opened
 * — a pane mounted later, a store registered on a screen the person has not
 * visited yet — silently keeps its defaults, which is the bug this replaces.
 */

const settings = (over: Partial<VaultSettings> = {}): VaultSettings =>
  ({
    defaultProjectFolder: '',
    livingIndexEnabled: false,
    ignoredPaths: [],
    ...over
  }) as VaultSettings

beforeEach(() => {
  resetVaultSettingsForTest()
  getVault.mockReset()
})

describe('loading', () => {
  it('publishes what was read', async () => {
    getVault.mockResolvedValue({ ok: true, data: settings({ defaultProjectFolder: 'Projects' }) })
    const seen: Array<VaultSettings | null> = []
    onVaultSettings((s) => seen.push(s))
    await loadVaultSettings()
    expect(seen.at(-1)?.defaultProjectFolder).toBe('Projects')
  })

  it('treats a failed read as no workspace rather than throwing', async () => {
    getVault.mockResolvedValue({ ok: false, error: 'nope' })
    const seen: Array<VaultSettings | null> = []
    onVaultSettings((s) => seen.push(s))
    await loadVaultSettings()
    expect(seen.at(-1)).toBeNull()
  })

  it('makes the value readable without waiting for a callback', async () => {
    getVault.mockResolvedValue({ ok: true, data: settings({ defaultProjectFolder: 'X' }) })
    await loadVaultSettings()
    expect(getVaultSettings()?.defaultProjectFolder).toBe('X')
  })
})

describe('subscribing late', () => {
  it('replays what is already known to a subscriber that arrives afterwards', async () => {
    getVault.mockResolvedValue({ ok: true, data: settings({ defaultProjectFolder: 'Later' }) })
    await loadVaultSettings()
    const seen: Array<VaultSettings | null> = []
    onVaultSettings((s) => seen.push(s))
    expect(seen).toHaveLength(1)
    expect(seen[0]?.defaultProjectFolder).toBe('Later')
  })

  it('replays a closed workspace too, so a late listener resets', async () => {
    clearVaultSettings()
    const seen: Array<VaultSettings | null> = []
    onVaultSettings((s) => seen.push(s))
    expect(seen).toEqual([null])
  })

  it('says nothing at all before anything has been published', () => {
    const seen: Array<VaultSettings | null> = []
    onVaultSettings((s) => seen.push(s))
    expect(seen).toEqual([])
  })
})

describe('closing a workspace', () => {
  it('tells every listener there is none', async () => {
    getVault.mockResolvedValue({ ok: true, data: settings() })
    const seen: Array<VaultSettings | null> = []
    onVaultSettings((s) => seen.push(s))
    await loadVaultSettings()
    clearVaultSettings()
    expect(seen.at(-1)).toBeNull()
    expect(getVaultSettings()).toBeNull()
  })
})

describe('unsubscribing', () => {
  it('stops delivering after the returned function is called', async () => {
    getVault.mockResolvedValue({ ok: true, data: settings() })
    const seen: Array<VaultSettings | null> = []
    const off = onVaultSettings((s) => seen.push(s))
    off()
    await loadVaultSettings()
    expect(seen).toEqual([])
  })

  it('still reaches the others when one listener unsubscribes mid-notify', async () => {
    // Iterating the live set would skip the listener after the one that just
    // removed itself.
    getVault.mockResolvedValue({ ok: true, data: settings() })
    const seen: string[] = []
    const offA = onVaultSettings(() => {
      seen.push('a')
      offA()
    })
    onVaultSettings(() => seen.push('b'))
    await loadVaultSettings()
    expect(seen).toEqual(['a', 'b'])
  })
})
