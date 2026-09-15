import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { IPC } from '@shared/ipc-channels'
import { OPERATIONS } from '@shared/operations'
import type { IpcResult } from '@shared/types'

/**
 * The door checks what arrives before the work runs.
 *
 * Nothing used to. All 151 handlers cast whatever the window sent to a
 * TypeScript type that is gone by the time the message lands, so a stale
 * window, a bad refactor or a renderer bug reached the file system with the
 * wrong thing in hand and failed somewhere deeper, if at all.
 */

const handlers = new Map<string, (e: unknown, ...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (e: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, fn)
    }
  }
}))

const { handle } = await import('./handle')

async function call(channel: string, ...args: unknown[]): Promise<IpcResult<unknown>> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`nothing registered for ${channel}`)
  return (await fn({}, ...args)) as IpcResult<unknown>
}

describe('an argument that is not what the operation takes', () => {
  it('is refused, and the work never runs', async () => {
    const work = vi.fn(async () => ({ ok: true }))
    handle(IPC.notes.read, work)

    const result = await call(IPC.notes.read, 42)

    expect(result.ok).toBe(false)
    expect(result.code).toBe('BAD_REQUEST')
    // The message says which argument, so a log entry is actionable on its own.
    expect(result.error).toContain('argument 1')
    expect(work).not.toHaveBeenCalled()
  })

  it('comes back as a result, not as a thrown error', async () => {
    // Every other refusal reaches the window as something it can read; this
    // one has to look the same or the window's error handling misses it.
    handle(IPC.notes.rename, vi.fn())
    await expect(call(IPC.notes.rename, 1, 2)).resolves.toMatchObject({ ok: false })
  })
})

describe('an argument that is what the operation takes', () => {
  it('reaches the handler unchanged', async () => {
    const work = vi.fn(async () => 'body')
    handle(IPC.notes.write, work)

    await call(IPC.notes.write, '/vault/a.md', 'hello', { title: 'A' }, 12345)

    expect(work).toHaveBeenCalledWith({}, '/vault/a.md', 'hello', { title: 'A' }, 12345)
  })

  it('still reaches it when a trailing optional argument is left out', async () => {
    // The window sends only what the caller passed, and a tuple reads a short
    // list as too small rather than as the omission it is. Getting this wrong
    // would have refused a working call on every operation with an optional
    // argument — `notes.search` among them.
    const work = vi.fn(async () => [])
    handle(IPC.notes.search, work)

    const result = await call(IPC.notes.search, 'query')

    expect(work).toHaveBeenCalled()
    expect(result).not.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('lets an operation that takes nothing be called with nothing', async () => {
    const work = vi.fn(async () => [])
    handle(IPC.notes.list, work)
    await call(IPC.notes.list)
    expect(work).toHaveBeenCalled()
  })
})

describe('the declarations themselves', () => {
  it('give every operation an argument schema', () => {
    // A whole-map check rather than one per operation: what this is really
    // pinning is that a new operation cannot be added without declaring what
    // it takes, which is the only way the check above stays universal.
    const missing: string[] = []
    for (const [domain, ops] of Object.entries(OPERATIONS)) {
      for (const [name, op] of Object.entries(ops as Record<string, { args: unknown }>)) {
        if (!(op.args instanceof z.ZodTuple)) missing.push(`${domain}.${name}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('cover every channel that is not an event', () => {
    const declared = Object.entries(IPC)
      .filter(([domain]) => !/events$/i.test(domain))
      .flatMap(([domain, ops]) =>
        Object.keys(ops as Record<string, string>).map((name) => `${domain}.${name}`)
      )
    expect(declared.length).toBeGreaterThan(140)
  })
})
