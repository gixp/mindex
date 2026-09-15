import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createQuietGate } from './quiet-window'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createQuietGate', () => {
  it('does not resolve before quietMs of silence has passed since the last activity', async () => {
    const gate = createQuietGate({ quietMs: 1_000, maxWaitMs: 60_000, pollMs: 100 })
    const controller = new AbortController()
    gate.markActivity()
    const resolved = vi.fn()
    void gate.waitForQuiet(controller.signal).then(resolved)

    await vi.advanceTimersByTimeAsync(900)
    expect(resolved).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(200)
    expect(resolved).toHaveBeenCalled()
  })

  it('resets the wait on repeated activity', async () => {
    const gate = createQuietGate({ quietMs: 1_000, maxWaitMs: 60_000, pollMs: 100 })
    const controller = new AbortController()
    gate.markActivity()
    const resolved = vi.fn()
    void gate.waitForQuiet(controller.signal).then(resolved)

    // Keep marking activity every 500ms — quietMs (1000ms) of silence never
    // accumulates, so the gate should never resolve during this stretch.
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(500)
      gate.markActivity()
    }
    expect(resolved).not.toHaveBeenCalled()

    // Now let it actually go quiet.
    await vi.advanceTimersByTimeAsync(1_000)
    expect(resolved).toHaveBeenCalled()
  })

  it('resolves anyway once maxWaitMs elapses, even under continuous activity', async () => {
    const gate = createQuietGate({ quietMs: 1_000, maxWaitMs: 3_000, pollMs: 100 })
    const controller = new AbortController()
    gate.markActivity()
    const resolved = vi.fn()
    void gate.waitForQuiet(controller.signal).then(resolved)

    for (let i = 0; i < 40; i++) {
      await vi.advanceTimersByTimeAsync(100)
      gate.markActivity()
    }
    // 4000ms of continuous activity, past the 3000ms cap — must resolve
    // regardless of quiet never being reached.
    expect(resolved).toHaveBeenCalled()
  })

  it('rejects if the signal aborts mid-wait', async () => {
    const gate = createQuietGate({ quietMs: 5_000, maxWaitMs: 60_000, pollMs: 100 })
    const controller = new AbortController()
    gate.markActivity()
    const caught = vi.fn()
    const promise = gate.waitForQuiet(controller.signal).catch(caught)

    await vi.advanceTimersByTimeAsync(500)
    controller.abort()
    await promise

    expect(caught).toHaveBeenCalled()
  })

  it('rejects immediately if the signal is already aborted', async () => {
    const gate = createQuietGate({ quietMs: 1_000, maxWaitMs: 60_000, pollMs: 100 })
    const controller = new AbortController()
    controller.abort()

    await expect(gate.waitForQuiet(controller.signal)).rejects.toThrow()
  })
})
