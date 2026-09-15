import type { z } from 'zod'
import { OPERATIONS } from './operations'

/**
 * Every channel the window and the app talk over.
 *
 * A channel is always its domain and its operation joined by a colon, with no
 * exceptions, so the strings are built rather than written — a mistyped
 * channel used to fail at runtime with nothing to say.
 *
 * Requests come from `operations.ts`, where each one is declared once with
 * what it takes and what it gives back. Only events are listed here, because
 * an event is genuinely just a name: it travels the other way, is never
 * handled, and carries a payload this app itself wrote.
 */
const EVENTS = {
  events: ['fileChange', 'indexUpdated', 'vaultChanged', 'menuCommand', 'aiFilesUpdated'],
  terminalEvents: ['data', 'exit'],
  providerEvents: ['nodeRuntimeStatus'],
  historyEvents: ['updated'],
  claudeEvents: ['sessionTitle'],
  engineEvents: ['jobUpdate', 'log', 'pausedChanged'],
  folderContextEvents: ['updated', 'statusChanged'],
  typeEvents: ['changed'],
  gitEvents: ['statusChanged'],
  linkHealthEvents: [
    /** Fired only while `settings.linkHealth.autoEnabled` is on — a manual
     *  check always just calls `index.linkHealth` directly. */
    'updated'
  ],
  chatEvents: [
    'turnStart',
    'assistantText',
    'toolUse',
    'toolResult',
    'turnDone',
    'sessionUpdated',
    /** This tab's agent has said what it can be configured with, or changed it. */
    'agentOptions',
    /** The agent wants to run a tool and is waiting on a person to say yes. */
    'permissionRequest',
    /** The wait above is over — answered, timed out, or the session ended. */
    'permissionResolved'
  ],
  updateEvents: ['status'],
  githubEvents: ['auth'],
  syncEvents: ['status']
} as const satisfies Record<string, readonly string[]>

type Requests = typeof OPERATIONS
type Events = typeof EVENTS

/** `{ comments: { list: 'comments:list', … } }`, with the strings kept exact. */
type Channels = {
  [D in keyof Requests]: { [M in keyof Requests[D]]: `${D & string}:${M & string}` }
} & {
  [D in keyof Events]: { [M in Events[D][number]]: `${D & string}:${M & string}` }
}

function build(): Channels {
  const out = {} as Record<string, Record<string, string>>
  for (const [domain, ops] of Object.entries(OPERATIONS)) {
    const built: Record<string, string> = {}
    for (const name of Object.keys(ops)) built[name] = `${domain}:${name}`
    out[domain] = built
  }
  for (const [domain, names] of Object.entries(EVENTS)) {
    const built: Record<string, string> = {}
    for (const name of names) built[name] = `${domain}:${name}`
    out[domain] = built
  }
  return out as Channels
}

export const IPC = build()

/**
 * The schema an arriving request's arguments are checked against.
 *
 * Null for an event, which travels the other way and is never handled.
 */
export function argsSchemaFor(channel: string): z.ZodTuple | null {
  const [domain, name] = channel.split(':')
  if (!domain || !name) return null
  const ops = (OPERATIONS as unknown as Record<string, Record<string, { args: z.ZodTuple }>>)[
    domain
  ]
  return ops?.[name]?.args ?? null
}
