import { ipcMain } from 'electron'
import type { ZodIssue } from 'zod'
import { argsSchemaFor, IPC } from '@shared/ipc-channels'
import { CodedError, err } from '@main/util/result'

/**
 * The one door every request handler is registered through.
 *
 * An operation used to be declared in four places — its channel, its contract,
 * its forwarding in the bridge, and the work itself — and the fourth was the
 * dangerous one to forget: a channel declared and never handled fails at the
 * moment someone clicks, with an unhandled-channel error and nothing pointing
 * at the cause. Two of those four are gone (the bridge is derived, the channel
 * strings are built); this closes the gap between the remaining two.
 *
 * Going through here means the set of handled channels is known, which is what
 * makes the check below possible at all.
 */

const registered = new Set<string>()

type Handler = Parameters<typeof ipcMain.handle>[1]

export function handle(channel: string, fn: Handler): void {
  if (registered.has(channel)) {
    // Two handlers for one channel is not a merge — the second silently
    // replaces the first, and the feature that lost is the one nobody
    // notices until it is reported.
    throw new Error(`Two handlers registered for "${channel}"`)
  }
  registered.add(channel)
  const schema = argsSchemaFor(channel)
  if (!schema) {
    ipcMain.handle(channel, fn)
    return
  }
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    // Fixed to the declared arity before checking. A caller that leaves a
    // trailing optional argument out sends a shorter list, and a tuple reads
    // that as too small rather than as the omission it is; anything past the
    // end is not part of the operation and is dropped rather than refused.
    const fitted = schema.items.map((_, i) => args[i])
    const parsed = schema.safeParse(fitted)
    if (!parsed.success) {
      // Returned, not thrown. Every other refusal reaches the window as a
      // result it can read, and this one is the same shape — with a code,
      // because it is never something a person did: it means the window and
      // the app disagree about what this operation takes.
      return err(new CodedError('BAD_REQUEST', describeArgsFailure(channel, parsed.error)))
    }
    return fn(event, ...(parsed.data as unknown[]))
  })
}

/** Which argument, and what was wrong with it — in one line for a log. */
function describeArgsFailure(channel: string, error: { issues: ZodIssue[] }): string {
  const first = error.issues[0]
  const where = first?.path?.length ? `argument ${Number(first.path[0]) + 1}` : 'the arguments'
  return `${channel} was called with something it does not take: ${where} ${first?.message ?? 'is wrong'}`
}

/** Every channel the shared list declares, flattened. */
function declaredChannels(): string[] {
  return Object.values(IPC).flatMap((ops) => Object.values(ops as Record<string, string>))
}

/**
 * Check that the declared operations and the handled ones are the same set.
 *
 * Called once, after everything has registered. Loud on purpose: both halves
 * of a mismatch are silent otherwise. A declared channel with no handler
 * throws only when a person clicks the thing; a handler for a channel nobody
 * declares can never be called at all, so it looks like a feature that does
 * not work rather than one that was never wired.
 *
 * Events are excluded — they travel the other way, from here to the window,
 * and are never handled.
 */
export function assertEveryOperationIsHandled(): void {
  const declared = declaredChannels().filter((c) => !/^[a-z]*events:/i.test(c))
  const unhandled = declared.filter((c) => !registered.has(c))
  const undeclared = [...registered].filter((c) => !declared.includes(c))
  if (unhandled.length === 0 && undeclared.length === 0) return
  const parts = [
    unhandled.length ? `declared but never handled: ${unhandled.join(', ')}` : '',
    undeclared.length ? `handled but never declared: ${undeclared.join(', ')}` : ''
  ].filter(Boolean)
  throw new Error(`IPC operations out of step — ${parts.join('; ')}`)
}
