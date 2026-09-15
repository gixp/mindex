import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createScheduler, type Scheduler, type SchedulerEvent } from './scheduler'

interface Deferred<T = void> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

function makeScheduler(
  overrides: {
    debounceMs?: number
    cooldownMs?: number
    maxConcurrent?: number
    perFeatureCaps?: Record<string, number>
  } = {}
): { scheduler: Scheduler; events: SchedulerEvent[] } {
  const events: SchedulerEvent[] = []
  const scheduler = createScheduler(
    { debounceMs: 1_000, cooldownMs: 1_000, maxConcurrent: 10, ...overrides },
    (e) => events.push(e)
  )
  return { scheduler, events }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createScheduler', () => {
  it('debounce delays a run until debounceMs has elapsed', async () => {
    const { scheduler } = makeScheduler({ debounceMs: 1_000 })
    const run = vi.fn().mockResolvedValue(undefined)
    scheduler.enqueue({ scope: 'a', feature: 'f', run })

    await vi.advanceTimersByTimeAsync(999)
    expect(run).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('re-debounces on a second enqueue for the same scope before it fires', async () => {
    const { scheduler } = makeScheduler({ debounceMs: 1_000 })
    const run = vi.fn().mockResolvedValue(undefined)
    scheduler.enqueue({ scope: 'a', feature: 'f', run })

    await vi.advanceTimersByTimeAsync(900)
    scheduler.enqueue({ scope: 'a', feature: 'f', run })

    // Original 1000ms window would have elapsed by now, but the second
    // enqueue should have reset the timer.
    await vi.advanceTimersByTimeAsync(200)
    expect(run).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(800)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('cooldown enforces a minimum gap between two runs of the same scope', async () => {
    const { scheduler } = makeScheduler({ debounceMs: 0, cooldownMs: 5_000 })
    const first = vi.fn().mockResolvedValue(undefined)
    scheduler.enqueue({ scope: 'a', feature: 'f', run: first }, { immediate: true })
    await vi.runOnlyPendingTimersAsync()
    await flushMicrotasks()
    expect(first).toHaveBeenCalledTimes(1)

    const second = vi.fn().mockResolvedValue(undefined)
    scheduler.enqueue({ scope: 'a', feature: 'f', run: second })

    await vi.advanceTimersByTimeAsync(4_999)
    expect(second).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('per-call debounceMs/cooldownMs override the scheduler-wide config', async () => {
    const { scheduler } = makeScheduler({ debounceMs: 100_000, cooldownMs: 100_000 })
    const run = vi.fn().mockResolvedValue(undefined)
    scheduler.enqueue({ scope: 'a', feature: 'f', run }, { debounceMs: 50 })

    await vi.advanceTimersByTimeAsync(49)
    expect(run).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('immediate bypasses both debounce and cooldown', async () => {
    const { scheduler } = makeScheduler({ debounceMs: 100_000, cooldownMs: 100_000 })
    const first = vi.fn().mockResolvedValue(undefined)
    scheduler.enqueue({ scope: 'a', feature: 'f', run: first }, { immediate: true })
    await vi.runOnlyPendingTimersAsync()
    await flushMicrotasks()
    expect(first).toHaveBeenCalledTimes(1)

    const second = vi.fn().mockResolvedValue(undefined)
    scheduler.enqueue({ scope: 'a', feature: 'f', run: second }, { immediate: true })
    await vi.runOnlyPendingTimersAsync()
    await flushMicrotasks()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('cancel(scope) stops a still-pending job from ever firing', async () => {
    const { scheduler, events } = makeScheduler({ debounceMs: 1_000 })
    const run = vi.fn().mockResolvedValue(undefined)
    scheduler.enqueue({ scope: 'a', feature: 'f', run })
    scheduler.cancel('a')

    await vi.advanceTimersByTimeAsync(2_000)
    expect(run).not.toHaveBeenCalled()
    expect(events.some((e) => e.kind === 'cancelled')).toBe(true)
  })

  it('pause() blocks a pending job from starting; resume() lets it run', async () => {
    const { scheduler } = makeScheduler({ debounceMs: 100 })
    const run = vi.fn().mockResolvedValue(undefined)
    scheduler.enqueue({ scope: 'a', feature: 'f', run })
    scheduler.pause()

    // A paused pending job reschedules itself every tick (scheduler.ts's
    // fire() re-arms with setTimeout when paused) — bounded steps instead of
    // draining all timers, which would spin forever.
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(100)
    }
    expect(run).not.toHaveBeenCalled()
    expect(scheduler.active()).toHaveLength(0)

    scheduler.resume()
    await vi.advanceTimersByTimeAsync(0)
    await flushMicrotasks()
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('perFeatureCaps limits how many jobs of one feature run concurrently', async () => {
    const { scheduler } = makeScheduler({
      debounceMs: 0,
      maxConcurrent: 10,
      perFeatureCaps: { f: 1 }
    })
    const gate1 = deferred()
    const gate2 = deferred()
    const run1 = vi.fn().mockReturnValue(gate1.promise)
    const run2 = vi.fn().mockReturnValue(gate2.promise)

    scheduler.enqueue({ scope: 'a', feature: 'f', run: run1 }, { immediate: true })
    scheduler.enqueue({ scope: 'b', feature: 'f', run: run2 }, { immediate: true })
    await vi.runOnlyPendingTimersAsync()
    await flushMicrotasks()

    expect(run1).toHaveBeenCalledTimes(1)
    expect(run2).not.toHaveBeenCalled()
    expect(scheduler.active()).toHaveLength(1)

    gate1.resolve()
    await flushMicrotasks()

    expect(run2).toHaveBeenCalledTimes(1)
    gate2.resolve()
    await flushMicrotasks()
  })

  it('maxConcurrent gates jobs across different features too', async () => {
    const { scheduler } = makeScheduler({ debounceMs: 0, maxConcurrent: 1 })
    const gate1 = deferred()
    const run1 = vi.fn().mockReturnValue(gate1.promise)
    const run2 = vi.fn().mockResolvedValue(undefined)

    scheduler.enqueue({ scope: 'a', feature: 'f1', run: run1 }, { immediate: true })
    scheduler.enqueue({ scope: 'b', feature: 'f2', run: run2 }, { immediate: true })
    await vi.runOnlyPendingTimersAsync()
    await flushMicrotasks()

    expect(run1).toHaveBeenCalledTimes(1)
    expect(run2).not.toHaveBeenCalled()

    gate1.resolve()
    await flushMicrotasks()
    expect(run2).toHaveBeenCalledTimes(1)
  })
})
