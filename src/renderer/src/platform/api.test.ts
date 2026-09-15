// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from 'vitest'
import type { MindexApi } from '@shared/api'
import { api } from './api'
import { STALE_BUILD_MESSAGE } from './ipc-error'

/**
 * Calling through a bridge that is a build behind.
 *
 * The bridge is built from the channel list when the app process starts, and
 * in development the window is rebuilt on every change while that process is
 * not. So an operation added a minute ago exists in the window's code and not
 * in the bridge it calls through.
 *
 * It used to throw `x is not a function`, which takes the view down and points
 * at React's internals. It is the same problem as a handler missing from the
 * app process, which has always had an honest answer — these make the two
 * halves read alike.
 */

/**
 * A bridge that knows about one operation and one subscription, and no more.
 *
 * Its properties are frozen the way `contextBridge` hands them over — that is
 * the detail that killed the first attempt at this, which wrapped the bridge in
 * a proxy and was then required by the language to return the real value for
 * every one of them.
 */
function installBridge(): void {
  const bridge = {
    files: { reveal: async () => ({ ok: true, data: undefined }) },
    on: { fileChange: () => () => undefined }
  }
  const frozen = {}
  for (const [k, v] of Object.entries(bridge)) {
    Object.defineProperty(frozen, k, { value: v, writable: false, configurable: false })
  }
  ;(window as unknown as { mindex: MindexApi }).mindex = frozen as unknown as MindexApi
}

beforeEach(() => {
  installBridge()
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

describe('an operation the bridge does not have', () => {
  it('answers instead of throwing', async () => {
    // The exact failure reported: a channel added after the app process started.
    const bridge = api() as unknown as {
      files: { readText(p: string): Promise<{ ok: boolean; error?: string }> }
    }
    expect(typeof bridge.files.readText).toBe('function')
    await expect(bridge.files.readText('/x')).resolves.toEqual({
      ok: false,
      error: STALE_BUILD_MESSAGE
    })
  })

  it('says the two halves are from different builds', async () => {
    const r = await (
      api() as unknown as {
        files: { readText(p: string): Promise<{ error?: string }> }
      }
    ).files.readText('/x')
    expect(r.error).toMatch(/restart/i)
  })

  it('leaves the operations that do exist alone', async () => {
    await expect(api().files.reveal('/x')).resolves.toEqual({ ok: true, data: undefined })
  })

  it('answers for a whole domain the bridge has never heard of', async () => {
    // `notes` is in the channel list and absent from this bridge entirely.
    const r = await (
      api() as unknown as {
        notes: { read(p: string): Promise<{ ok: boolean }> }
      }
    ).notes.read('/x')
    expect(r.ok).toBe(false)
  })
})

describe('subscriptions', () => {
  it('are handed through exactly as the bridge gave them', () => {
    // Not derived from the channel list — the preload names them by hand — so
    // there is nothing to check them against and nothing to fill in.
    expect(typeof api().on.fileChange(() => undefined)).toBe('function')
    expect(api().on).toBe((window as unknown as { mindex: MindexApi }).mindex.on)
  })
})

describe('the wrapper itself', () => {
  it('hands back the same object each time, so effects do not re-run forever', () => {
    // `api()` is called in render paths. A fresh object per call would make
    // every dependency array holding one look changed on every render.
    expect(api()).toBe(api())
    expect(api().files).toBe(api().files)
  })

  it('does not choke on a bridge whose properties are frozen', () => {
    // The first version of this file wrapped the bridge in a proxy, which the
    // language then required to return the real value for every non-writable,
    // non-configurable property — so the first read of `on` threw at startup,
    // before anything rendered.
    expect(() => api().on).not.toThrow()
    expect(() => api().files).not.toThrow()
  })

  it('still refuses when the preload did not run at all', () => {
    delete (window as unknown as { mindex?: MindexApi }).mindex
    expect(() => api()).toThrow(/preload did not run/i)
  })
})
