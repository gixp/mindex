import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { IPC } from '@shared/ipc-channels'

/**
 * Every declared operation has a handler, and every handler answers a declared
 * operation.
 *
 * The app checks this at startup and refuses to run on a mismatch, which is
 * the safety net. This is the earlier warning: a mismatch fails here, in a
 * second, rather than when someone launches the app — or worse, when someone
 * clicks the one button that was never wired.
 *
 * Read from the source rather than by registering for real: registering means
 * starting the whole main process, and the question being asked is a question
 * about the source anyway.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** Channels that travel the other way — sent to the window, never handled. */
const isEvent = (channel: string): boolean => /^[a-z]*events:/i.test(channel)

function declaredOperations(): string[] {
  return Object.values(IPC)
    .flatMap((ops) => Object.values(ops as Record<string, string>))
    .filter((c) => !isEvent(c))
}

function handledOperations(): string[] {
  const out: string[] = []
  for (const file of fs.readdirSync(HERE)) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue
    const src = fs.readFileSync(path.join(HERE, file), 'utf8')
    for (const m of src.matchAll(/\bhandle\(\s*IPC\.([A-Za-z]+)\.([A-Za-z]+)/g)) {
      const domain = IPC[m[1] as keyof typeof IPC] as Record<string, string> | undefined
      const channel = domain?.[m[2]!]
      if (channel) out.push(channel)
    }
  }
  return out
}

describe('IPC coverage', () => {
  it('handles every operation that is declared', () => {
    const handled = new Set(handledOperations())
    expect(declaredOperations().filter((c) => !handled.has(c))).toEqual([])
  })

  it('declares every operation that is handled', () => {
    const declared = new Set(declaredOperations())
    expect([...new Set(handledOperations())].filter((c) => !declared.has(c))).toEqual([])
  })

  it('registers each channel exactly once', () => {
    const handled = handledOperations()
    const seen = new Map<string, number>()
    for (const c of handled) seen.set(c, (seen.get(c) ?? 0) + 1)
    expect([...seen].filter(([, n]) => n > 1).map(([c]) => c)).toEqual([])
  })

  it('finds a realistic number of them, so a broken scan cannot pass silently', () => {
    // A regex that matched nothing would make the two checks above trivially
    // true. This is the guard on the guard.
    expect(handledOperations().length).toBeGreaterThan(100)
  })
})
